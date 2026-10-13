import {DatabaseSync,backup} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {randomBytes,scryptSync,createCipheriv,createDecipheriv} from 'node:crypto';
import {secret} from './terminal-secret.mjs';
const aad=Buffer.from('octane-local-backup-v1');
const exists=async p=>fs.stat(p).then(()=>true,()=>false);
export async function exportData(root,output){
 const environment=await fs.readFile(path.join(root,'.env'),'utf8');const parsed=parseEnv(environment),password=parsed.APP_PASSWORD;
 if(!password||password.length<12)throw Error('Не найден пароль приложения в .env.');
 const dir=path.resolve(root,parsed.DATA_DIR||'.data');const temp=await fs.mkdtemp(path.join(tmpdir(),'octane-backup-'));let db;
 try{
  await fs.chmod(temp,0o700);db=new DatabaseSync(path.join(dir,'studio.sqlite'),{readOnly:true});
  const active=db.prepare("SELECT COUNT(*) n FROM generation_jobs WHERE status='running'").get().n;
  if(active)throw Error('Дождитесь завершения генерации перед переносом.');
  const snapshot=path.join(temp,'studio.sqlite');await backup(db,snapshot);await fs.chmod(snapshot,0o600);
  const docs=db.prepare('SELECT id FROM documents').all();const connections=db.prepare('SELECT COUNT(*) n FROM credential_settings').get().n;
  const pdfs=[];for(const d of docs){if(!/^[0-9a-f-]{36}$/.test(d.id))throw Error('Некорректный номер документа.');const file=path.join(dir,'pdf',d.id+'.pdf');if(await exists(file))pdfs.push({id:d.id,data:(await fs.readFile(file)).toString('base64')});}
  const payload=Buffer.from(JSON.stringify({environment,database:(await fs.readFile(snapshot)).toString('base64'),pdfs}));
  const salt=randomBytes(16),iv=randomBytes(12),key=scryptSync(password,salt,32),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad);
  const data=Buffer.concat([cipher.update(payload),cipher.final()]);key.fill(0);payload.fill(0);
  const packet={v:1,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
  await fs.writeFile(output,JSON.stringify(packet),{mode:0o600,flag:'wx'});return {documents:docs.length,connections,pdfs:pdfs.length};
 }finally{db?.close();await fs.rm(temp,{recursive:true,force:true});}
}
export async function restoreData(root,input,password){
 const target=path.join(root,'.data'),database=path.join(target,'studio.sqlite');
 if(await exists(database))throw Error('Локальная база уже существует. Перенос не перезаписывает ваши данные.');
 let payload;
 try{const packet=JSON.parse(await fs.readFile(input,'utf8'));if(packet.v!==1||typeof packet.data!=='string'||packet.data.length>80000000)throw Error('format');
  const key=scryptSync(password,Buffer.from(packet.salt,'base64'),32),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(packet.iv,'base64'));decipher.setAAD(aad);decipher.setAuthTag(Buffer.from(packet.tag,'base64'));
  const plain=Buffer.concat([decipher.update(Buffer.from(packet.data,'base64')),decipher.final()]);key.fill(0);payload=JSON.parse(plain.toString('utf8'));plain.fill(0);
 }catch{throw Error('Не удалось открыть резервную копию. Введите прежний пароль приложения Octane; это не пароль GitHub.');}
 if(parseEnv(payload.environment||'').APP_PASSWORD!==password||typeof payload.database!=='string'||!Array.isArray(payload.pdfs))throw Error('Неверные данные резервной копии.');
 for(const file of payload.pdfs)if(!/^[0-9a-f-]{36}$/.test(file.id)||typeof file.data!=='string')throw Error('Неверные файлы резервной копии.');
 await fs.mkdir(target,{recursive:true,mode:0o700});await fs.mkdir(path.join(target,'pdf'),{recursive:true,mode:0o700});
 const staged=path.join(target,'restore-'+randomBytes(8).toString('hex')+'.sqlite');
 try{
  await fs.writeFile(staged,Buffer.from(payload.database,'base64'),{mode:0o600});const check=new DatabaseSync(staged,{readOnly:true});let counts;
  try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('База повреждена.');counts={documents:check.prepare('SELECT COUNT(*) n FROM documents').get().n,connections:check.prepare('SELECT COUNT(*) n FROM credential_settings').get().n};}finally{check.close();}
  const envPath=path.join(root,'.env');if(await exists(envPath))await fs.copyFile(envPath,envPath+'.before-restore-'+Date.now());
  const envTemp=envPath+'.restore-'+randomBytes(8).toString('hex');await fs.writeFile(envTemp,payload.environment,{mode:0o600});
  if(process.getuid?.()===0&&/^\d+$/.test(process.env.STUDIO_OWNER_UID||'')&&/^\d+$/.test(process.env.STUDIO_OWNER_GID||''))await fs.chown(envTemp,Number(process.env.STUDIO_OWNER_UID),Number(process.env.STUDIO_OWNER_GID));
  await fs.rename(envTemp,envPath);await fs.rename(staged,database);
  for(const file of payload.pdfs)await fs.writeFile(path.join(target,'pdf',file.id+'.pdf'),Buffer.from(file.data,'base64'),{mode:0o600});
  if(process.getuid?.()===0&&process.env.STUDIO_DOCKER_RESTORE==='1'){for(const file of [target,path.join(target,'pdf'),database,...payload.pdfs.map(f=>path.join(target,'pdf',f.id+'.pdf'))])await fs.chown(file,1000,1000);}
  return {...counts,pdfs:payload.pdfs.length};
 }finally{await fs.rm(staged,{force:true});}
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 try{const [command,file]=process.argv.slice(2);if(!file||!['export','import'].includes(command))throw Error('Используйте: node scripts/data-backup.mjs export|import ПУТЬ');
  const result=command==='export'?await exportData(process.cwd(),path.resolve(file)):await restoreData(process.cwd(),path.resolve(file),await secret('Прежний пароль приложения Octane (ввод скрыт): '));
  console.log('Готово:',result.documents,'документов,',result.connections,'подключений,',result.pdfs,'PDF.');
 }catch(e){console.error(e.message);process.exitCode=1;}
}
