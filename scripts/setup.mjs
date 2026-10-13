import fs from 'node:fs/promises';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {secret} from './terminal-secret.mjs';

function put(contents, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}\\s*=.*$`, 'm');
  return pattern.test(contents) ? contents.replace(pattern, () => line) : `${contents.trimEnd()}\n${line}\n`;
}

export function configureLocalDocker(contents, port = '3001') {
  if (!/^\d+$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535) throw Error('STUDIO_PORT должен быть от 1 до 65535.');
  const password = parseEnv(contents).APP_PASSWORD;
  if (!password || password.length < 12) throw Error('Нужен пароль приложения минимум из 12 символов.');
  if (/[\r\n'`]/.test(password)) throw Error('Пароль содержит символы, несовместимые с Docker .env. Сохраните прежний пароль и настройте env_file вручную.');
  // Single quotes keep $ and # literal in Compose as well as Node's dotenv parser.
  contents = put(contents, 'APP_PASSWORD', `'${password}'`);
  contents = put(contents, 'STUDIO_PORT', String(Number(port)));
  contents = put(contents, 'PORT', '3000');
  contents = put(contents, 'HOST', '0.0.0.0');
  contents = put(contents, 'PUBLIC_URL', `http://localhost:${Number(port)}`);
  return contents;
}

async function main() {
  const target = path.resolve('.env');
  const localDocker = process.argv.includes('--docker-local');
  let contents;
  try { contents = await fs.readFile(target, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; contents = await fs.readFile('.env.example', 'utf8'); }
  const hasPassword = Boolean(parseEnv(contents).APP_PASSWORD);
  if (!hasPassword && process.argv.includes('--existing-data')) throw Error('В томе уже есть данные, но прежний APP_PASSWORD отсутствует. Восстановите прежний .env перед запуском; новый пароль не откроет сохранённые ключи.');
  if (hasPassword && !localDocker) {
    console.log('В .env уже задан пароль. Существующие настройки сохранены.');
    return;
  }
  if (!hasPassword) {
    let password = await secret('Придумайте пароль приложения (минимум 12 символов; ввод скрыт): ');
    if (password.length < 12) throw Error('Нужно минимум 12 символов. Повторите настройку.');
    const confirmation = await secret('Повторите пароль: ');
    if (password !== confirmation) throw Error('Пароли не совпадают. Повторите настройку.');
    if (/[\r\n"'`]/.test(password)) throw Error('Используйте пароль без кавычек, обратной кавычки и переносов строк.');
    contents = put(contents, 'APP_PASSWORD', `'${password}'`);
    password = '';
  }
  if (localDocker) {
    contents = configureLocalDocker(contents, process.env.STUDIO_PORT || parseEnv(contents).STUDIO_PORT || '3001');
  } else if (process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    contents = put(contents, 'HOST', '0.0.0.0');
    contents = put(contents, 'PUBLIC_URL', `https://${process.env.CODESPACE_NAME}-3000.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`);
  }
  const temporary = `${target}.setup-${process.pid}`;
  await fs.writeFile(temporary, contents, {mode: 0o600, flag: 'wx'});
  await fs.rename(temporary, target);
  console.log(localDocker ? `Настройки сохранены. PUBLIC_URL=${parseEnv(contents).PUBLIC_URL}. Прежний пароль и ключи сохранены.` : 'Настройки сохранены. Запустите npm start; оставьте порт 3000 приватным.');
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
