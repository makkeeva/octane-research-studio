import {PDFDocument, rgb, PDFName, PDFString} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';


import {disclosure} from './validation';
import type {Doc} from './types';
export async function makePdf(doc:Doc,fontBytes:Uint8Array,boldBytes:Uint8Array) {
 if(!doc.report)throw new Error('Отчёт пока не создан.');const r=doc.report;
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit as any); 
 const font=await pdf.embedFont(fontBytes,{subset:true});const strong=await pdf.embedFont(boldBytes,{subset:true});
 pdf.setTitle(r.title);pdf.setAuthor(doc.author||'Author not specified');pdf.setSubject('Analytical report based on Octane Rent and public sources');pdf.setCreator('Octane Research Studio');
 let page=pdf.addPage([595.28,841.89]),y=780;const ink=rgb(.1,.13,.17),muted=rgb(.38,.42,.48),accent=rgb(.18,.35,.87);const width=483;
 const newPage=()=>{page=pdf.addPage([595.28,841.89]);y=780;};
 const safe=(s:string)=>s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[\u2011\u2013\u2014]/g,'-');
 function lines(text:string,size:number,f:any){const result:string[]=[];for(const para of safe(text).split('\n')){let line='';for(const word of para.split(/\s+/)){if(!word)continue;let chunks=[word];if(f.widthOfTextAtSize(word,size)>width){chunks=[];let chunk='';for(const ch of word){if(f.widthOfTextAtSize(chunk+ch,size)>width){chunks.push(chunk);chunk='';}chunk+=ch;}if(chunk)chunks.push(chunk);}for(const w of chunks){const next=line?line+' '+w:w;if(f.widthOfTextAtSize(next,size)>width){result.push(line);line=w;}else line=next;}}if(line)result.push(line);result.push('');}return result;}
 function text(value:string,size=10.5,isBold=false,color=ink){const f=isBold?strong:font;for(const line of lines(value,size,f)){if(y<65)newPage();if(line)page.drawText(line,{x:56,y,size,font:f,color});y-=size*1.55;} }
 function heading(t:string){if(y<130)newPage();y-=8;text(t,13,true);}
 function link(label:string,url:string){const f=font,size=9.3;for(const l of lines(label,size,f)){if(y<65)newPage();if(l){page.drawText(l,{x:56,y,size,font:f,color:accent});const annotation=pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[56,y-2,56+f.widthOfTextAtSize(l,size),y+size],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(url)}}));let annots=page.node.Annots();if(!annots){page.node.set(PDFName.of('Annots'),pdf.context.obj([]));annots=page.node.Annots();}annots?.push(annotation);}y-=15;}}
 text('OCTANE  /  RESEARCH STUDIO',9,true,accent);y-=13;text(r.title,23,true);text(`${doc.author||'Автор не указан'}  |  ${new Date().toISOString().slice(0,10)}  |  Analytical report`,9,false,muted);
 if(!doc.reviewed||r.claims.some(c=>!c.reviewed||c.status!=='supported'))text('DRAFT - HUMAN FACT CHECK REQUIRED / ЧЕРНОВИК',10,true,rgb(.7,.3,.1));
 heading(doc.language==='Русский'?'Аннотация':'Abstract');text(r.abstract);
 for(const s of r.sections){heading(s.heading);text(s.body);}
 if(doc.researchContribution.trim()){heading(doc.language==='Русский'?'Самостоятельный анализ автора':'Human author contribution');text(doc.researchContribution);}
 heading(doc.language==='Русский'?'Ограничения':'Limitations');text(r.limitations);
 heading(doc.language==='Русский'?'Происхождение и использование ИИ':'Provenance and AI disclosure');text(disclosure,9.3,false,muted);text('Original blog article: '+doc.sourceTitle,9.3);link(doc.sourceUrl,doc.sourceUrl);text('License: '+(doc.license||'Not selected - draft'),9.3);
 heading(doc.language==='Русский'?'Источники':'References');for(const s of r.sources){const ref=`[${s.id}] ${s.title}. ${s.publisher}. Published: ${s.date||'unknown'}. Accessed: ${s.accessed}.`;const needed=lines(ref,9.3,font).length*14.5+lines(s.url,9.3,font).length*15+8;if(y<65+needed)newPage();text(`[${s.id}] ${s.title}. ${s.publisher}. Published: ${s.date||'unknown'}. Accessed: ${s.accessed}.`,9.3);link(s.url,s.url);y-=5;}
 heading(doc.language==='Русский'?'Таблица проверки фактов':'Evidence register');for(const c of r.claims){text(c.text,9.3,true);text(`${c.sourceIds.map(id=>'['+id+']').join(' ')} | ${c.status} | Human reviewed: ${c.reviewed?'yes':'no'}`,8.5,false,muted);text(c.evidence,9.3);}
 const pages=pdf.getPages();pages.forEach((p,i)=>{p.drawLine({start:{x:56,y:45},end:{x:539,y:45},thickness:.5,color:rgb(.82,.85,.9)});p.drawText('OCTANE RESEARCH STUDIO',{x:56,y:29,size:7,font,color:muted});p.drawText(`${i+1} / ${pages.length}`,{x:506,y:29,size:7,font,color:muted});});return pdf.save();
}
