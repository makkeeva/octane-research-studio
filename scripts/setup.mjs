import fs from 'node:fs/promises';
import path from 'node:path';
import {parseEnv} from 'node:util';

// The owner enters the password locally. It is never echoed or logged.
async function secret(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Откройте интерактивный терминал Codespaces для настройки.');
  process.stdout.write(label);
  return new Promise((resolve, reject) => {
    let value = '';
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    function finish(error) {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(Boolean(wasRaw));
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
      value = '';
    }
    function onData(chunk) {
      for (const char of chunk) {
        if (char === '\u0003') { finish(new Error('Настройка отменена.')); return; }
        if (char === '\r' || char === '\n') { finish(); return; }
        if (char === '\u007f' || char === '\b') value = [...value].slice(0, -1).join('');
        else if (char >= ' ' && char !== '\u007f') value += char;
      }
    }
    process.stdin.on('data', onData);
  });
}

try {
  const target = path.resolve('.env');
  let contents;
  try { contents = await fs.readFile(target, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; contents = await fs.readFile('.env.example', 'utf8'); }
  const hasPassword = Boolean(parseEnv(contents).APP_PASSWORD);
  if (hasPassword) {
    console.log('В .env уже задан пароль. Существующие настройки сохранены.');
    process.exit(0);
  }
  let password = await secret('Придумайте пароль приложения (минимум 12 символов; ввод скрыт): ');
  if (password.length < 12) throw new Error('Нужно минимум 12 символов. Повторите npm run setup.');
  const confirmation = await secret('Повторите пароль: ');
  if (password !== confirmation) throw new Error('Пароли не совпадают. Повторите npm run setup.');
  // Restrict characters that Node dotenv cannot represent without ambiguity.
  if (/[\r\n"'`]/.test(password)) throw new Error('Используйте пароль без кавычек, обратной кавычки и переносов строк.');
  function put(key, value) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}\\s*=.*$`, 'm');
    contents = pattern.test(contents) ? contents.replace(pattern, () => line) : `${contents.trimEnd()}\n${line}\n`;
  }
  put('APP_PASSWORD', `"${password}"`);
  password = '';
  if (process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    put('HOST', '0.0.0.0');
    put('PUBLIC_URL', `https://${process.env.CODESPACE_NAME}-3000.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`);
  }
  const temporary = `${target}.setup-${process.pid}`;
  await fs.writeFile(temporary, contents, {mode: 0o600, flag: 'wx'});
  await fs.rename(temporary, target);
  console.log('Настройки сохранены. Запустите npm start; оставьте порт 3000 приватным.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
