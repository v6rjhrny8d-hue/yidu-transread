const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = path.resolve(process.env.WEB_ROOT || path.join(__dirname,'../web'));
const types = {'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm'};
const server = http.createServer(async (req,res) => {
 const file = path.resolve(web,'.'+new URL(req.url,'http://local').pathname.replace(/^\/$/,'/index.html'));
 if(!file.startsWith(web+path.sep))return res.writeHead(403).end();
 try{const content=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'}).end(content);}
 catch{res.writeHead(404).end();}
});
let browser,count=0;
async function check(name,run){await run();console.log('PASS',name);count++;}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,locale:'zh-CN',isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForSelector('.main-dock');await page.waitForSelector('#startup-screen',{state:'detached'});
 await page.evaluate(async()=>{
  const book={id:'sentence-fixture',title:'Selection fixture',language:'en',format:'txt',structureVersion:1,chapters:[{title:'One',paragraphs:['He asked me lots of questions but never seemed to hear mine. I gradually pieced his story together from odd things he said. For instance, when he first caught sight of my plane, he asked me what it was.']},{title:'Two',paragraphs:['They continued along the river.']}]};
  await put('books',book);S.books.push(book);await openBook(book.id);
  S.settings.reducedMotion=false;setTheme();
  window.selectFixture=(start,end)=>{
   const words=document.querySelectorAll('#reader-scroll .original .word');
   getSelection().setBaseAndExtent(words[start],0,words[end],words[end].childNodes.length);
  };
 });
 await page.waitForSelector('#reader-scroll .original .word');
 await page.evaluate(()=>selectFixture(1,7));
 const button=page.locator('#sentence-action [data-action=save-sentence]');
 await button.waitFor();
 await page.evaluate(()=>{window.firstSelectionAction=document.querySelector('#sentence-action');});
 const originalBox=await button.boundingBox();
 await check('Extending or shrinking the selection keeps the same action and fixed screen position',async()=>{
  for(const [a,b] of [[1,12],[3,8],[2,11]]){
   await page.evaluate(([a,b])=>selectFixture(a,b),[a,b]);
   await page.waitForFunction(()=>selectionTimer===null);
   assert.equal(await page.evaluate(()=>document.querySelector('#sentence-action')===firstSelectionAction),true);
   assert.deepEqual(await button.boundingBox(),originalBox);
  }
  assert.equal(await page.locator('.sentence-action').count(),1);
 });
 await check('The glass surface has no moving or fading ancestor, and only the actual button receives taps',async()=>{
  const glass=await button.evaluate(el=>{
   const parent=getComputedStyle(el.parentElement),own=getComputedStyle(el);
   return [parent.transform,parent.opacity,parent.pointerEvents,own.pointerEvents,el.parentElement.getAnimations().length,own.backdropFilter];
  });
  assert.deepEqual(glass,['none','1','none','auto',0,'blur(10px) saturate(1.08)']);
 });
 await page.evaluate(()=>{
  const box=firstSelectionAction.querySelector('button').getBoundingClientRect();
  const fixture=document.createElement('div');fixture.id='glass-stripes';
  fixture.style.cssText=`position:fixed;z-index:69;pointer-events:none;top:${box.top-40}px;left:${box.left-40}px;width:${box.width+80}px;height:${box.height+80}px;background:repeating-linear-gradient(90deg,#080808 0 4px,#f8f8f8 4px 8px)`;
  document.body.append(fixture);
 });
 const palettes=await page.evaluate(()=>APP_PALETTES.map(p=>p.id));
 async function settledGlassColor(){
  await page.waitForFunction(()=>{
   const el=document.querySelector('#sentence-action button');
   const normalize=value=>value.replace(/\s/g,'').replace(/,\./g,',0.');
   return el&&normalize(getComputedStyle(el).backgroundColor)===normalize(getComputedStyle(document.body).getPropertyValue('--glass'));
  });
 }

 async function stripeSpan(){
  const {x,y,width}=await button.boundingBox();
  const image=await page.screenshot();
  return page.evaluate(async({png,x,y,width})=>{
   const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));
   const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
   const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
   const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();
   const row=context.getImageData(Math.ceil(x+25),Math.ceil(y+10),Math.floor(width-50),1).data;
   const samples=[];for(let i=0;i<row.length;i+=4)samples.push((row[i]+row[i+1]+row[i+2])/3);
   return Math.max(...samples)-Math.min(...samples);
  },{png:image.toString('base64'),x,y,width});
 }
 for(const palette of palettes)for(const appearance of ['light','dark']){
  await check(`${palette} ${appearance}: theme surface, readable accent, and actual blurred pixels`,async()=>{
   await page.evaluate(({palette,appearance})=>{Object.assign(S.settings,{palette,appearance,glassOpacity:70,glassBlur:0});setTheme();},{palette,appearance});
   await settledGlassColor();
   const sharp=await stripeSpan();
   await page.evaluate(()=>{S.settings.glassBlur=10;setTheme();});
   const blurred=await stripeSpan();
   const theme=await button.evaluate(el=>{
    const style=getComputedStyle(el),body=getComputedStyle(document.body);
    const probe=document.createElement('span');probe.style.color='var(--accent)';document.body.append(probe);
    const accent=getComputedStyle(probe).color;probe.remove();
    const paper=body.getPropertyValue('--paper').trim();
    const glass=style.backgroundColor.match(/[\d.]+/g).map(Number);
    const background=mixColor(paper,'#'+glass.slice(0,3).map(c=>c.toString(16).padStart(2,'0')).join(''),glass[3]);
    const ratio=contrast(body.getPropertyValue('--accent').trim(),background);
    return {ratio,foreground:style.color,accent,background:style.backgroundColor,glass:body.getPropertyValue('--glass').match(/[\d.]+/g).map(Number),blur:style.backdropFilter};
   });
   assert.deepEqual(theme.background.match(/[\d.]+/g).map(Number),theme.glass);
   assert.equal(theme.foreground,theme.accent);
   assert(theme.ratio>=4.5,`contrast ${theme.ratio}`);
   assert.equal(theme.blur,'blur(10px) saturate(1.08)');
   assert(sharp>=40&&blurred<sharp*.35,`stripe contrast: sharp=${sharp}, blurred=${blurred}`);
   assert.deepEqual(await button.boundingBox(),originalBox);
   console.log(`  pixels ${sharp.toFixed(1)} → ${blurred.toFixed(1)}, contrast ${theme.ratio.toFixed(2)}:1`);
  });
 }
 await check('System appearance and custom glass settings update the existing action',async()=>{
  await page.evaluate(()=>{Object.assign(S.settings,{appearance:'system',glassOpacity:52,glassBlur:17});Lumi.systemAppearance(false);setTheme();});
  await settledGlassColor();
  const light=await button.evaluate(el=>getComputedStyle(el).backgroundColor);
  await page.evaluate(()=>Lumi.systemAppearance(true));
  await settledGlassColor();
  const info=await button.evaluate(el=>[getComputedStyle(el).backgroundColor,getComputedStyle(el).backdropFilter,el.parentElement===firstSelectionAction]);
  assert.notEqual(info[0],light);assert.match(info[0],/0\.52\)$/);assert.equal(info[1],'blur(17px) saturate(1.08)');assert.equal(info[2],true);
 });
 await page.evaluate(()=>document.querySelector('#glass-stripes').remove());
 await check('Tapping the button saves the latest range exactly once and clears the action',async()=>{
  const expected=await page.evaluate(()=>getSelectionInfo().text);
  await button.tap();await button.waitFor({state:'detached'});
  const notes=await page.evaluate(async()=>(await getAll('notes')).filter(n=>n.bookId==='sentence-fixture'&&n.type==='sentence'));
  assert.equal(notes.length,1);assert.equal(notes[0].text,expected);
 });
 await check('A collapsed range or leaving the reader clears the action without leaving a ghost',async()=>{
  await page.evaluate(()=>selectFixture(1,4));await button.waitFor();
  await page.evaluate(()=>getSelection().removeAllRanges());await button.waitFor({state:'detached'});
  assert.equal(await page.locator('.sentence-action').count(),0);
  await page.evaluate(()=>selectFixture(1,4));await button.waitFor();
  await page.evaluate(()=>navigate('shelf'));await button.waitFor({state:'detached'});
  assert.equal(await page.locator('.sentence-action').count(),0);
 });
 await check('No browser runtime errors',async()=>assert.deepEqual(errors,[]));
 console.log('TOTAL',count);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
