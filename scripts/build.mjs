import {build} from 'esbuild';
import {mkdir,copyFile,cp} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/server.ts'],bundle:true,platform:'node',target:'node24',format:'esm',outfile:'dist/server.mjs',packages:'external',sourcemap:false});
await build({entryPoints:['src/test-library.ts'],bundle:true,platform:'node',target:'node24',format:'esm',outfile:'dist/test-library.mjs',packages:'external'});
await cp('public','dist/public',{recursive:true});
await cp('fonts','dist/fonts',{recursive:true});
console.log('Build complete: dist/server.mjs');
