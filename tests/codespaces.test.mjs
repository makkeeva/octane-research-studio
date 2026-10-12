import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';

test('Codespaces rewritten headers allow the app and secure login while rejecting foreign origins',async()=>{
 const port=42000+Math.floor(Math.random()*1000);
 const name='test-codespace';
 const hostname=`${name}-${port}.app.github.dev`;
 const dataDir=await mkdtemp(join(tmpdir(),'octane-proxy-'));
 const child=spawn(process.execPath,['dist/server.mjs'],{env:{...process.env,APP_PASSWORD:'proxy-test-password-only',HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dataDir,PUBLIC_URL:`https://${hostname}`,CODESPACES:'true',CODESPACE_NAME:name,GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:'app.github.dev'},stdio:['ignore','pipe','pipe']});
 async function request(headers={},body,method=body?'POST':'GET'){
  return new Promise((resolve,reject)=>{
   const req=httpRequest({hostname:'127.0.0.1',port,path:body?'/api/login':'/',method,headers:{Host:`localhost:${port}`,...headers}},res=>{res.resume();res.once('end',()=>resolve({status:res.statusCode,headers:{get(name){const value=res.headers[name];return Array.isArray(value)?value.join('; '):value??null;}}}));});
   req.once('error',reject);req.setTimeout(5000,()=>req.destroy(new Error('Request timed out')));req.end(body?JSON.stringify(body):undefined);
  });
 }
 try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server did not start')),10000);child.stdout.on('data',chunk=>{if(String(chunk).includes('running')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Server exited'));});});
  assert.equal((await request()).status,200);
  assert.equal((await request({Host:hostname+':443'})).status,200);
  assert.equal((await request({'X-Forwarded-Host':hostname})).status,200);
  assert.equal((await request({Host:'evil.example','X-Forwarded-Host':hostname})).status,403);
  assert.equal((await request({'X-Forwarded-Host':'evil.example'})).status,403);
  const headers={Origin:`http://localhost:${port}`,'Content-Type':'application/json','X-Studio-Request':'1'};
  const login=await request(headers,{password:'proxy-test-password-only'});
  assert.equal(login.status,200);
  assert.match(login.headers.get('set-cookie'),/HttpOnly.*SameSite=Strict.*Secure/);
  assert.equal((await request({...headers,'X-Studio-Request':''},{password:'proxy-test-password-only'})).status,403);
  assert.equal((await request({...headers,Origin:'https://evil.example'},{password:'proxy-test-password-only'})).status,403);
  assert.equal((await request({Origin:'https://evil.example','Access-Control-Request-Headers':'x-studio-request'},undefined,'OPTIONS')).headers.get('access-control-allow-origin'),null);
 } finally {
  if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});
  await rm(dataDir,{recursive:true,force:true});
 }
});
