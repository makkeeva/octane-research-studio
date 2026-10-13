import {env} from 'cloudflare:workers';
import {HostedVault,platforms as connectable,openMigration,openLegacyCredential} from './hosted-vault';
import {docSchema,assertPublishable,reportStructureError} from './research/validation';
import {importArticle,listArticles} from './research/source';
import {generateGeminiReport,researchGemini,checkGeminiKey,GEMINI_MODEL} from './research/gemini';
import {platforms,api,prepare,publish,reconcile,checkConnection} from './research/publish';
import {makePdf} from './research/pdf';
import {regularFont,boldFont} from './fonts';
const json=(value:any,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const errorText=(e:any)=>e.name==='ZodError'?reportStructureError(e):e.name==='TimeoutError'||e.name==='AbortError'?'Модель не ответила вовремя. Отчёт не сохранён; попробуйте позже.':e.message||'Ошибка запроса.';
export async function handleStudio(req:Request){
 const runtime:any=env,db=runtime.DB,vault=new HostedVault(db,runtime.VAULT_KEY_BASE64);
 const url=new URL(req.url),action=url.pathname.slice(5),now=()=>new Date().toISOString();
 const getDoc=async(id:string)=>{const row=await db.prepare('SELECT data FROM documents WHERE id=?').bind(id).first();if(!row)throw Error('Документ не найден.');return JSON.parse(row.data);};
 const save=async(d:any)=>db.prepare('INSERT INTO documents(id,data,updated) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated').bind(d.id,JSON.stringify(d),now()).run();
 const job=async(id:string)=>db.prepare('SELECT status,stage,error,updated,phase,lease FROM generation_jobs WHERE doc_id=?').bind(id).first();
 const editable=async(id:string)=>{if((await job(id))?.status==='running')throw Error('Дождитесь завершения генерации.');const locked=await db.prepare('SELECT key FROM publications WHERE doc_id=? LIMIT 1').bind(id).first();if(locked)throw Error('Документ уже подготовлен к публикации. Создайте копию.');};
 const config=async()=>{const connections:any={};for(const p of connectable)connections[p]=await vault.metadata(p);return {ai:connections.gemini.saved,aiProvider:connections.gemini.saved?'gemini':null,model:GEMINI_MODEL,contact:'seo@mbear.ae',connections,connected:Object.fromEntries(platforms.map(p=>[p,connections[p].saved])),persistent:true};};
 const pdf=async(d:any)=>makePdf(d,new Uint8Array(Buffer.from(regularFont,'base64')),new Uint8Array(Buffer.from(boldFont,'base64')));
 const putPdf=async(d:any,bytes:Uint8Array)=>runtime.BUCKET.put('pdf/'+d.id+'.pdf',bytes,{httpMetadata:{contentType:'application/pdf'}});
 // This deployment is owner-private. Sites dispatch authorizes every request,
 // including service access; neither a separate password nor a public API exists.
 try{
  if(action==='health')return json({ok:true,storage:'D1/R2'});
  if(!db||!runtime.BUCKET)throw Error('Постоянное хранилище пока не подключено.');
  if(req.method==='POST'){
   if(req.headers.get('X-Studio-Request')!=='1'||(req.headers.has('Origin')&&req.headers.get('Origin')!==url.origin))return json({error:'Недопустимый источник запроса.'},403);
   const text=await req.text();if(text.length>3500000)throw Error('Запрос слишком большой.');const b=JSON.parse(text||'{}');
   if(action==='migrate'){
    if(await db.prepare('SELECT value FROM settings WHERE key=?').bind('migration_imported').first())throw Error('Перенос уже выполнен.');
    const packet=await openMigration(b,runtime.MIGRATION_PRIVATE_KEY);
    if(!Array.isArray(packet.documents)||packet.documents.length>100||!Array.isArray(packet.credentials))throw Error('Неверные данные переноса.');
    const statements:any[]=[];for(const row of packet.documents){const d=docSchema.parse(JSON.parse(row.data));statements.push(db.prepare('INSERT INTO documents(id,data,updated) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').bind(d.id,JSON.stringify(d),row.updated));}
    for(const row of packet.credentials){if(!connectable.includes(row.platform))throw Error('Неизвестная площадка.');const value=await openLegacyCredential(row.platform,row.encrypted,packet.legacyKey);statements.push(db.prepare('INSERT INTO credential_settings(platform,encrypted,checked_at,last_error) VALUES(?,?,?,?) ON CONFLICT(platform) DO NOTHING').bind(row.platform,await vault.seal(row.platform,value),row.checked_at,row.last_error));}
    for(const row of packet.publications||[])statements.push(db.prepare('INSERT INTO publications(key,doc_id,platform,status,state,error,updated) VALUES(?,?,?,?,?,?,?) ON CONFLICT(key) DO NOTHING').bind(row.key,row.doc_id,row.platform,row.status,row.state,row.error,row.updated));
    for(const row of packet.jobs||[])statements.push(db.prepare('INSERT INTO generation_jobs(doc_id,status,stage,error,updated) VALUES(?,?,?,?,?) ON CONFLICT(doc_id) DO NOTHING').bind(row.doc_id,row.status==='running'?'failed':row.status,row.status==='running'?'Работа прервана':row.stage,row.status==='running'?'Генерация прервана при переносе. Запустите заново.':row.error,row.updated));
    statements.push(db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').bind('migration_imported',now()));await db.batch(statements);
    for(const file of packet.pdfs||[])if(/^[0-9a-f-]{36}$/.test(file.id))await runtime.BUCKET.put('pdf/'+file.id+'.pdf',Buffer.from(file.data,'base64'),{httpMetadata:{contentType:'application/pdf'}});
    return json({ok:true,documents:packet.documents.length,connections:packet.credentials.length});
   }
   if(action==='login')return json({ok:true});
   if(action==='logout')return json({ok:true});
   if(action==='connections/save'){const p=b.platform,input=b.credentials||{};if(!connectable.includes(p))throw Error('Неизвестная площадка.');const complete=p==='archive'?input.access&&input.secret:input.token;const old=await vault.read(p);await vault.save(p,complete?{...old,...input}:{...old,category:input.category??old.category,license:input.license??old.license});return json({ok:true,...await config()});}
   if(['connections/check','check-osf','check-zenodo'].includes(action)){const p=action==='check-osf'?'osf':action==='check-zenodo'?'zenodo':b.platform;if(!connectable.includes(p))throw Error('Неизвестная площадка.');const row=await db.prepare('SELECT encrypted FROM credential_settings WHERE platform=?').bind(p).first();if(!row)throw Error('Сначала сохраните ключ.');try{const credentials=await vault.read(p);const result=p==='gemini'?await checkGeminiKey(credentials.token||''):await checkConnection(p,credentials);if(!await vault.checked(p,row.encrypted))throw Error('Ключ изменён. Проверьте его заново.');return json({...result,...await config()});}catch(e:any){await vault.checked(p,row.encrypted,errorText(e));throw e;}}
   if(action==='import'){const source=await importArticle(b.url);const d={...source,id:crypto.randomUUID(),created:now(),language:b.language==='Русский'?'Русский':'English',author:'',license:'',report:null,reviewed:false,rights:false,researchContribution:''};await save(d);return json({doc:d});}
   if(action==='save'){const d=docSchema.parse(b.doc);await editable(d.id);if(d.report){const ids=new Set(d.report.sources.map(s=>s.id));if(ids.size!==d.report.sources.length||d.report.claims.some(c=>c.sourceIds.some(s=>!ids.has(s))))throw Error('Проверьте источники фактов.');}await save(d);return json({doc:d});}
   if(action==='clone'){const d=await getDoc(b.id);d.id=crypto.randomUUID();d.created=now();d.reviewed=false;d.report?.claims.forEach((c:any)=>c.reviewed=false);await save(d);return json({doc:d});}
   if(action==='delete'){await editable(b.id);await db.prepare('DELETE FROM documents WHERE id=?').bind(b.id).run();return json({ok:true});}
   if(action==='generate'){const d=await getDoc(b.id);if((await job(d.id))?.status==='running')return json({job:await job(d.id)},202);await editable(d.id);if(!(await vault.read('gemini')).token)throw Error('Сохраните ключ Gemini в «Подключениях».');await db.prepare('INSERT INTO generation_jobs(doc_id,status,stage,error,updated,phase,research,lease) VALUES(?,?,?,?,?,?,NULL,0) ON CONFLICT(doc_id) DO UPDATE SET status=excluded.status,stage=excluded.stage,error=NULL,updated=excluded.updated,phase=excluded.phase,research=NULL,lease=0').bind(d.id,'running','Ищем первичные источники…',null,now(),'research').run();return json({job:await job(d.id)},202);}
   if(action==='publish')return await publication(b);
  }
  if(req.method==='GET'){
   if(action==='status')return json(await config());
   if(action==='documents')return json({documents:(await db.prepare('SELECT data FROM documents ORDER BY updated DESC LIMIT 100').all()).results.map((r:any)=>JSON.parse(r.data))});
   if(action==='articles')return json({articles:await listArticles(Math.max(1,Math.min(21,Number(url.searchParams.get('page'))||1)))});
   if(action==='figshare-options'){const [categories,licenses]=await Promise.all([api('https://api.figshare.com/v2/categories'),api('https://api.figshare.com/v2/licenses')]);return json({categories,licenses});}
   const id=url.searchParams.get('id')||'',d=await getDoc(id);
   if(action==='export')return json({doc:d});
   if(action==='publications')return json({publications:(await db.prepare('SELECT * FROM publications WHERE doc_id=?').bind(d.id).all()).results.map((r:any)=>({...r,state:JSON.parse(r.state)}))});
   if(action==='pdf'){const bytes=await pdf(d);await putPdf(d,bytes);return new Response(new Uint8Array(bytes).buffer,{headers:{'Content-Type':'application/pdf','Cache-Control':'no-store','Content-Disposition':`${url.searchParams.has('download')?'attachment':'inline'}; filename="octane-report-${d.id}.pdf"`}});}
   if(action==='search-suggestions'){const html=d.report?.searchSuggestionsHtml;if(!html)return json({error:'Подсказки отсутствуют.'},404);return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src https://www.gstatic.com data:; sandbox allow-popups allow-popups-to-escape-sandbox"}});}
   if(action==='generation'){
    let current=await job(id);if(current?.status==='running'){
     if(current.lease&&current.lease<Date.now()){await db.prepare('UPDATE generation_jobs SET status=?,stage=?,error=?,lease=0 WHERE doc_id=? AND lease=?').bind('failed','Работа прервана','Запрос был прерван. Запустите генерацию заново.',id,current.lease).run();}
     else if(!current.lease){const lease=Date.now()+330000;const lock=await db.prepare('UPDATE generation_jobs SET lease=? WHERE doc_id=? AND status=? AND lease=0').bind(lease,id,'running').run();if(lock.meta.changes){try{const key=(await vault.read('gemini')).token;if(current.phase==='research'){const research=await researchGemini(d,key);await db.prepare('UPDATE generation_jobs SET research=?,phase=?,stage=?,lease=0,updated=? WHERE doc_id=? AND lease=?').bind(JSON.stringify(research),'format','Источники найдены. Готовим текст отчёта…',now(),id,lease).run();}else{const research=JSON.parse((await db.prepare('SELECT research FROM generation_jobs WHERE doc_id=?').bind(id).first()).research);const report=await generateGeminiReport(d,key,()=>{},research);d.report=report;d.reviewed=false;await db.batch([db.prepare('UPDATE documents SET data=?,updated=? WHERE id=?').bind(JSON.stringify(d),now(),id),db.prepare('UPDATE generation_jobs SET status=?,stage=?,error=NULL,research=NULL,lease=0,updated=? WHERE doc_id=? AND lease=?').bind('done','Отчёт подготовлен. Проверьте факты и источники.',now(),id,lease)]);}}catch(e:any){await db.prepare('UPDATE generation_jobs SET status=?,stage=?,error=?,lease=0,updated=? WHERE doc_id=? AND lease=?').bind('failed','Отчёт не создан',errorText(e),now(),id,lease).run();}}}
     current=await job(id);
    }
    return json({job:current,...(current?.status==='done'?{doc:await getDoc(id)}:{})});
   }
  }
  return json({error:'Не найдено.'},404);
 }catch(e:any){return json({error:errorText(e)},400);}
 async function publication(b:any){
  const d=await getDoc(b.id),p=b.platform;if(!platforms.includes(p))throw Error('Неизвестная площадка.');assertPublishable(d,p);const key=d.id+':'+p;const old=await db.prepare('SELECT * FROM publications WHERE key=?').bind(key).first();let state=old?JSON.parse(old.state):{};const credentials=await vault.read(p);
  if(b.phase==='reconcile'){if(!old)throw Error('Публикация не подготовлена.');state=await reconcile(p,credentials,state);await db.prepare('UPDATE publications SET status=?,state=?,error=NULL,updated=? WHERE key=?').bind(state.status,JSON.stringify(state),now(),key).run();return json({publication:{platform:p,status:state.status,state}});}
  if(old&&['published','queued'].includes(old.status))return json({publication:{platform:p,status:old.status,state}});
  if(old&&['preparing','publishing','failed'].includes(old.status))throw Error('Проверьте внешний статус. Повторная загрузка отключена.');
  if(!['prepare','publish'].includes(b.phase))throw Error('Неизвестное действие.');if(b.phase==='publish'&&old?.status!=='draft')throw Error('Сначала подготовьте черновик.');if(b.phase==='prepare'&&old?.status==='draft')return json({publication:{platform:p,status:'draft',state}});
  if(p==='archive'&&(!credentials.access||!credentials.secret)||p!=='archive'&&!credentials.token)throw Error('Сохраните ключ площадки.');
  if(p==='figshare'&&b.phase==='prepare'){const licenses=await api('https://api.figshare.com/v2/licenses');const license=licenses.find((l:any)=>l.value===Number(credentials.license)||l.id===Number(credentials.license));if(!license||!String(license.url).includes(d.license==='cc-by-sa-4.0'?'/by-sa/4.0':'/by/4.0'))throw Error('Лицензия Figshare должна совпадать с PDF.');}
  const status=b.phase==='prepare'?'preparing':'publishing';const lock=old?await db.prepare('UPDATE publications SET status=?,updated=? WHERE key=? AND status=?').bind(status,now(),key,'draft').run():await db.prepare('INSERT OR IGNORE INTO publications(key,doc_id,platform,status,state,updated) VALUES(?,?,?,?,?,?)').bind(key,d.id,p,status,'{}',now()).run();if(!lock.meta.changes)throw Error('Публикация уже обрабатывается.');
  try{const persist=async(s:any)=>{state=s;await db.prepare('UPDATE publications SET state=?,updated=? WHERE key=?').bind(JSON.stringify(s),now(),key).run();};const bytes=await pdf(d);await putPdf(d,bytes);if(b.phase==='prepare'){state=await prepare(p,d,bytes,credentials,state,persist);state.status='draft';}else state=await publish(p,d,bytes,credentials,state,persist);await db.prepare('UPDATE publications SET status=?,state=?,error=NULL,updated=? WHERE key=?').bind(state.status,JSON.stringify(state),now(),key).run();return json({publication:{platform:p,status:state.status,state}});}catch(e:any){await db.prepare('UPDATE publications SET status=?,error=?,updated=? WHERE key=?').bind('failed',errorText(e),now(),key).run();throw e;}
 }
}
