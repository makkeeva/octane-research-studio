import {createHash} from 'node:crypto';
import type {Doc} from './types';
import {disclosure} from './validation';
export type State={id?:string;url?:string;fileId?:string;uploaded?:boolean;status?:string};
export const platforms=['archive','osf','figshare','zenodo'] as const;
export async function checkConnection(platform:string,credentials:any){
 if(platform==='osf')return checkOsfToken(credentials.token||'');
 if(platform==='zenodo')return checkZenodoToken(credentials.token||'');
 if(platform==='figshare'){
  const token=String(credentials.token||'').trim();if(!token)throw new Error('Введите Personal Access Token Figshare.');
  const records=await api('https://api.figshare.com/v2/account/articles?page_size=1',{method:'GET',headers:{Authorization:`token ${token}`,Accept:'application/json'}});
  if(!Array.isArray(records))throw new Error('Figshare не подтвердил авторизацию токена.');
  return {ok:true,message:'Figshare принял токен. Права на загрузку и публикацию проверяются при отправке PDF.'};
 }
 if(platform==='archive'){
  if(!credentials.access||!credentials.secret)throw new Error('Введите Access Key и Secret Key Internet Archive.');
  const identity=await api('https://archive.org/services/user.php?op=whoami',{method:'GET',headers:{Authorization:`LOW ${credentials.access}:${credentials.secret}`,Accept:'application/json','User-Agent':'OctaneResearchStudio/1.0 (+https://github.com/makkeeva/octane-research-studio)'}});
  const account=typeof identity==='string'?identity:identity?.success===true?identity.value?.username:undefined;
  if(typeof account!=='string'||!account.includes('@'))throw new Error('Internet Archive не подтвердил авторизацию ключей.');
  return {ok:true,message:'Internet Archive принял ключи. Права на загрузку проверяются при отправке PDF.'};
 }
 throw new Error('Неизвестная площадка.');
}
export async function checkZenodoToken(token:string){
 const value=token.trim();if(!value||value.length>8192)throw new Error('Введите Personal Access Token Zenodo.');
 const records=await api('https://zenodo.org/api/deposit/depositions?size=1',{method:'GET',headers:{Authorization:`Bearer ${value}`,Accept:'application/json'}});
 if(!Array.isArray(records))throw new Error('Zenodo не подтвердил авторизацию токена.');
 return {ok:true,message:'Zenodo принял токен. Права на загрузку и публикацию проверяются при отправке PDF.'};
}
export async function checkOsfToken(token:string){
 const value=token.trim();if(!value||value.length>8192)throw new Error('Введите Personal Access Token OSF.');
 const profile=await api('https://api.osf.io/v2/users/me/',{method:'GET',headers:{Authorization:`Bearer ${value}`,Accept:'application/vnd.api+json'}});
 if(profile.data?.type!=='users'||!profile.data?.id)throw new Error('OSF не подтвердил авторизацию токена.');
 return {ok:true,message:'OSF принял токен. Права на создание проекта и загрузку PDF проверяются при подготовке публикации.'};
}
// Честный идентифицирующий User-Agent: некоторые сервисы (например Zenodo)
// блокируют запросы с дефолтным UA рантайма как трафик ботов.
export const userAgent='OctaneResearchStudio/1.0 (+https://github.com/makkeeva/octane-research-studio)';
export async function api(url:string,options:RequestInit={}) {
 const headers={'User-Agent':userAgent,...(options.headers as Record<string,string>||{})};
 const r=await fetch(url,{...options,headers,redirect:'manual',signal:AbortSignal.timeout(60000)});
 const t=await r.text();
 if(!r.ok){
  // A network security page is not a response from the token validation API.
  // Never expose arbitrary provider bodies: they may contain secrets or HTML.
  if(new URL(url).hostname==='zenodo.org'&&r.status===403&&/text\/html/i.test(r.headers.get('content-type')||'')&&/unusual traffic from your network/i.test(t)){
   const reference=t.match(/Reference:\s*(?:<[^>]*>\s*)*([a-f0-9]{32})\b/i)?.[1];
   throw new Error('Zenodo HTTP 403: сервис ограничил запросы из сети сервера из-за необычного трафика. Проверка токена не выполнена; пересоздавать его не требуется. Обратитесь в поддержку Zenodo для снятия ограничения сети.'+(reference?' Код обращения: '+reference+'.':''));
  }
  // Для Figshare и OSF безопасно показать текстовое поле message/detail из JSON-ответа
  // (без тела целиком и без секретов) — это помогает понять причину отказа.
  const host=new URL(url).hostname;
  if(host==='api.figshare.com'||host==='api.osf.io'){let reason='';try{const j=JSON.parse(t);reason=typeof j?.message==='string'?j.message:typeof j?.errors?.[0]?.detail==='string'?j.errors[0].detail:'';}catch{}if(reason)throw new Error(`Сервис ответил HTTP ${r.status}: ${reason.replace(/\s+/g,' ').slice(0,200)}`);}
  throw new Error(`Сервис ответил HTTP ${r.status}. Проверьте доступ и ограничения аккаунта.`);
 }
 try{return t?JSON.parse(t):{};}catch{return {};}
}
function safeLink(url:string,hosts:string[]){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))throw new Error('Сервис вернул недопустимый адрес загрузки.');return u.toString();}
const payload=(data:any)=>JSON.stringify(data);
const description=(d:Doc)=>`${d.report!.abstract}\n\nOriginal source: ${d.sourceUrl}\n\n${disclosure}\n\nHuman author contribution: ${d.researchContribution||'Editorial analysis of public sources.'}\n\nReferences:\n${d.report!.sources.map(s=>s.title+' — '+s.url).join('\n')}`;
export async function prepare(platform:string,doc:Doc,pdf:Uint8Array,creds:any,state:State,save:(s:State)=>Promise<void>) {
 const filename='octane-report-'+doc.id+'.pdf';
 if(platform==='archive'){state.id='octane-report-'+doc.id;state.url='https://archive.org/details/'+state.id;state.uploaded=false;await save(state);return state;}
 const token=creds.token;if(!token)throw new Error('Введите API-токен выбранной площадки.');
 if(platform==='zenodo') {
 const base='https://zenodo.org/api/deposit/depositions';const h={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 const d=await api(base,{method:'POST',headers:h,body:'{}'});state.id=String(d.id);state.url=d.links.html;await save(state);
 await api(`${base}/${state.id}`,{method:'PUT',headers:h,body:payload({metadata:{upload_type:'publication',publication_type:'report',title:doc.report!.title,description:description(doc),creators:[{name:doc.author}],access_right:'open',license:doc.license,keywords:['transport','automotive','analytical report'],related_identifiers:[{identifier:doc.sourceUrl,relation:'isDerivedFrom',scheme:'url'}]}})});
 await api(safeLink(d.links.bucket,['zenodo.org'])+'/'+filename,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/pdf'},body:pdf as any});state.uploaded=true;await save(state);return state;
 }
 if(platform==='figshare') {
 const base='https://api.figshare.com/v2';const h={Authorization:'token '+token,'Content-Type':'application/json'};
 if(!Number.isInteger(Number(creds.category))||Number(creds.category)<1||!Number.isInteger(Number(creds.license))||Number(creds.license)<1)throw new Error('Выберите категорию и соответствующую лицензию Figshare.');
 const created=await api(base+'/account/articles',{method:'POST',headers:h,body:payload({title:doc.report!.title,description:description(doc),defined_type:'report',authors:[{name:doc.author}],categories:[Number(creds.category)],license:Number(creds.license),references:[doc.sourceUrl,...doc.report!.sources.map(s=>s.url)],tags:['automotive','transport','analytical report']})});
 const article=await api(safeLink(created.location,['api.figshare.com']),{headers:h});state.id=String(article.id);state.url='https://figshare.com/account/articles/'+state.id;await save(state);
 const f=await api(`${base}/account/articles/${state.id}/files`,{method:'POST',headers:h,body:payload({name:filename,size:pdf.length,md5:createHash('md5').update(pdf).digest('hex')})});
 const info=await api(safeLink(f.location,['api.figshare.com']),{headers:h});state.fileId=String(info.id);await save(state);
 const upload=safeLink(info.upload_url,['figshare.com']);const parts=await api(upload,{headers:{Authorization:'token '+token}});
 for(const part of parts.parts){await api(upload+'/'+part.partNo,{method:'PUT',headers:{Authorization:'token '+token,'Content-Type':'application/octet-stream'},body:pdf.slice(part.startOffset,part.endOffset+1) as any});}
 await api(`${base}/account/articles/${state.id}/files/${state.fileId}`,{method:'POST',headers:h});state.uploaded=true;await save(state);return state;
 }
 if(platform==='osf') {
 const base='https://api.osf.io/v2';const h={Authorization:`Bearer ${token}`,'Content-Type':'application/vnd.api+json'};
 const result=await api(base+'/nodes/',{method:'POST',headers:h,body:payload({data:{type:'nodes',attributes:{title:doc.report!.title,category:'project',description:description(doc),public:false}}})});state.id=result.data.id;state.url='https://osf.io/'+state.id+'/';await save(state);
 const providers=await api(`${base}/nodes/${state.id}/files/`,{headers:h});const provider=providers.data.find((p:any)=>p.attributes?.provider==='osfstorage'||p.id==='osfstorage');if(!provider?.links?.upload)throw new Error('OSF не вернул ссылку загрузки хранилища.');
 const u=new URL(safeLink(provider.links.upload,['files.osf.io']));u.searchParams.set('kind','file');u.searchParams.set('name',filename);
 await api(u.toString(),{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/pdf'},body:pdf as any});state.uploaded=true;await save(state);return state;
 }
 throw new Error('Неизвестная площадка.');
}
export async function publish(platform:string,doc:Doc,pdf:Uint8Array,creds:any,state:State,save:(s:State)=>Promise<void>) {
 if(!state.id)throw new Error('Сначала подготовьте публикацию.');const token=creds.token;
 if(platform==='archive'){
 if(!creds.access||!creds.secret)throw new Error('Введите Access Key и Secret Key Internet Archive.');
 const meta=(s:string)=>'uri('+encodeURIComponent(s)+')';const h:any={Authorization:`LOW ${creds.access}:${creds.secret}`,'Content-Type':'application/pdf','x-archive-auto-make-bucket':'1','x-archive-meta-mediatype':'texts','x-archive-meta-collection':'opensource','x-archive-meta-title':meta(doc.report!.title),'x-archive-meta-creator':meta(doc.author),'x-archive-meta-description':meta(description(doc)),'x-archive-meta-source':doc.sourceUrl,'x-archive-meta-licenseurl':'https://creativecommons.org/licenses/'+(doc.license==='cc-by-sa-4.0'?'by-sa':'by')+'/4.0/','x-archive-meta-language':doc.language==='Русский'?'rus':'eng','x-archive-queue-derive':'1'};
 let url=`https://s3.us.archive.org/${state.id}/octane-report-${doc.id}.pdf`;
 for(let i=0;i<4;i++){const r=await fetch(url,{method:'PUT',headers:h,body:pdf as any,redirect:'manual',signal:AbortSignal.timeout(60000)});if(r.status>=300&&r.status<400){url=safeLink(new URL(r.headers.get('location')||'',url).toString(),['archive.org']);continue;}if(!r.ok)throw new Error('Internet Archive HTTP '+r.status);state.status='queued';state.uploaded=true;await save(state);return state;}
 throw new Error('Internet Archive: слишком много перенаправлений.');
 }
 if(!token||!state.uploaded)throw new Error('Токен или загруженный PDF отсутствует.');
 if(platform==='zenodo'){const d=await api(`https://zenodo.org/api/deposit/depositions/${state.id}/actions/publish`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});state.url=d.links?.html||`https://zenodo.org/records/${state.id}`;}
 if(platform==='figshare'){await api(`https://api.figshare.com/v2/account/articles/${state.id}/publish`,{method:'POST',headers:{Authorization:'token '+token,'Content-Type':'application/json'}});const a=await api(`https://api.figshare.com/v2/articles/${state.id}`);state.url=a.url_public_html||`https://figshare.com/articles/report/_/${state.id}`;}
 if(platform==='osf'){const d=await api(`https://api.osf.io/v2/nodes/${state.id}/`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/vnd.api+json'},body:payload({data:{type:'nodes',id:state.id,attributes:{public:true}}})});if(!d.data.attributes.public)throw new Error('OSF не подтвердил публичный доступ.');}
 state.status='published';await save(state);return state;
}
export async function reconcile(platform:string,creds:any,state:State) {
 if(!state.id)throw new Error('Внешний ID не получен. Проверьте аккаунт вручную; автоматический повтор отключён, чтобы избежать дублей.');
 if(platform==='zenodo'){const d=await api(`https://zenodo.org/api/deposit/depositions/${state.id}`,{headers:{Authorization:`Bearer ${creds.token}`}});if(d.submitted){state.status='published';state.url=d.links.html;}}
 if(platform==='figshare'){try{const d=await api(`https://api.figshare.com/v2/articles/${state.id}`);state.status='published';state.url=d.url_public_html;}catch{}}
 if(platform==='osf'){const d=await api(`https://api.osf.io/v2/nodes/${state.id}/`,{headers:{Authorization:`Bearer ${creds.token}`}});if(d.data.attributes.public)state.status='published';}
 if(platform==='archive'){const d=await api(`https://archive.org/metadata/${state.id}`);if(d.files?.some((f:any)=>f.name?.endsWith('.pdf')))state.status='published';}
 if(state.status!=='published')throw new Error('Публичная публикация пока не подтверждена. Проверьте черновик или очередь на площадке; повтор загрузки не выполнялся.');return state;
}
