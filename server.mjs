import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
const root=path.resolve('web');
const args=process.argv;
const port=Number(args[args.indexOf('--port')+1])||4173;
const types={'.wasm':'application/wasm','.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.woff2':'font/woff2','.woff':'font/woff','.png':'image/png','.jpg':'image/jpeg','.epub':'application/epub+zip','.pdf':'application/pdf'};
http.createServer((req,res)=>{
  let filename=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://x').pathname));
  if(!filename.startsWith(root+path.sep)&&filename!==root){res.writeHead(403).end();return;}
  if(filename===root)filename=path.join(root,'index.html');
  fs.readFile(filename,(err,b)=>{if(err){res.writeHead(404).end('Not found');return;}res.setHeader('Content-Type',types[path.extname(filename)]||'application/octet-stream');res.setHeader('Cache-Control','no-cache');res.end(b);});
}).listen(port,'0.0.0.0',()=>console.log('Lumi reader ready on '+port));
