import {createCipheriv,createDecipheriv,randomBytes,scryptSync} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';

export type Credentials={token?:string;access?:string;secret?:string;category?:string;license?:string};
const services=['archive','osf','figshare','zenodo'];
export class CredentialStore{
 private key:Buffer;
 constructor(private db:DatabaseSync,password:string){
  db.exec('CREATE TABLE IF NOT EXISTS credential_settings(platform TEXT PRIMARY KEY, encrypted TEXT NOT NULL, checked_at TEXT, last_error TEXT); CREATE TABLE IF NOT EXISTS credential_crypto(id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL);');
  db.prepare('INSERT OR IGNORE INTO credential_crypto(id,salt) VALUES(1,?)').run(randomBytes(16).toString('base64'));
  const row=db.prepare('SELECT salt FROM credential_crypto WHERE id=1').get() as {salt:string};
  this.key=scryptSync(password,Buffer.from(row.salt,'base64'),32);
 }
 private service(platform:string){if(!services.includes(platform))throw new Error('Неизвестная площадка.');}
 read(platform:string):Credentials{
  this.service(platform);const row=this.db.prepare('SELECT encrypted FROM credential_settings WHERE platform=?').get(platform) as {encrypted:string}|undefined;
  if(!row)return {};
  try{const data=JSON.parse(row.encrypted);if(data.v!==1)throw new Error('version');const decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(data.iv,'base64'));decipher.setAAD(Buffer.from(platform));decipher.setAuthTag(Buffer.from(data.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.data,'base64')),decipher.final()]).toString('utf8'));}
  catch{throw new Error('Не удалось открыть сохранённое подключение. Если изменён APP_PASSWORD, верните прежний пароль или сохраните ключ заново.');}
 }
 save(platform:string,input:Credentials){
  this.service(platform);const clean:Credentials={};
  for(const field of (platform==='archive'?['access','secret']:['token'])){const value=input[field as keyof Credentials];if(typeof value!=='string'||!value.trim()||value.length>8192)throw new Error(platform==='archive'?'Введите оба ключа Internet Archive.':'Введите токен площадки.');if(!/^[\x21-\x7e]+$/.test(value.trim()))throw new Error('Скопируйте ключ без пробелов внутри, переносов строк и посторонних символов.');clean[field as keyof Credentials]=value.trim();}
  if(platform==='figshare')for(const field of ['category','license'] as const){if(input[field]!==undefined&&input[field]!==''){if(!/^\d+$/.test(String(input[field])))throw new Error('Выберите категорию и лицензию Figshare.');clean[field]=String(input[field]);}}
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(platform));const data=Buffer.concat([cipher.update(JSON.stringify(clean),'utf8'),cipher.final()]);
  const encrypted=JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});
  this.db.prepare('INSERT INTO credential_settings(platform,encrypted) VALUES(?,?) ON CONFLICT(platform) DO UPDATE SET encrypted=excluded.encrypted,checked_at=NULL,last_error=NULL').run(platform,encrypted);
 }
 metadata(platform:string){this.service(platform);const row=this.db.prepare('SELECT checked_at,last_error FROM credential_settings WHERE platform=?').get(platform) as {checked_at:string|null;last_error:string|null}|undefined;return {saved:Boolean(row),checkedAt:row?.checked_at||null,error:row?.last_error||null};}
 revision(platform:string){this.service(platform);const row=this.db.prepare('SELECT encrypted FROM credential_settings WHERE platform=?').get(platform) as {encrypted:string}|undefined;return row?.encrypted;}
 checked(platform:string,error?:string,revision?:string){this.service(platform);const args=[error?null:new Date().toISOString(),error||null,platform];const query='UPDATE credential_settings SET checked_at=?,last_error=? WHERE platform=?';const result=revision===undefined?this.db.prepare(query).run(...args):this.db.prepare(query+' AND encrypted=?').run(...args,revision);return result.changes===1;}
}
