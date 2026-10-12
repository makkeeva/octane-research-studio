import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {GenerationJobs} from '../dist/test-library.mjs';
import {setImmediate} from 'node:timers/promises';
test('generation jobs start once, record progress and finish after committing the report',async()=>{
 const db=new DatabaseSync(':memory:');const jobs=new GenerationJobs(db);let release,calls=0,commits=0;
 const pending=new Promise(resolve=>release=resolve);
 try{
  const start=jobs.start('doc',async progress=>{calls++;progress('Research');await pending;progress('Checking');return 'report';},result=>{assert.equal(result,'report');commits++;});assert.equal(start.status,'running');assert.equal(start.stage,'Research');assert.equal(jobs.active('doc'),true);
  const duplicate=jobs.start('doc',async()=>{throw Error('Must not start a duplicate');},()=>{});assert.equal(duplicate.status,'running');assert.equal(calls,1);
  release();await setImmediate();assert.equal(jobs.active('doc'),false);assert.equal(jobs.get('doc').status,'done');assert.equal(commits,1);assert.equal(jobs.get('doc').error,null);
 }finally{db.close();}
});
test('generation errors survive reload and interrupted jobs recover as failures without restarting the model',async()=>{
 const db=new DatabaseSync(':memory:');let jobs=new GenerationJobs(db);
 try{
  jobs.start('error-doc',async()=>{throw Object.assign(new Error('private-invalid-field-data'),{name:'ZodError'});},()=>{throw Error('Must not commit');});await setImmediate();assert.equal(jobs.get('error-doc').status,'failed');assert.doesNotMatch(jobs.get('error-doc').error,/private-invalid-field-data/);
  db.prepare('INSERT INTO generation_jobs(doc_id,status,stage,updated) VALUES(?,?,?,?)').run('interrupted','running','Research',new Date().toISOString());jobs=new GenerationJobs(db);assert.equal(jobs.get('error-doc').status,'failed');assert.equal(jobs.get('interrupted').status,'failed');assert.match(jobs.get('interrupted').error,/перезапущен/);
 }finally{db.close();}
});

test('structure errors identify fields and limits without echoing private model content',async()=>{
 const db=new DatabaseSync(':memory:');try{const jobs=new GenerationJobs(db);
 jobs.start('oversized',async()=>{throw Object.assign(new Error('private raw response'),{name:'ZodError',issues:[{code:'too_big',type:'string',maximum:350,path:['claims',2,'evidence'],message:'private model text'},{code:'invalid_type',path:['private invented field'],message:'private token'}]});},()=>{throw Error('Invalid report must not commit');});await setImmediate();const error=jobs.get('oversized').error;assert.match(error,/Факты.*№3.*Подтверждение факта.*350 символов/);assert.doesNotMatch(error,/private/);
 }finally{db.close();}
});
