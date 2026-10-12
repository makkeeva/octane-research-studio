import type {DatabaseSync} from 'node:sqlite';
import {reportStructureError} from './validation';
export class GenerationJobs{
 private running=new Set<string>();
 constructor(private db:DatabaseSync){
  db.exec('CREATE TABLE IF NOT EXISTS generation_jobs(doc_id TEXT PRIMARY KEY,status TEXT NOT NULL,stage TEXT NOT NULL,error TEXT,updated TEXT NOT NULL);');
  db.prepare("UPDATE generation_jobs SET status='failed',stage='Работа прервана',error=?,updated=? WHERE status='running'").run('Сервер был перезапущен во время генерации. Запустите её заново.',new Date().toISOString());
 }
 active(id:string){return this.running.has(id);}
 get(id:string){return this.db.prepare('SELECT status,stage,error,updated FROM generation_jobs WHERE doc_id=?').get(id)||null;}
 private mark(id:string,status:string,stage:string,error?:string){this.db.prepare('INSERT INTO generation_jobs(doc_id,status,stage,error,updated) VALUES(?,?,?,?,?) ON CONFLICT(doc_id) DO UPDATE SET status=excluded.status,stage=excluded.stage,error=excluded.error,updated=excluded.updated').run(id,status,stage,error||null,new Date().toISOString());}
 start<T>(id:string,generate:(progress:(stage:string)=>void)=>Promise<T>,commit:(value:T)=>void){
  if(this.active(id))return this.get(id);
  this.running.add(id);this.mark(id,'running','Начинаем поиск источников…');
  void (async()=>{try{const value=await generate(stage=>this.mark(id,'running',stage));commit(value);this.mark(id,'done','Отчёт подготовлен. Проверьте факты и источники.');}
   catch(e:any){const error=e.name==='ZodError'?reportStructureError(e):e.name==='TimeoutError'||e.name==='AbortError'?'Модель не ответила вовремя. Отчёт не сохранён; попробуйте позже.':e.message||'Генерация не выполнена.';this.mark(id,'failed','Отчёт не создан',error);}
   finally{this.running.delete(id);}})();
  return this.get(id);
 }
}
