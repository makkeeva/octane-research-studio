import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateGeminiReport,checkGeminiKey,GEMINI_MODEL} from '../dist/test-library.mjs';
import {fixture} from './fixtures.mjs';
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
async function mocked(fetcher,run){const original=globalThis.fetch;globalThis.fetch=fetcher;try{await run();}finally{globalThis.fetch=original;}}
const modelUrl='https://generativelanguage.googleapis.com/v1beta/models/'+GEMINI_MODEL;
const search=(sources=true)=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'Research notes, with evidence and uncertainties.'}]},groundingMetadata:{groundingChunks:sources?[{web:{uri:fixture().report.sources[1].url,title:'Official source'}}]:[],searchEntryPoint:{renderedContent:'<div>Google search suggestions</div>'}}}]});
const report=(doc=fixture())=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(doc.report)}]}}]});
test('Gemini key check is read-only, uses a header and does not leak model metadata or the key',async()=>{
 await mocked(async(url,options)=>{assert.equal(url,modelUrl);assert.equal(options.method,'GET');assert.equal(options.headers['x-goog-api-key'],'private-gemini-test-key');assert.equal(options.body,undefined);assert.equal(options.redirect,'manual');return reply({name:'models/'+GEMINI_MODEL,supportedGenerationMethods:['generateContent'],description:'private-test-metadata'});},async()=>{const result=await checkGeminiKey(' private-gemini-test-key ');assert.equal(result.ok,true);assert.doesNotMatch(JSON.stringify(result),/private-gemini-test-key|private-test-metadata/);});
 for(const status of [400,403,404,429])await mocked(async()=>reply({error:{message:'private-gemini-test-key'}},status),async()=>assert.rejects(checkGeminiKey('private-gemini-test-key'),e=>{assert.match(e.message,new RegExp('HTTP '+status));assert.doesNotMatch(e.message,/private-gemini-test-key/);return true;}));
});
test('Gemini searches before JSON drafting, verifies provenance and resets review flags',async()=>{
 let calls=0;
 const stages=[];
 await mocked(async(url,options)=>{assert.equal(url,modelUrl+':generateContent');const body=JSON.parse(options.body);calls++;if(calls===1){assert.deepEqual(body.tools,[{googleSearch:{}}]);assert.equal(body.generationConfig.responseMimeType,undefined);return reply(search());}assert.equal(body.tools,undefined);assert.equal(body.generationConfig.responseMimeType,'application/json');assert.deepEqual(body.generationConfig.responseJsonSchema.properties.claims.items.properties.status.enum,['supported','unverified','conflict']);assert.match(body.generationConfig.responseJsonSchema.properties.claims.items.properties.evidence.description,/350/);assert.doesNotMatch(JSON.stringify(body.generationConfig.responseJsonSchema),/"maxLength"|"maxItems"|"pattern"/);assert.match(body.contents[0].parts[0].text,/groundingSources/);return reply(report());},async()=>{const result=await generateGeminiReport(fixture(),'test-key',stage=>stages.push(stage));assert.equal(result.claims[0].reviewed,false);assert.match(result.searchSuggestionsHtml,/Google/);assert.match(result.disclosure,/human author/i);});assert.equal(calls,2);assert.equal(stages.length,3);
});
test('Gemini never treats the invalid verified claim status as supported',async()=>{
 const invalid=fixture();invalid.report.claims[0].status='verified';let calls=0;
 await mocked(async()=>reply(++calls===1?search():report(invalid)),async()=>assert.rejects(generateGeminiReport(fixture(),'test-key'),/Invalid enum value/));assert.equal(calls,2);
});
test('Gemini rejects absent search sources, invented citations, truncated answers and exhausted quotas without retry or provider fallback',async()=>{
 let calls=0;
 await mocked(async()=>{calls++;return reply(search(false));},async()=>assert.rejects(generateGeminiReport(fixture(),'test-key'),/не вернул источники/));assert.equal(calls,1);
 calls=0;const invented=fixture();invented.report.sources[1].url='https://invented.example/source';
 await mocked(async()=>reply(++calls===1?search():report(invented)),async()=>assert.rejects(generateGeminiReport(fixture(),'test-key'),/ссылки/));assert.equal(calls,2);
 calls=0;await mocked(async()=>{calls++;return reply({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'incomplete'}]}}]});},async()=>assert.rejects(generateGeminiReport(fixture(),'test-key'),/не завершил/));assert.equal(calls,1);
 calls=0;await mocked(async()=>{calls++;return reply({},429);},async()=>assert.rejects(generateGeminiReport(fixture(),'test-key'),/лимит Gemini/));assert.equal(calls,1);
});

test('Gemini schema errors do not tell users to replace their valid API key',async()=>{await mocked(async()=>reply({error:{message:'The specified schema produces a constraint that has too many states for serving.'}},400),async()=>assert.rejects(checkGeminiKey('test-key'),e=>{assert.match(e.message,/отклонил запрос приложения/);assert.doesNotMatch(e.message,/Проверьте ключ/);return true;}));});
