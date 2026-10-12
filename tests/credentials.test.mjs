import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CredentialStore,checkConnection} from '../dist/test-library.mjs';

test('encrypted credentials and verification survive reopening; wrong keys and tampering cannot disclose secrets',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'octane-vault-'));const file=join(dir,'vault.sqlite');let db=new DatabaseSync(file);
 try{
  let store=new CredentialStore(db,'test-password-for-vault-only');
  store.save('osf',{token:'private-test-osf-key'});store.checked('osf');
  store.save('archive',{access:'private-test-access',secret:'private-test-secret'});
  assert.doesNotMatch(JSON.stringify(store.metadata('osf')),/private-test/);
  db.close();db=new DatabaseSync(file);store=new CredentialStore(db,'test-password-for-vault-only');
  assert.equal(store.read('osf').token,'private-test-osf-key');assert.ok(store.metadata('osf').checkedAt);
  assert.equal(store.read('archive').secret,'private-test-secret');
  store.checked('osf','Service is unavailable');assert.equal(store.read('osf').token,'private-test-osf-key');assert.equal(store.metadata('osf').error,'Service is unavailable');
  const previous=store.revision('osf');store.save('osf',{token:'replacement-test-key'});assert.equal(store.checked('osf',undefined,previous),false);assert.equal(store.metadata('osf').checkedAt,null);assert.equal(store.metadata('osf').error,null);
  const wrong=new CredentialStore(db,'another-test-password-only');assert.throws(()=>wrong.read('osf'),/Не удалось/);
  const row=db.prepare('SELECT encrypted FROM credential_settings WHERE platform=?').get('osf');db.prepare('INSERT INTO credential_settings(platform,encrypted) VALUES(?,?)').run('zenodo',row.encrypted);assert.throws(()=>store.read('zenodo'),/Не удалось/);
  assert.throws(()=>store.save('archive',{access:'only-one-key'}),/оба ключа/);
  assert.throws(()=>store.save('osf',{token:'key\nwith-newline'}),/переносов/);
  assert.doesNotMatch((await readFile(file)).toString(),/private-test-osf-key|private-test-access|private-test-secret|replacement-test-key/);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

test('Archive and Figshare credential checks only read account data and reject anonymous results',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://archive.org/services/user.php?op=whoami');assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'LOW access-for-test:secret-for-test');return new Response(JSON.stringify('private-user@example.test'));};
  const archive=await checkConnection('archive',{access:'access-for-test',secret:'secret-for-test'});assert.equal(archive.ok,true);assert.doesNotMatch(JSON.stringify(archive),/private-user|access-for-test|secret-for-test/);
  globalThis.fetch=async(url,options)=>{assert.match(options.headers['User-Agent'],/OctaneResearchStudio/);return new Response(JSON.stringify({success:true,value:{username:'private-user@example.test',screenname:'Private display name',privs:{private:true}}}));};
  const currentArchive=await checkConnection('archive',{access:'access-for-test',secret:'secret-for-test'});assert.equal(currentArchive.ok,true);assert.doesNotMatch(JSON.stringify(currentArchive),/private-user|Private display name|privs|access-for-test|secret-for-test/);
  for(const identity of [{success:false,value:{username:'private-user@example.test'}},{success:true,value:{}},{success:true,value:{username:123}},{value:{username:'private-user@example.test'}}]){
   globalThis.fetch=async()=>new Response(JSON.stringify(identity));await assert.rejects(checkConnection('archive',{access:'access-for-test',secret:'secret-for-test'}),/не подтвердил/);
  }
  globalThis.fetch=async()=>new Response(JSON.stringify(''));await assert.rejects(checkConnection('archive',{access:'access-for-test',secret:'secret-for-test'}),/не подтвердил/);
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.figshare.com/v2/account/articles?page_size=1');assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'token figshare-test-token');return new Response('[]');};
  assert.equal((await checkConnection('figshare',{token:'figshare-test-token'})).ok,true);
  globalThis.fetch=async()=>new Response('{}',{status:401});await assert.rejects(checkConnection('figshare',{token:'invalid-token'}),/HTTP 401/);
 }finally{globalThis.fetch=original;}
});
