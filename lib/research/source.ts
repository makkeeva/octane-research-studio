import * as cheerio from 'cheerio';
export function octaneUrl(value:string) {
 const u=new URL(value); if(u.protocol!=='https:' || u.hostname!=='octane.rent' || u.username || u.password || u.port || !u.pathname.startsWith('/blog/')) throw new Error('Укажите HTTPS-ссылку из octane.rent/blog/.'); u.hash='';u.search='';return u.toString();
}
export async function octaneFetch(value:string) {
 let url=octaneUrl(value);for(let i=0;i<4;i++) {const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(25000),headers:{'User-Agent':'OctaneResearchStudio/1.0'}});if(r.status>=300&&r.status<400){url=octaneUrl(new URL(r.headers.get('location')||'',url).toString());continue;}if(!r.ok)throw new Error('Octane ответил HTTP '+r.status);const html=await r.text();if(html.length>3000000)throw new Error('Страница слишком большая.');return {html,url};}throw new Error('Слишком много перенаправлений.');
}
export async function listArticles(page=1) {
 const {html}=await octaneFetch(page===1?'https://octane.rent/blog/':`https://octane.rent/blog/page/${page}/`); const $=cheerio.load(html);const seen=new Set<string>();const rows:{url:string;title:string}[]=[];
 $('a[href]').each((_,el)=>{const a=$(el),href=a.attr('href')||'';try{const url=octaneUrl(new URL(href,'https://octane.rent').toString());const title=a.text().trim().replace(/\s+/g,' '); if(!seen.has(url)&&title.length>22&&!/\/blog\/(page|category)\//.test(url)&&new URL(url).pathname!=='/blog/'){seen.add(url);rows.push({url,title:title.slice(0,180)});}}catch{}});return rows.slice(0,40);
}
export async function importArticle(value:string) {
 const {html,url}=await octaneFetch(value);const $=cheerio.load(html);const title=$('h1').first().text().trim();let body=$('.entry-content').first();if(!body.length)body=$('.article-content, .post-content, article').first();body.find('script,style,nav,form,footer,.related-posts').remove();const original=body.text().replace(/[\t ]+/g,' ').replace(/\n\s*\n/g,'\n\n').trim();if(!title||original.length<300)throw new Error('Не удалось выделить статью. Вставьте её текст вручную.');return {sourceTitle:title,original:original.slice(0,50000),sourceUrl:url};
}
// --- Карта сайта (sitemap) для автосоздания черновиков ---
// Разбор тела sitemap или sitemap-index в список его ссылок <loc>.
export function parseSitemapLocs(xml:string):{isIndex:boolean;locs:string[]} {
 const $=cheerio.load(xml,{xml:true});const isIndex=$('sitemapindex').length>0;
 const locs=$('loc').map((_,el)=>$(el).text().trim()).get().filter(Boolean);
 return {isIndex,locs};
}
// Оставить только ссылки на статьи блога octane.rent (без индекса, пагинации, категорий и тегов).
export function articleUrlsFromLocs(locs:string[]):string[] {
 const out=new Set<string>();
 for(const loc of locs){try{const url=octaneUrl(loc);const path=new URL(url).pathname;if(path!=='/blog/'&&!/\/blog\/(page|category|tag|author)\//.test(path))out.add(url);}catch{}}
 return [...out];
}
// Выбрать новые статьи, которых ещё нет среди импортированных, не больше cap.
export function selectNewArticles(articleUrls:string[],existing:Set<string>|string[],cap:number):string[] {
 const have=existing instanceof Set?existing:new Set(existing);const fresh:string[]=[];
 for(const u of articleUrls){if(!have.has(u)){fresh.push(u);if(fresh.length>=cap)break;}}
 return fresh;
}
async function octaneXmlFetch(target:string):Promise<string> {
 let url=target;
 for(let i=0;i<4;i++){
  const u=new URL(url);
  if(u.protocol!=='https:'||u.hostname!=='octane.rent'||u.username||u.password||u.port)throw new Error('Ожидается HTTPS-адрес карты сайта octane.rent.');
  const r=await fetch(u.toString(),{redirect:'manual',signal:AbortSignal.timeout(25000),headers:{'User-Agent':'OctaneResearchStudio/1.0',Accept:'application/xml,text/xml'}});
  if(r.status>=300&&r.status<400){url=new URL(r.headers.get('location')||'',u).toString();continue;}
  if(!r.ok)throw new Error('Карта сайта Octane ответила HTTP '+r.status);
  const text=await r.text();if(text.length>5000000)throw new Error('Карта сайта слишком большая.');return text;
 }
 throw new Error('Слишком много перенаправлений карты сайта.');
}
// Собрать ссылки на статьи блога из карты сайта (поддерживает sitemap-index).
export async function listSitemapArticles(max=300):Promise<string[]> {
 const roots=['https://octane.rent/sitemap_index.xml','https://octane.rent/sitemap.xml','https://octane.rent/wp-sitemap.xml'];
 let rootXml='';let rootUrl='';
 for(const r of roots){try{rootXml=await octaneXmlFetch(r);rootUrl=r;break;}catch{}}
 if(!rootXml)throw new Error('Не удалось получить карту сайта octane.rent. Проверьте адрес sitemap.');
 const articles=new Set<string>();const visited=new Set<string>([rootUrl]);
 const queue:{xml:string;depth:number}[]=[{xml:rootXml,depth:0}];
 while(queue.length&&articles.size<max){
  const item=queue.shift()!;const {isIndex,locs}=parseSitemapLocs(item.xml);
  if(isIndex&&item.depth<2){
   for(const loc of locs){
    if(visited.size>=50)break;
    try{const u=new URL(loc);if(u.protocol==='https:'&&u.hostname==='octane.rent'&&/\.xml$/i.test(u.pathname)&&!visited.has(u.toString())){visited.add(u.toString());queue.push({xml:await octaneXmlFetch(u.toString()),depth:item.depth+1});}}catch{}
   }
  }else for(const u of articleUrlsFromLocs(locs))articles.add(u);
 }
 return [...articles].slice(0,max);
}
