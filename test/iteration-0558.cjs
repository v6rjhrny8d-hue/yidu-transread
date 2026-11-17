const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=path.resolve(__dirname,'../web');
const types={'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm'};
const server=http.createServer(async(req,res)=>{
 const file=path.resolve(web,'.'+new URL(req.url,'http://local').pathname.replace(/^\/$/,'/index.html'));
 if(!file.startsWith(web+path.sep))return res.writeHead(403).end();
 try{res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'}).end(await fs.readFile(file));}
 catch{res.end();}
});
let browser,count=0;
async function check(name,run){await run();console.log('PASS',name);count++;}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:390,height:844},locale:'zh-CN',isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForSelector('.main-dock');await page.waitForSelector('#startup-screen',{state:'detached'});
 await page.evaluate(async()=>{
  S.settings.reducedMotion=true;setTheme();
  const book={id:'detail-fixture',title:'Context fixture',language:'en',format:'txt',structureVersion:1,chapters:[{title:'One',paragraphs:['He works at a bank. She sat on the bank of the river. They left.']}]};
  await put('books',book);S.books.push(book);await openBook(book.id);
  S.settings.wordOnlineServices=['google','online'];S.settings.preferredDictionary='google';S.settings.wordOnlineFallback=false;S.settings.autoSpeakWord=false;
  window.calls=[];window.delayed=null;window.failDetail=false;window.failDictionary=false;
  const dictionary=[{word:'bank',phonetics:[{audio:'https://api.dictionaryapi.dev/media/pronunciations/en/bank-uk.mp3'},{audio:'https://api.dictionaryapi.dev/media/pronunciations/en/bank-us.mp3'}],meanings:[{partOfSpeech:'noun',definitions:[{definition:'An organization that holds money.',example:'She opened an account.'},{definition:'Land beside a river.',example:'We sat on the river bank.'},{definition:'<img src=x onerror=alert(1)>'}]}]}];
  net=async url=>{
   const request=new URL(url),query=request.searchParams.get('q');
   calls.push(query||request.pathname);
   if(request.hostname==='api.dictionaryapi.dev'){
    if(failDictionary)throw Error('dictionary unavailable');
    return JSON.stringify(dictionary.concat(Array.from({length:6},(_,entry)=>({meanings:[
     {partOfSpeech:entry?'verb':'noun',definitions:Array.from({length:5},(_,sense)=>({definition:`Sense ${entry}-${sense}`,example:`Example ${entry}-${sense}`}))}
    ]}))));
   }
   if(delayed&&query===delayed.text)return new Promise(resolve=>delayed.resolve=resolve);
   if(failDetail&&query.includes(' '))throw Error('network unavailable');
   return JSON.stringify([[[query==='bank'?'银行':'她坐在河岸上。']]]);
  };
 });
 const bank=page.locator('.original .word').filter({hasText:/^bank$/});
 await bank.nth(1).tap();await page.waitForFunction(()=>document.querySelector('.meaning')?.textContent==='银行');
 const context=page.locator('[data-action=word-detail]');
 await page.waitForFunction(()=>document.querySelector('#word-detail-dictionary')?.textContent.includes('Example 5-4'));
 await check('Google card loads all dictionary senses by default and sends no sentence on opening',async()=>{
  assert.deepEqual((await page.evaluate(()=>calls)).sort(),['/api/v2/entries/en/bank','bank']);
  assert.equal(await context.getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('.word-details button').count(),1);
  assert.equal(await page.locator('#word-detail-dictionary li').count(),33);
 });
 await context.tap();await page.waitForFunction(()=>document.querySelector('#word-detail-context')?.textContent.includes('河岸'));
 await check('The second occurrence sends its own sentence only, with the original visible',async()=>{
  assert.deepEqual(await page.evaluate(()=>calls.filter(q=>q.includes(' '))),['She sat on the bank of the river.']);
  assert.match(await page.locator('#word-detail-context').innerText(),/She sat on the bank of the river\.\n+她坐在河岸上。/);
  assert.equal(await page.locator('.meaning').innerText(),'银行');
 });
 await context.tap();assert.equal(await context.getAttribute('aria-expanded'),'false');await context.tap();
 await check('Closing and reopening context reuses its translation',async()=>assert.equal(await page.evaluate(()=>calls.length),3));
 await check('Additional senses and examples are source-labelled and rendered as plain text',async()=>{
  const detail=page.locator('#word-detail-dictionary');
  const value=await detail.innerText();assert.match(value,/ECDICT/);assert.match(value,/Free Dictionary/);assert.match(value,/Land beside a river/);
  assert.match(value,/<img src=x/);assert.equal(await detail.locator('img').count(),0);
  assert.equal(await page.locator('.word-actions button').count(),3);
 });
 await page.evaluate(()=>closeOverlay(true));await bank.nth(0).tap();
 await page.evaluate(()=>{window.failDetail=true;});await context.tap();await page.waitForFunction(()=>document.querySelector('#word-detail-context')?.textContent.includes('点击重试'));
 await check('Context failure leaves the base gloss readable and can be retried',async()=>{
  assert.equal(await page.locator('.meaning').innerText(),'银行');
  await page.evaluate(()=>{window.failDetail=false;});await context.tap();
  await page.waitForFunction(()=>document.querySelector('#word-detail-context')?.textContent.includes('河岸'));
  assert.equal(await page.evaluate(()=>calls.filter(call=>call==='He works at a bank.').length),2);
 });
 await page.evaluate(async()=>{
  await closeOverlay(true);onlineWordCache.delete('["context-google","en","zh-CN","She sat on the bank of the river."]');
  window.delayed={text:'She sat on the bank of the river.'};
 });
 await bank.nth(1).tap();await context.tap();await page.waitForFunction(()=>!!delayed.resolve);
 await page.evaluate(async()=>{await selectWordDictionary('builtin');delayed.resolve(JSON.stringify([[['OLD CONTEXT']]]));});
 await check('A pending Google result cannot reopen details after changing the dictionary',async()=>{
  assert.equal(await page.locator('.word-details').isVisible(),false);
  assert.equal(await page.evaluate(()=>S.word.sourceId),'builtin');
 });
 await page.evaluate(async()=>{
  await closeOverlay(true);onlineWordCache.delete('dictionary:bank');window.failDictionary=true;
 });
 await bank.nth(1).tap();
 await page.waitForSelector('[data-action=word-retry-dictionary]');
 await check('Automatic dictionary failure preserves ECDICT and can be retried in place',async()=>{
  assert.match(await page.locator('#word-detail-dictionary').innerText(),/ECDICT/);
  assert.equal(await page.locator('.meaning').innerText(),'银行');
  await page.evaluate(()=>{window.failDictionary=false;});
  await page.locator('[data-action=word-retry-dictionary]').tap();
  await page.waitForFunction(()=>document.querySelector('#word-detail-dictionary')?.textContent.includes('Example 5-4'));
 });
 await page.evaluate(async()=>{await closeOverlay(true);S.settings.wordOnlineServices=['google'];window.dictionaryCallCount=calls.filter(q=>q.endsWith('/bank')).length;});
 await bank.nth(1).tap();
 await check('Disabling Free Dictionary leaves offline senses visible without reading its cache or making a request',async()=>{
  const text=await page.locator('#word-detail-dictionary').innerText();
  assert.match(text,/ECDICT/);assert.doesNotMatch(text,/Free Dictionary/);
  assert.equal(await page.evaluate(()=>calls.filter(q=>q.endsWith('/bank')).length),await page.evaluate(()=>dictionaryCallCount));
 });
 await page.evaluate(()=>{S.settings.wordOnlineServices=['google','online'];});
 await page.evaluate(async()=>{
  await closeOverlay(true);wordPreferences();
 });
 const toggle=page.locator('[data-action=word-online-audio-fallback]');
 await check('Existing installs start with online fallback off and can save the switch',async()=>{
  assert.equal(await toggle.getAttribute('aria-pressed'),'false');await toggle.tap();
  await page.waitForFunction(async()=>(await getRecord('settings','main'))?.wordOnlineAudioFallback===true);
  assert.equal(await toggle.getAttribute('aria-pressed'),'true');
 });
 await page.evaluate(async()=>{
  await closeOverlay(true);
  window.steps=[];window.localPlays=false;window.localFailure=null;window.rejectOnline=false;
  playImportedAudio=async(text,token,options)=>{steps.push('local');localFailure=options.onFailure;return localPlays;};
  playSystemSpeech=async(text,token,options)=>{steps.push('system:'+options.accent);};
  playResourceAudio=async(url,token,options)=>{steps.push(url.split('/').at(-1));return !rejectOnline;};
  S.word={word:'bank',sourceId:'google',audioForm:'default'};S.settings.wordAccent='en-US';S.settings.wordSpeechSource='auto';
 });
 await check('Google word audio checks local first and takes the matching cached online accent when allowed',async()=>{
  assert.deepEqual(await page.evaluate(async()=>{await speakCurrentWord();return steps;}),['local','bank-us.mp3']);
  assert.equal(await page.evaluate(()=>calls.filter(s=>s.endsWith('/bank')).length),await page.evaluate(()=>dictionaryCallCount));
 });
 await check('Local success skips online and a late local error activates the chain once',async()=>{
  assert.deepEqual(await page.evaluate(async()=>{steps=[];localPlays=true;await speakCurrentWord();return steps;}),['local']);
  assert.deepEqual(await page.evaluate(async()=>{await localFailure();await localFailure();return steps;}),['local','bank-us.mp3']);
 });
 await check('Online playback failure uses the system voice and opt-out skips online entirely',async()=>{
  assert.deepEqual(await page.evaluate(async()=>{steps=[];localPlays=false;rejectOnline=true;await speakCurrentWord();return steps;}),['local','bank-us.mp3','system:en-US']);
  assert.deepEqual(await page.evaluate(async()=>{steps=[];S.settings.wordOnlineAudioFallback=false;await speakCurrentWord();return steps;}),['local','system:en-US']);
 });
 await check('System mode overrides the fallback setting',async()=>{
  assert.deepEqual(await page.evaluate(async()=>{steps=[];S.settings.wordOnlineAudioFallback=true;S.settings.wordSpeechSource='system';await speakCurrentWord();return steps;}),['system:en-US']);
 });
 await check('No browser runtime error',async()=>assert.deepEqual(errors,[]));
 console.log('TOTAL',count);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
