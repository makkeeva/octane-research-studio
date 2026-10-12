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
