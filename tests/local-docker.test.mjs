import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseEnv} from 'node:util';
import {CredentialStore} from '../dist/test-library.mjs';
import {configureLocalDocker} from '../scripts/setup.mjs';
import {exportData,restoreData} from '../scripts/data-backup.mjs';

const password='local-test-$-# password';
const documentId='12345678-1234-1234-1234-123456789abc';
async function fixture(root){
 await mkdir(join(root,'.data','pdf'),{recursive:true});
 await writeFile(join(root,'.env'),`APP_PASSWORD='${password}'\nPUBLIC_URL=https://old-codespace.example\nDATA_DIR=.data\nGEMINI_API_KEY=test-key-from-env\n`);
 const db=new DatabaseSync(join(root,'.data','studio.sqlite'));
 db.exec('PRAGMA journal_mode=WAL; CREATE TABLE documents(id TEXT PRIMARY KEY, payload TEXT); CREATE TABLE generation_jobs(doc_id TEXT,status TEXT); CREATE TABLE publications(id TEXT,payload TEXT);');
 db.prepare('INSERT INTO documents VALUES(?,?)').run(documentId,'private report text');
 db.prepare('INSERT INTO publications VALUES(?,?)').run('existing-record','published-id-to-preserve');
 const vault=new CredentialStore(db,password);vault.save('osf',{token:'private-osf-test-key'});vault.checked('osf');vault.save('gemini',{token:'private-gemini-test-key'});
 await writeFile(join(root,'.data','pdf',documentId+'.pdf'),'%PDF-test-backup');
 return db;
}

test('local Docker settings replace Codespace origin and preserve password and API settings',()=>{
 const input=`APP_PASSWORD="${password}"\nPUBLIC_URL=https://old.example\nHOST=127.0.0.1\nPORT=3000\nGEMINI_API_KEY=keep-test-key\n`;
 const output=configureLocalDocker(input),env=parseEnv(output);
 assert.equal(env.APP_PASSWORD,password);assert.match(output,/APP_PASSWORD='/);assert.equal(env.PUBLIC_URL,'http://localhost:3001');assert.equal(env.HOST,'0.0.0.0');assert.equal(env.STUDIO_PORT,'3001');assert.equal(env.PORT,'3000');assert.equal(env.GEMINI_API_KEY,'keep-test-key');
 assert.equal(configureLocalDocker(output),output);
 assert.equal(parseEnv(configureLocalDocker(output,'3002')).PUBLIC_URL,'http://localhost:3002');
 for(const port of ['0','65536','3x','-1'])assert.throws(()=>configureLocalDocker(input,port),/STUDIO_PORT/);
});

test('encrypted local backup snapshots WAL and restores reports, PDFs and usable original credential vault',async()=>{
 const root=await mkdtemp(join(tmpdir(),'octane-local-test-'));let db;
 try{
  const source=join(root,'source'),destination=join(root,'restored');await mkdir(source);await mkdir(destination);db=await fixture(source);
  const file=join(root,'octane-local-backup.enc.json');const counts=await exportData(source,file);
  assert.deepEqual(counts,{documents:1,connections:2,pdfs:1});
  assert.doesNotMatch(await readFile(file,'utf8'),/private-osf-test-key|private-gemini-test-key|private report text|local-test|test-key-from-env/);
  assert.equal((await stat(file)).mode&0o777,0o600);
  await assert.rejects(exportData(source,file),/EEXIST/);
  await assert.rejects(restoreData(destination,file,'wrong-test-password'),/прежний пароль/);
  await assert.rejects(stat(join(destination,'.env')),/ENOENT/);
  assert.deepEqual(await restoreData(destination,file,password),counts);
  const restored=new DatabaseSync(join(destination,'.data','studio.sqlite'));
  try{
   assert.equal(restored.prepare('SELECT payload FROM documents WHERE id=?').get(documentId).payload,'private report text');
   assert.equal(restored.prepare('SELECT payload FROM publications').get().payload,'published-id-to-preserve');
   const vault=new CredentialStore(restored,parseEnv(await readFile(join(destination,'.env'),'utf8')).APP_PASSWORD);
   assert.equal(vault.read('osf').token,'private-osf-test-key');assert.ok(vault.metadata('osf').checkedAt);assert.equal(vault.read('gemini').token,'private-gemini-test-key');
  }finally{restored.close();}
  assert.equal(await readFile(join(destination,'.data','pdf',documentId+'.pdf'),'utf8'),'%PDF-test-backup');
  await assert.rejects(restoreData(destination,file,password),/не перезаписывает/);
  const packet=JSON.parse(await readFile(file,'utf8'));const data=Buffer.from(packet.data,'base64');data[0]^=1;packet.data=data.toString('base64');await writeFile(join(root,'tampered.enc.json'),JSON.stringify(packet));
  const other=join(root,'other');await mkdir(other);await assert.rejects(restoreData(other,join(root,'tampered.enc.json'),password),/Не удалось/);await assert.rejects(stat(join(other,'.data','studio.sqlite')),/ENOENT/);
 }finally{db?.close();await rm(root,{recursive:true,force:true});}
});

test('backup refuses an active generation without writing an incomplete package',async()=>{
 const root=await mkdtemp(join(tmpdir(),'octane-busy-test-'));let db;
 try{db=await fixture(root);db.prepare('INSERT INTO generation_jobs VALUES(?,?)').run(documentId,'running');await assert.rejects(exportData(root,join(root,'backup.enc.json')),/Дождитесь/);await assert.rejects(stat(join(root,'backup.enc.json')),/ENOENT/);}
 finally{db?.close();await rm(root,{recursive:true,force:true});}
});
