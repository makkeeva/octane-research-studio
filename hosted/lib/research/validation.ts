import {z} from 'zod';
import {octaneUrl} from './source';
export const reportSchema=z.object({title:z.string().min(5).max(300),abstract:z.string().max(4000),sections:z.array(z.object({heading:z.string().max(200),body:z.string().max(12000)})).min(1).max(15),sources:z.array(z.object({id:z.string().regex(/^S\d+$/),title:z.string().max(300),url:z.string().url().refine(u=>u.startsWith('https://')),publisher:z.string().max(200),date:z.string().max(80),accessed:z.string().max(80)})).min(1).max(30),claims:z.array(z.object({text:z.string().max(1500),sourceIds:z.array(z.string()),evidence:z.string().max(350),status:z.enum(['supported','unverified','conflict']),reviewed:z.boolean()})).max(60),limitations:z.string().max(4000),disclosure:z.string().max(2000),searchSuggestionsHtml:z.string().max(40000).optional()});
export const docSchema=z.object({id:z.string().uuid(),sourceUrl:z.string().transform(octaneUrl),sourceTitle:z.string().min(3).max(300),original:z.string().min(100).max(50000),language:z.enum(['English','Русский']),author:z.string().max(200),license:z.enum(['cc-by-4.0','cc-by-sa-4.0','']),report:reportSchema.nullable(),reviewed:z.boolean(),rights:z.boolean(),researchContribution:z.string().max(8000),created:z.string().max(80)});
export const disclosure='This analytical report is based on an Octane Rent blog article and publicly accessible sources. Generative AI may assist with drafting and source discovery. The named human author is responsible for fact checking and analysis. This document has not undergone peer review and is not an empirical study.';
export function reportStructureError(error:any):string {
 const fields:Record<string,string>={title:'Заголовок',abstract:'Аннотация',sections:'Разделы',heading:'Название раздела',body:'Текст раздела',sources:'Источники',publisher:'Издатель',date:'Дата',accessed:'Дата обращения',claims:'Факты',text:'Формулировка факта',sourceIds:'Ссылки факта',evidence:'Подтверждение факта',status:'Статус факта',reviewed:'Отметка проверки',limitations:'Ограничения',disclosure:'Раскрытие AI',id:'Номер источника',url:'Адрес источника'};
 const details=(Array.isArray(error?.issues)?error.issues:[]).slice(0,3).map((issue:any)=>{
  const path=(Array.isArray(issue.path)?issue.path:[]).map((part:any)=>typeof part==='number'&&Number.isInteger(part)&&part>=0&&part<1000?`№${part+1}`:fields[part]||'Поле').join(' / ');
  const max=issue.maximum,min=issue.minimum;
  const reason=issue.code==='too_big'&&issue.type==='string'&&Number.isInteger(max)&&max>0&&max<=50000?`длиннее ${max} символов`:issue.code==='too_big'&&issue.type==='array'&&Number.isInteger(max)&&max>=0&&max<=1000?`больше ${max} элементов`:issue.code==='too_small'&&Number.isInteger(min)&&min>=0&&min<=50000?'слишком короткое или пустое поле':issue.code==='invalid_type'?'неверный тип или отсутствующее поле':issue.code==='invalid_enum_value'?'недопустимое значение':'не соответствует формату';
  return `${path||'Отчёт'} — ${reason}`;
 });
 return `Модель вернула отчёт с неправильной структурой.${details.length?' '+details.join('; ')+'.':''} Результат не сохранён.`;
}
export function assertPublishable(doc:any,platform:string) {
 if(!doc.report)throw new Error('Сначала подготовьте отчёт.');
 if(doc.report.abstract.trim().length<30||doc.report.sections.length<2||doc.report.sections.some((s:any)=>s.body.trim().length<10)||doc.report.limitations.trim().length<20||!doc.report.claims.length)throw new Error('Заполните аннотацию, минимум два раздела, ограничения и реестр фактов.');
 if(!doc.author.trim()||!doc.license||!doc.rights)throw new Error('Укажите автора, лицензию и подтвердите права.');
 if(!doc.reviewed||doc.report.claims.some((c:any)=>c.status!=='supported'||!c.reviewed||!c.sourceIds.length||!c.evidence.trim()))throw new Error('Проверьте каждый факт и подтвердите готовность текста.');
 const ids=new Set(doc.report.sources.map((s:any)=>s.id));if(doc.report.claims.some((c:any)=>c.sourceIds.some((id:string)=>!ids.has(id))))throw new Error('У факта отсутствует источник.');
 if(new Set(doc.report.sources.map((s:any)=>s.id)).size!==doc.report.sources.length)throw new Error('Идентификаторы источников должны быть уникальными.');
 if(platform==='zenodo'&&doc.researchContribution.trim().length<200)throw new Error('Zenodo требует исследовательской основы. Опишите выполненный человеком самостоятельный анализ (минимум 200 символов); рекламный рерайт не подходит.');
}
