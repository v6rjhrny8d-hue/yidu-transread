const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(process.env.WEB_ROOT||path.join(__dirname,'../web'));
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm'};
const server=http.createServer(async(req,res)=>{
 const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname.replace(/^\/$/,'/index.html'));
 if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
 try{const content=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'}).end(content);}
 catch{res.writeHead(404).end();}
});
let browser,count=0;
async function check(name,run){await run();console.log('PASS',name);count++;}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'zh-CN'});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForSelector('.main-dock');await page.waitForSelector('#startup-screen',{state:'detached'});
 await page.evaluate(async()=>{
  const book={id:'switch-fixture',title:'Switch fixture',language:'en',format:'txt',structureVersion:1,chapters:[{title:'One',paragraphs:['Water flows near the bank. The river runs past an old bridge.',...Array.from({length:25},()=> 'Another line of text keeps the chapter scrollable. A second sentence follows.')] }]};
  await put('books',book);S.books.push(book);await openBook(book.id);
  Object.assign(S.settings,{wordOnlineServices:['google'],wordOnlineFallback:false,preferredDictionary:'builtin',autoSpeakWord:false,reducedMotion:false});
  setTheme();
  window.targetWord=value=>[...document.querySelectorAll('#reader-scroll .original .word')].find(el=>el.textContent.toLowerCase()===value);
 });
 const pop=page.locator('.word-popover');
 const tap=word=>page.locator('#reader-scroll .original .word').filter({hasText:new RegExp('^'+word+'$','i')}).first().tap();
 await tap('water');
 await page.waitForFunction(()=>S.word?.word==='Water'&&S.word.entry&&!document.querySelector('.word-popover').getAnimations().length);
 await page.evaluate(()=>{window.originalCard=document.querySelector('.word-popover');window.originalScroll=originalCard.querySelector('.word-scroll');window.beforeScroll=document.querySelector('#reader-scroll').scrollTop;});
 const originalFrame=await pop.boundingBox();
 await check('Tapping a different visible word keeps the card and frame without another entrance',async()=>{
  await tap('bank');
  await page.waitForFunction(()=>S.word?.word==='bank'&&S.word.entry);
  assert.deepEqual(await pop.evaluate(el=>[el===originalCard,el.querySelector('.word-scroll')===originalScroll,el.getAnimations().length,el.querySelector('h2').textContent,el.getAttribute('aria-label')]),[true,true,0,'bank','bank的释义']);
  assert.deepEqual(await pop.boundingBox(),originalFrame);
  assert.equal(await page.evaluate(()=>document.querySelector('#reader-scroll').scrollTop),await page.evaluate(()=>beforeScroll));
  assert.deepEqual(await page.locator('.lookup-active').allTextContents(),['bank']);
 });
 await check('Delayed lookups cannot move the card or replace the latest word',async()=>{
  await page.evaluate(()=>{
   S.settings.preferredDictionary='google';window.requests={};
   translateText=text=>new Promise(resolve=>requests[text]=resolve);
  });
  await tap('river');
  await page.waitForFunction(()=>typeof requests.river==='function');
  assert.deepEqual(await pop.boundingBox(),originalFrame);
  await tap('bridge');await page.waitForFunction(()=>typeof requests.bridge==='function');
  await page.evaluate(()=>{requests.bridge('最新释义');requests.river('过期释义');});
  await page.waitForFunction(()=>document.querySelector('.word-popover .meaning').textContent==='最新释义');
  assert.deepEqual(await pop.boundingBox(),originalFrame);
  assert.equal(await pop.evaluate(el=>el===originalCard&&el.getAnimations().length===0),true);
  assert.equal(await page.locator('.word-popover .word-scroll').evaluate(el=>el.scrollTop),0);
 });
 await check('Switching dictionaries and dragging the reused header act on the latest word',async()=>{
  await page.evaluate(()=>selectWordDictionary('builtin'));
  await page.waitForFunction(()=>S.word?.sourceId==='builtin'&&S.word.entry&&S.word.dictionaryMotion?.phase==='idle');
  const cdp=await page.context().newCDPSession(page),title=await pop.locator('h2').boundingBox();
  const x=title.x+23,y=title.y+10;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-85}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>S.word?.expanded&&!S.word.cardMotion.frame);
  assert((await pop.boundingBox()).height>originalFrame.height);
  await page.setViewportSize({width:844,height:390});
  await page.waitForFunction(()=>{
   const card=document.querySelector('.word-popover'),bounds=wordCardBounds();
   return card&&card.getBoundingClientRect().left>220&&Math.abs(parseFloat(card.style.height)-bounds.available)<1;
  });
  const expanded=await pop.boundingBox();
  await page.evaluate(()=>{S.settings.preferredDictionary='builtin';});
  await tap('water');
  assert.equal(await pop.evaluate(el=>el===originalCard&&el.getAnimations().length===0),true);
  assert.deepEqual(await pop.boundingBox(),expanded);
  assert.equal(await page.evaluate(()=>S.word.expanded),true);
 });
 await check('Tapping the active word closes the card and clears its highlight',async()=>{
  await page.evaluate(()=>lookup(S.word.element));
  await pop.waitFor({state:'detached'});assert.equal(await page.locator('.lookup-active').count(),0);
  await page.setViewportSize({width:390,height:844});
 });
 await check('An actually covered word still uses placement or reader avoidance',async()=>{
  await page.evaluate(()=>{S.settings.reducedMotion=true;setTheme();return lookup(targetWord('water'));});
  await page.evaluate(()=>{
   const card=document.querySelector('.word-popover').getBoundingClientRect(),sc=document.querySelector('#reader-scroll');
   const covered=[...sc.querySelectorAll('.word')].find(el=>{const r=el.getBoundingClientRect();return r.top>card.top+60&&r.bottom<card.bottom-15;});
   if(!covered)throw Error('Fixture needs a covered word');
   return lookup(covered);
  });
  assert(await page.evaluate(()=>S.word.element.getBoundingClientRect().bottom<document.querySelector('.word-popover').getBoundingClientRect().top));
 });
 await check('No browser runtime errors',async()=>assert.deepEqual(errors,[]));
 console.log('TOTAL',count);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
