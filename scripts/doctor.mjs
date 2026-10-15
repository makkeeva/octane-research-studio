// Безопасная самодиагностика Octane Research Studio.
//
// Запускать ВНУТРИ контейнера, в папке проекта на ноутбуке:
//   docker compose exec studio node scripts/doctor.mjs
// Проверка модели Gemini (read-only, без генерации и без расхода квоты):
//   docker compose exec studio node scripts/doctor.mjs --check-gemini
//
// Скрипт только читает состояние: базу открывает в режиме readOnly, ничего
// не меняет и не удаляет. Он НЕ печатает пароль, ключи или токены — только
// их наличие, длину и уже сохранённые приложением безопасные тексты ошибок.
// Он отвечает на один вопрос: почему не идёт цепочка «генерация → PDF →
// публикация» — потому что три шага последовательны и ломается почти всегда
// генерация (нет ключа Gemini, кончилась квота/модель недоступна, либо данные
// не восстановлены и рабочее пространство пустое).
import {DatabaseSync} from 'node:sqlite';
import {scryptSync,createDecipheriv} from 'node:crypto';
import {readFileSync,existsSync,accessSync,constants} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const GEMINI_MODEL='gemini-2.5-flash-lite';
const lines=[];
const out=(symbol,text)=>lines.push(`${symbol} ${text}`);
const ok=t=>out('[ ok ]',t);
const warn=t=>out('[ ⚠ ]',t);
const bad=t=>out('[ ✗ ]',t);
const info=t=>out('[ i ]',t);

// Разрешаем окружение так же, как сервер: сначала process.env (их задаёт
// docker compose), затем значения из .env, если он есть рядом с проектом.
let fileEnv={};
try{if(existsSync(join(root,'.env')))fileEnv=parseEnv(readFileSync(join(root,'.env'),'utf8'));}catch{}
const env=key=>process.env[key]??fileEnv[key];

console.log('\nOctane Research Studio — самодиагностика\n'+'='.repeat(42));

// 1. Среда выполнения.
const node=process.versions.node;const major=Number(node.split('.')[0]);
if(major>=24)ok(`Node.js ${node} (требуется 24+).`);
else warn(`Node.js ${node}. Проект рассчитан на Node 24+ (нужен для node:sqlite). В Docker используется образ Node 24; прямой запуск "npm start" на старой Node не стартует.`);

// 2. Пароль приложения.
const password=env('APP_PASSWORD')||'';
if(!password)bad('APP_PASSWORD не задан. Сервер не стартует без него.');
else if(password.length<12)bad(`APP_PASSWORD слишком короткий (${password.length} символов, нужно не менее 12).`);
else ok(`APP_PASSWORD задан (${password.length} символов). Значение не выводится.`);

// 3. Папка данных и PDF.
const dataDir=resolve(root,env('DATA_DIR')||'.data');
const dbPath=join(dataDir,'studio.sqlite');
const pdfDir=join(dataDir,'pdf');
info(`DATA_DIR: ${dataDir}`);
const publicUrl=env('PUBLIC_URL');
if(publicUrl)ok(`PUBLIC_URL: ${publicUrl}`);
else warn('PUBLIC_URL не задан. Для локального Docker ожидается http://localhost:3001 — иначе проверка Origin может отклонять запросы.');

let dbExists=existsSync(dbPath);
if(!dbExists)bad(`База ${dbPath} не найдена. Рабочее пространство пустое: восстановление резервной копии не выполнено или не завершено.`);
if(existsSync(pdfDir)){try{accessSync(pdfDir,constants.W_OK);ok('Папка PDF существует и доступна для записи.');}catch{bad('Папка PDF есть, но недоступна для записи. PDF не сохранится.');}}
else warn('Папка PDF ещё не создана (появится при первом сохранении).');

// 4. Чтение базы (read-only) и состояние рабочего пространства.
let db=null;
const count=sql=>{try{return db.prepare(sql).get().n;}catch{return null;}};
if(dbExists){
 try{
  db=new DatabaseSync(dbPath,{readOnly:true});
  const docs=count('SELECT COUNT(*) n FROM documents');
  const reports=count("SELECT COUNT(*) n FROM documents WHERE json_extract(data,'$.report') IS NOT NULL");
  const pubs=count('SELECT COUNT(*) n FROM publications');
  const creds=count('SELECT COUNT(*) n FROM credential_settings');
  if(docs===0)bad('В базе нет документов. Либо копия не восстановлена, либо это новое пустое пространство.');
  else info(`Документов: ${docs}${reports!=null?`, из них с отчётом: ${reports}`:''}.`);
  if(pubs!=null)info(`Записей публикаций: ${pubs}.`);
  if(creds===0)warn('Нет сохранённых подключений. Нужно хотя бы подключить Gemini во вкладке «Подключения».');
  else info(`Сохранённых подключений: ${creds}.`);

  // 5. Проверка пароля через расшифровку подключений (без вывода секретов).
  // Если APP_PASSWORD изменён, сохранённые ключи не расшифруются — тогда в UI
  // «подключения пропали», а генерация падает на отсутствии ключа.
  const cryptoRow=(()=>{try{return db.prepare('SELECT salt FROM credential_crypto WHERE id=1').get();}catch{return null;}})();
  if(cryptoRow&&password){
   const key=scryptSync(password,Buffer.from(cryptoRow.salt,'base64'),32);
   let rows=[];try{rows=db.prepare('SELECT platform,encrypted,checked_at,last_error FROM credential_settings').all();}catch{}
   for(const row of rows){
    let decrypts=false;
    try{const d=JSON.parse(row.encrypted);const dec=createDecipheriv('aes-256-gcm',key,Buffer.from(d.iv,'base64'));dec.setAAD(Buffer.from(row.platform));dec.setAuthTag(Buffer.from(d.tag,'base64'));Buffer.concat([dec.update(Buffer.from(d.data,'base64')),dec.final()]);decrypts=true;}catch{}
    if(!decrypts)bad(`Подключение «${row.platform}» не расшифровывается текущим APP_PASSWORD. Вероятно, пароль изменён — верните прежний или сохраните ключ заново.`);
    else{const note=row.last_error?`последняя проверка с ошибкой: ${row.last_error}`:row.checked_at?`проверено ${row.checked_at}`:'ключ сохранён, read-only проверка не запускалась';ok(`Подключение «${row.platform}»: ${note}.`);}
   }
   key.fill(0);
  }

  // 6. Подключён ли AI для генерации.
  const geminiSaved=(()=>{try{return Boolean(db.prepare("SELECT 1 FROM credential_settings WHERE platform='gemini'").get());}catch{return false;}})();
  const geminiEnv=Boolean(env('GEMINI_API_KEY')||env('GOOGLE_API_KEY'));
  const openaiEnv=Boolean(env('OPENAI_API_KEY'));
  if(geminiSaved||geminiEnv)ok(`AI для генерации: Gemini ${GEMINI_MODEL}${geminiEnv&&!geminiSaved?' (ключ из окружения)':' (ключ сохранён в приложении)'}.`);
  else if(openaiEnv)warn('Ключа Gemini нет, но задан OPENAI_API_KEY — это отдельный платный API. Он не включается автоматически при ошибке Gemini.');
  else bad('AI не подключён: нет ключа Gemini. В интерфейсе висит баннер «AI пока не подключён», кнопка «Исследовать и написать» неактивна. Откройте «Подключения» и сохраните ключ из Google AI Studio.');

  // 7. Последние работы генерации — прямая причина сбоя.
  try{
   const jobs=db.prepare('SELECT doc_id,status,stage,error,updated FROM generation_jobs ORDER BY updated DESC LIMIT 5').all();
   if(!jobs.length)info('Записей о генерации ещё нет (ни одна не запускалась).');
   else{
    out('[ i ]','Последние работы генерации:');
    for(const j of jobs){const tag=j.status==='failed'?'✗':j.status==='done'?'ok':'…';lines.push(`        [${tag}] ${j.status} · ${j.stage}${j.error?` — ${j.error}`:''} (${j.updated})`);}
    const lastFailed=jobs.find(j=>j.status==='failed');
    if(lastFailed&&lastFailed.error)warn(`Текст ошибки последней неудачной генерации — это и есть точная причина: «${lastFailed.error}»`);
   }
  }catch{info('Таблицы generation_jobs ещё нет (генерация ни разу не запускалась).');}
 }catch(e){bad(`Не удалось прочитать базу: ${e.message}`);}
 finally{db?.close();}
}

// 8. Необязательная read-only проверка доступа к модели Gemini.
if(process.argv.includes('--check-gemini')){
 const key=(env('GEMINI_API_KEY')||env('GOOGLE_API_KEY')||'').trim();
 if(!key)warn('--check-gemini: ключ Gemini не задан в окружении, сетевую проверку пропускаю. (Ключ, сохранённый в приложении, здесь не читается ради безопасности.)');
 else{
  const url='https://generativelanguage.googleapis.com/v1beta/models/'+GEMINI_MODEL;
  try{
   const r=await fetch(url,{method:'GET',headers:{'x-goog-api-key':key,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
   if(r.ok){const m=await r.json();if(m.supportedGenerationMethods?.includes('generateContent'))ok('--check-gemini: доступ к модели подтверждён (GET, без генерации и без расхода квоты). Квота генерации/поиска проверяется только при реальном создании отчёта.');else warn('--check-gemini: модель ответила, но без метода generateContent.');}
   else{const hint=r.status===429?'квота исчерпана':r.status===404?'модель недоступна этому проекту':r.status===401||r.status===400?'ключ или проект неверные':r.status===403?'нет доступа к Gemini API в вашем регионе/проекте':'сервис временно недоступен';bad(`--check-gemini: Gemini HTTP ${r.status} — ${hint}.`);}
  }catch(e){bad(`--check-gemini: не удалось обратиться к Gemini (${e.name==='TimeoutError'?'таймаут':e.message}).`);}
 }
}else info('Для read-only проверки доступа к Gemini добавьте флаг --check-gemini (сеть, но без расхода квоты).');

console.log(lines.join('\n'));

// 9. Итоговый вывод.
console.log('\n'+'='.repeat(42)+'\nИтог');
const problems=lines.filter(l=>l.startsWith('[ ✗ ]'));
if(!problems.length)console.log('Явных проблем конфигурации не найдено. Если генерация всё равно не идёт — запустите её на одной статье и пришлите точный текст из красного блока под кнопкой «Исследовать и написать».');
else{console.log('Найдены проблемы — чините по порядку:');for(const p of problems)console.log('  • '+p.replace('[ ✗ ] ',''));}
console.log('');
