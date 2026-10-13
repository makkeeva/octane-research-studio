export async function secret(label) {
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('Откройте интерактивный терминал для ввода пароля.');
 process.stdout.write(label);
 return new Promise((resolve,reject)=>{
  let value='';const wasRaw=process.stdin.isRaw;process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');
  function finish(error){process.stdin.off('data',onData);process.stdin.setRawMode(Boolean(wasRaw));process.stdin.pause();process.stdout.write('\n');if(error)reject(error);else resolve(value);value='';}
  function onData(chunk){for(const char of chunk){if(char==='\u0003'){finish(Error('Ввод отменён.'));return;}if(char==='\r'||char==='\n'){finish();return;}if(char==='\u007f'||char==='\b')value=[...value].slice(0,-1).join('');else if(char>=' '&&char!=='\u007f')value+=char;}}
  process.stdin.on('data',onData);
 });
}
