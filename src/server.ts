import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync, writeFileSync, existsSync,chmodSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual,createHmac} from 'node:crypto';
import {docSchema,assertPublishable} from '../lib/research/validation';
import {importArticle,listArticles} from '../lib/research/source';
import {generateReport} from '../lib/research/ai';
import {generateGeminiReport,checkGeminiKey,GEMINI_MODEL} from '../lib/research/gemini';
import {makePdf} from '../lib/research/pdf';
import {platforms,prepare,publish,reconcile,api,checkConnection} from '../lib/research/publish';
import {CredentialStore} from '../lib/research/credentials';
import type {Doc} from '../lib/research/types';
import {requestPolicy} from '../lib/research/request-origin';
const password=process.env.APP_PASSWORD||'';
if(password.length<12)throw new Error('Set APP_PASSWORD (at least 12 characters) in .env before starting.');
const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
const root=fileURLToPath(new URL('.',import.meta.url));const dataDir=resolve(process.env.DATA_DIR||'.data');mkdirSync(join(dataDir,'pdf'),{recursive:true,mode:0o700});
const db=new DatabaseSync(join(dataDir,'studio.sqlite'));chmodSync(join(dataDir,'studio.sqlite'),0o600);db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
db.exec('CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,data TEXT NOT NULL,updated TEXT NOT NULL); CREATE TABLE IF NOT EXISTS publications(key TEXT PRIMARY KEY,doc_id TEXT NOT NULL,platform TEXT NOT NULL,status TEXT NOT NULL,state TEXT NOT NULL,error TEXT,updated TEXT NOT NULL);');
db.exec('CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);');
const credentialStore=new CredentialStore(db,password);
const connectable=[...platforms,'gemini'];
const sessionHash=(token:string)=>createHmac('sha256',password).update(token).digest('hex');
const generating=new Set<string>();const loginAttempts=new Map<string,{count:number;until:number}>();
const publicUrl=process.env.PUBLIC_URL?new URL(process.env.PUBLIC_URL).origin:'';const secure=publicUrl.startsWith('https://');
function json(res:ServerResponse,data:any,status=200){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function getDoc(id:string):Doc{const row:any=db.prepare('SELECT data FROM documents WHERE id=?').get(id);if(!row)throw new Error('Документ не найден.');return JSON.parse(row.data);}
function saveDoc(d:Doc){db.prepare('INSERT INTO documents(id,data,updated) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated').run(d.id,JSON.stringify(d),new Date().toISOString());}
function editable(id:string){if(generating.has(id))throw new Error('Для этого документа уже идёт генерация.');if(db.prepare('SELECT key FROM publications WHERE doc_id=? LIMIT 1').get(id))throw new Error('Публикация уже подготовлена. Для изменений создайте копию.');}
function creds(p:string,c:any={}){const stored=credentialStore.read(p);return {token:c.token||stored.token||(p==='gemini'?(process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY):process.env[p.toUpperCase()+'_TOKEN']),access:c.access||stored.access||process.env.ARCHIVE_ACCESS_KEY,secret:c.secret||stored.secret||process.env.ARCHIVE_SECRET_KEY,category:c.category||stored.category,license:c.license||stored.license};}
function connectionConfig(){const details=Object.fromEntries(connectable.map(p=>{const metadata=credentialStore.metadata(p);const envConfigured=p==='archive'?Boolean(process.env.ARCHIVE_ACCESS_KEY&&process.env.ARCHIVE_SECRET_KEY):Boolean((p==='gemini'?(process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY):process.env[p.toUpperCase()+'_TOKEN']));let defaults:any={};if(p==='figshare'&&metadata.saved){try{const saved=credentialStore.read(p);defaults={category:saved.category,license:saved.license};}catch{}}return [p,{...metadata,configured:metadata.saved||envConfigured,defaults}];}));const gemini=details.gemini.configured;return {ai:gemini||Boolean(process.env.OPENAI_API_KEY),aiProvider:gemini?'gemini':process.env.OPENAI_API_KEY?'openai':'gemini',model:gemini||!process.env.OPENAI_API_KEY?GEMINI_MODEL:process.env.OPENAI_MODEL||'gpt-4.1',connected:Object.fromEntries(connectable.map(p=>[p,details[p].configured])),connections:details};}
function session(req:IncomingMessage){const cookie=req.headers.cookie||'';const token=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('studio_session='))?.split('=')[1];if(!token||!/^[a-f0-9]{64}$/.test(token))return null;const hash=sessionHash(token);const row=db.prepare('SELECT expires FROM sessions WHERE token_hash=?').get(hash) as {expires:number}|undefined;return row&&row.expires>Date.now()?hash:null;}
async function body(req:IncomingMessage){let text='';for await(const chunk of req){text+=chunk;if(text.length>180000)throw new Error('Запрос слишком большой.');}return JSON.parse(text||'{}');}
const policy=requestPolicy(publicUrl,port);
createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','SAMEORIGIN');res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self' blob:; img-src 'self' data:; object-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
 let publicationKey:string|undefined;let ownsLock=false;
 try{
 const url=new URL(req.url||'/','http://localhost');const action=url.pathname.slice('/api/'.length);const method=req.method||'GET';
 if(url.pathname==='/api/health'&&method==='GET')return json(res,{ok:true});
 if(!policy.hostAllowed(req))return json(res,{error:'Host is not allowed. Set PUBLIC_URL to the application origin.'},403);
 if(method==='POST'&&!policy.postAllowed(req))return json(res,{error:'Недопустимый источник запроса.'},403);
 if(url.pathname==='/api/login'&&method==='POST'){
 const ip=req.socket.remoteAddress||'local';const attempt=loginAttempts.get(ip);if(attempt&&attempt.until>Date.now()&&attempt.count>=8)return json(res,{error:'Слишком много попыток. Повторите через 15 минут.'},429);
 const b=await body(req);const supplied=Buffer.from(String(b.password||''));const expected=Buffer.from(password);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){const current=attempt&&attempt.until>Date.now()?attempt:{count:0,until:Date.now()+15*60000};current.count++;loginAttempts.set(ip,current);return json(res,{error:'Неверный пароль.'},401);}
 loginAttempts.delete(ip);db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(token_hash,expires) VALUES(?,?)').run(sessionHash(token),Date.now()+12*3600000);res.setHeader('Set-Cookie',`studio_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure?'; Secure':''}`);return json(res,{ok:true});}
 if(url.pathname==='/api/health')return json(res,{ok:true});
 if(url.pathname.startsWith('/api/')){
 const logged=session(req);if(!logged)return json(res,{error:'Войдите в приложение.'},401);
 if(action==='logout'&&method==='POST'){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(logged);res.setHeader('Set-Cookie','studio_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,{ok:true});}
 if(method==='GET'){
 if(action==='status')return json(res,connectionConfig());
 if(action==='articles')return json(res,{articles:await listArticles(Math.max(1,Math.min(21,Number(url.searchParams.get('page'))||1)))});
 if(action==='documents')return json(res,{documents:db.prepare('SELECT data FROM documents ORDER BY updated DESC LIMIT 100').all().map((r:any)=>JSON.parse(r.data))});
 if(action==='publications'){const doc=getDoc(url.searchParams.get('id')||'');return json(res,{publications:db.prepare('SELECT * FROM publications WHERE doc_id=?').all(doc.id).map((r:any)=>({...r,state:JSON.parse(r.state)}))});}
 if(action==='search-suggestions'){const html=getDoc(url.searchParams.get('id')||'').report?.searchSuggestionsHtml;if(!html)return json(res,{error:'Поисковые подсказки отсутствуют.'},404);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src https://www.gstatic.com data:; frame-ancestors 'self'; sandbox allow-popups allow-popups-to-escape-sandbox"});return res.end(html);}
 if(action==='pdf'){const doc=getDoc(url.searchParams.get('id')||'');const pdf=await makePdf(doc);writeFileSync(join(dataDir,'pdf',doc.id+'.pdf'),pdf);res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'no-store','Content-Disposition':`${url.searchParams.has('download')?'attachment':'inline'}; filename="octane-report-${doc.id}.pdf"`});return res.end(pdf);}
 if(action==='figshare-options'){const [categories,licenses]=await Promise.all([api('https://api.figshare.com/v2/categories'),api('https://api.figshare.com/v2/licenses')]);return json(res,{categories,licenses});}
 if(action==='export'){const doc=getDoc(url.searchParams.get('id')||'');res.setHeader('Content-Disposition',`attachment; filename="octane-report-${doc.id}.json"`);return json(res,{doc});}
 }
 if(method==='POST'){
 const b=await body(req);
 if(action==='connections/save'){
  const p=b.platform;if(!connectable.includes(p))throw new Error('Неизвестная площадка.');
  const input=b.credentials||{};const complete=p==='archive'?Boolean(input.access&&input.secret):Boolean(input.token);
  const metadataOnly=p==='figshare'&&(input.category||input.license);if(!complete&&!metadataOnly)throw new Error(p==='archive'?'Введите оба ключа Internet Archive.':'Введите ключ для сохранения.');
  let merged=complete?input:creds(p,input);if(p==='figshare'&&complete){let defaults:any={};try{const old=credentialStore.read(p);defaults={category:old.category,license:old.license};}catch{}merged={...defaults,...input};}credentialStore.save(p,merged);return json(res,{ok:true,...connectionConfig()});
 }
 if(['connections/check','check-osf','check-zenodo'].includes(action)){
  const p=action==='check-osf'?'osf':action==='check-zenodo'?'zenodo':b.platform;if(action!=='connections/check'&&b.credentials?.token)credentialStore.save(p,{token:b.credentials.token});if(!connectable.includes(p))throw new Error('Неизвестная площадка.');
  const credentials=creds(p);if(!credentialStore.metadata(p).saved)credentialStore.save(p,credentials);const revision=credentialStore.revision(p);
  try{const result=p==='gemini'?await checkGeminiKey(credentials.token||''):await checkConnection(p,credentials);if(!credentialStore.checked(p,undefined,revision))throw new Error('Ключ изменён в другой вкладке. Проверьте подключение заново.');return json(res,{...result,...connectionConfig()});}
  catch(e:any){credentialStore.checked(p,e.message,revision);throw e;}
 }
 if(action==='import'){const source=await importArticle(b.url);const d:Doc={...source,id:crypto.randomUUID(),created:new Date().toISOString(),language:b.language==='Русский'?'Русский':'English',author:'',license:'',report:null,reviewed:false,rights:false,researchContribution:''};saveDoc(d);return json(res,{doc:d});}
 if(action==='save'){const d=docSchema.parse(b.doc);editable(d.id);if(d.report){const ids=new Set(d.report.sources.map(s=>s.id));if(ids.size!==d.report.sources.length||d.report.claims.some(c=>c.sourceIds.some(id=>!ids.has(id))))throw new Error('Проверьте уникальность идентификаторов источников и ссылки фактов.');}saveDoc(d);return json(res,{doc:d});}
 if(action==='clone'){const d=getDoc(b.id);d.id=crypto.randomUUID();d.created=new Date().toISOString();d.reviewed=false;d.report?.claims.forEach(c=>c.reviewed=false);saveDoc(d);return json(res,{doc:d});}
 if(action==='delete'){editable(b.id);db.prepare('DELETE FROM documents WHERE id=?').run(b.id);return json(res,{ok:true});}
 if(action==='generate'){const d=getDoc(b.id);editable(d.id);const geminiKey=creds('gemini').token;if(!geminiKey&&!process.env.OPENAI_API_KEY)throw new Error('Откройте «Подключения», вставьте API-ключ Gemini и нажмите «Сохранить и проверить».');generating.add(d.id);try{d.report=geminiKey?await generateGeminiReport(d,geminiKey):await generateReport(d,process.env.OPENAI_API_KEY!,process.env.OPENAI_MODEL||'gpt-4.1');d.reviewed=false;saveDoc(d);return json(res,{doc:d});}finally{generating.delete(d.id);}}
 if(action==='publish'){
 const d=getDoc(b.id);const p=b.platform;if(!platforms.includes(p))throw new Error('Неизвестная площадка.');assertPublishable(d,p);publicationKey=d.id+':'+p;
 const old:any=db.prepare('SELECT * FROM publications WHERE key=?').get(publicationKey);let state=old?JSON.parse(old.state):{};const credentials=creds(p,b.credentials);
 if(b.phase==='reconcile'){if(!old)throw new Error('Публикация ещё не подготовлена.');state=await reconcile(p,credentials,state);db.prepare('UPDATE publications SET status=?,state=?,error=NULL,updated=? WHERE key=?').run(state.status,JSON.stringify(state),new Date().toISOString(),publicationKey);return json(res,{publication:{platform:p,status:state.status,state}});}
 if(old&&['published','queued'].includes(old.status))return json(res,{publication:{platform:p,status:old.status,state}});
 if(old&&['preparing','publishing','failed'].includes(old.status))throw new Error('Нужна проверка статуса площадки. Повтор загрузки отключён, чтобы избежать дублей.');
 if(!['prepare','publish'].includes(b.phase))throw new Error('Неизвестное действие.');
 if(b.phase==='publish'&&old?.status!=='draft')throw new Error('Сначала подготовьте черновик.');
 if(b.phase==='prepare'&&old?.status==='draft')return json(res,{publication:{platform:p,status:'draft',state}});
 if(p==='archive'&&(!credentials.access||!credentials.secret))throw new Error('Введите оба S3-ключа Internet Archive.');if(p!=='archive'&&!credentials.token)throw new Error('Введите токен площадки.');
 if(p==='figshare'&&b.phase==='prepare'){const licenses=await api('https://api.figshare.com/v2/licenses');const selected=licenses.find((l:any)=>l.value===Number(credentials.license)||l.id===Number(credentials.license));const expected=d.license==='cc-by-sa-4.0'?'/by-sa/4.0':'/by/4.0';if(!selected||!String(selected.url).includes(expected))throw new Error('Лицензия Figshare должна совпадать с лицензией PDF (CC BY 4.0 или CC BY-SA 4.0).');}
 const now=new Date().toISOString();const status=b.phase==='prepare'?'preparing':'publishing';
 if(!old){const lock=db.prepare('INSERT OR IGNORE INTO publications(key,doc_id,platform,status,state,updated) VALUES(?,?,?,?,?,?)').run(publicationKey,d.id,p,status,'{}',now);if(!lock.changes)throw new Error('Уже обрабатывается.');}
 else {const lock=db.prepare('UPDATE publications SET status=?,updated=? WHERE key=? AND status=?').run(status,now,publicationKey,'draft');if(!lock.changes)throw new Error('Уже обрабатывается.');}ownsLock=true;
 const persist=async(s:any)=>{state=s;db.prepare('UPDATE publications SET state=?,updated=? WHERE key=?').run(JSON.stringify(s),new Date().toISOString(),publicationKey!);};
 const pdf=await makePdf(d);writeFileSync(join(dataDir,'pdf',d.id+'.pdf'),pdf);
 if(b.phase==='prepare'){state=await prepare(p,d,pdf,credentials,state,persist);state.status='draft';}else state=await publish(p,d,pdf,credentials,state,persist);
 db.prepare('UPDATE publications SET status=?,state=?,error=NULL,updated=? WHERE key=?').run(state.status,JSON.stringify(state),new Date().toISOString(),publicationKey);return json(res,{publication:{platform:p,status:state.status,state}});
 }
 }
 return json(res,{error:'Не найдено.'},404);
 }
 if(method!=='GET')return json(res,{error:'Недопустимый метод.'},405);
 const files:Record<string,string>={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};const file=files[url.pathname];if(!file)return json(res,{error:'Не найдено.'},404);const path=join(root,'public',file);const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};res.writeHead(200,{'Content-Type':mime[extname(path)],'Cache-Control':'no-store'});res.end(readFileSync(path));
 }catch(e:any){const message=e.name==='ZodError'?'Проверьте структуру и обязательные поля документа.':e.message||'Ошибка запроса.';if(publicationKey&&ownsLock)db.prepare("UPDATE publications SET status='failed',error=?,updated=? WHERE key=? AND status IN ('preparing','publishing')").run(message,new Date().toISOString(),publicationKey);json(res,{error:message},400);}
}).listen(port,host,()=>console.log(`Octane Research Studio running on http://${host}:${port}`));
