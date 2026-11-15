import {build} from 'esbuild';
import {copyFile,mkdir} from 'node:fs/promises';
await mkdir('web/assets/mdict',{recursive:true});
await build({entryPoints:['tools/resource-src/worker.mjs'],bundle:true,platform:'browser',target:'es2020',format:'iife',minify:true,outfile:'web/dictionary-worker.js',define:{'import.meta.url':'self.location.href'},external:['fs','path','crypto','node:fs','node:path'],legalComments:'eof'});
await build({entryPoints:['tools/resource-src/rich.mjs'],bundle:true,platform:'browser',target:'es2020',format:'iife',minify:true,outfile:'web/dictionary-rich.js',legalComments:'eof'});

