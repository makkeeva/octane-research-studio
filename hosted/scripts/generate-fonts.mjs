import {readFileSync,writeFileSync} from 'node:fs';
writeFileSync('lib/fonts.ts',[['regularFont','DejaVuSans.ttf'],['boldFont','DejaVuSans-Bold.ttf']].map(([variable,file])=>'export const '+variable+'='+JSON.stringify(readFileSync('public/fonts/'+file).toString('base64'))+';').join('\n'));
