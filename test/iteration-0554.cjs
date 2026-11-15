/* Rendered dictionary/translation/selection workflow regression. No Android hardware claims. */
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(__dirname,'../web');
const server=http.createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://local').pathname).slice(1)||'index.html',file=name.startsWith('fixtures/')?path.resolve(__dirname,name):path.resolve(root,name);if(!file.startsWith(root+path.sep)&&!file.startsWith(path.join(__dirname,'fixtures')+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,data)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',({'.css':'text/css','.js':'text/javascript','.html':'text/html','.json':'application/json','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
let browser,page,cdp,count=0;const errors=[];async function check(name,run){await run();console.log('PASS',name);count++;}
async function settle(){await page.waitForFunction(()=>!document.getAnimations().some(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity));}
async function reply(text,fail=false){return page.evaluate(({text,fail})=>{const p=pending.shift();if(!p)throw Error('No pending translation');if(fail)p.reject(Error('offline'));else p.resolve(JSON.stringify([[[text]]]));},{text,fail});}
async function until(fn){await page.waitForFunction(fn);}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'zh-CN'});page.on('pageerror',e=>errors.push(e.message));cdp=await page.context().newCDPSession(page);
 page.setDefaultTimeout(12000);await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.main-dock');await page.waitForSelector('#startup-screen',{state:'detached'});

 await check('Fresh glass defaults are 10px blur and 70 percent fill',async()=>assert.deepEqual(await page.evaluate(()=>[glassValue('glassBlur'),glassValue('glassOpacity'),getComputedStyle(document.body).getPropertyValue('--glass-blur').trim(),getComputedStyle(document.body).getPropertyValue('--glass').trim().endsWith(',0.7)')]),[10,70,'10px',true]));
 await check('Null and invalid glass preferences use defaults while explicit zero is preserved',async()=>assert.deepEqual(await page.evaluate(()=>{S.settings.glassBlur=null;S.settings.glassOpacity='invalid';const a=[glassValue('glassBlur'),glassValue('glassOpacity')];S.settings.glassBlur=0;S.settings.glassOpacity=0;return [...a,glassValue('glassBlur'),glassValue('glassOpacity')];}),[10,70,0,0]));
 await page.evaluate(async()=>{S.settings.glassBlur=29;S.settings.glassOpacity=41;await saveSettings();});await page.reload();await page.waitForSelector('.main-dock');await page.waitForSelector('#startup-screen',{state:'detached'});
 await check('Existing manual glass choices survive restarting',async()=>assert.deepEqual(await page.evaluate(()=>[glassValue('glassBlur'),glassValue('glassOpacity')]),[29,41]));
 await page.evaluate(()=>customColors());await settle();await page.locator('[data-action=glass-reset]').click();
 await page.waitForFunction(()=>S.settings.glassBlur===10&&S.settings.glassOpacity===70);
 await check('Restore defaults updates both controls and their saved values',async()=>assert(await page.evaluate(async()=>{const v=await getRecord('settings','main');return v.glassBlur===10&&v.glassOpacity===70&&document.querySelector('#glassBlur-range').value==='10'&&document.querySelector('#glassOpacity-range').value==='70'&&document.querySelector('#glassBlur-value').textContent==='10px';})));
 await page.evaluate(async()=>{await closeOverlay(true);const b={id:'motion-0554',title:'Word motion',language:'en',format:'txt',structureVersion:1,readingModes:{verticalMode:'chapter',horizontalMode:'off'},chapters:[{title:'One',paragraphs:Array.from({length:16},()=>('Water flows in the valley. ').repeat(10))}]};await put('books',b);S.books.push(b);await openBook(b.id,0);S.settings.wordOnlineFallback=false;S.settings.wordOnlineServices=[];for(const id of ['a','b','c']){await put('resources',{id,name:'Dictionary '+id,kind:'dictionary',language:'en',enabled:true,format:'standard'});await put('resourceEntries',{id:resourceKey(id,'water'),packId:id,word:'water',translation:(id+' definition ').repeat(180),phonetic:'wɔːtə'});}await loadResourcePacks();S.settings.dictionaryOrder=['a','b','c','builtin'];S.settings.preferredDictionary='a';await saveSettings();});
 await until(()=>document.querySelector('#reader-scroll')?.chapterBuild?.done);
 async function lookup(){await page.evaluate(async()=>{await closeOverlay(true);document.querySelector('#reader-scroll').scrollTop=0;await window.lookup([...document.querySelectorAll('.word')].find(e=>e.textContent.toLowerCase()==='water'));});await settle();}
 async function touchStart(){const b=await page.locator('.word-scroll').boundingBox();globalThis.touchX=b.x+b.width*.52;globalThis.touchY=b.y+65;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchX,y:touchY}]});}
 async function move(dx,dy=0){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touchX+dx,y:touchY+dy}]});}
 async function end(cancel=false){await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});}
 async function swipe(dx){await touchStart();for(let i=1;i<=5;i++)await move(dx*i/5);await end();}
 async function quiet(){await settle();await page.waitForFunction(()=>!S.word||['idle','out-ready'].includes(S.word.dictionaryMotion?.phase||'idle'));}
 await lookup();await page.evaluate(()=>{window.scrollIdentity=document.querySelector('.word-scroll');window.cardIdentity=document.querySelector('.word-popover');window.cardTop=cardIdentity.getBoundingClientRect().top;});
 await touchStart();await move(-65);
 await check('Horizontal touch moves and fades the definition before the finger lifts',async()=>assert(await page.evaluate(()=>{const p=wordDictionaryPose(document.querySelector('.word-scroll'));return p.x<-45&&p.opacity<1&&S.word.sourceId==='a';})));
 await check('Horizontal definition dragging leaves the fixed card header and chapter in place',async()=>assert(await page.evaluate(()=>S.chapter===0&&Math.abs(cardIdentity.getBoundingClientRect().top-cardTop)<1)));
 await end();
 await check('Releasing a committed swipe starts a real finite transition',async()=>assert(await page.locator('.word-scroll').evaluate(e=>e.getAnimations().some(a=>a.effect.getTiming().duration>0&&a.effect.getTiming().iterations===1))));
 await until(()=>S.word.sourceId==='b');await quiet();
 await check('Next dictionary slides in and restores a clean resting pose without replacing the scroll node',async()=>assert(await page.evaluate(()=>S.word.entry.translation.startsWith('b definition')&&scrollIdentity===document.querySelector('.word-scroll')&&cardIdentity===document.querySelector('.word-popover')&&wordDictionaryPose(scrollIdentity).x===0&&scrollIdentity.getAnimations().length===0&&!scrollIdentity.style.willChange)));
 await page.evaluate(()=>{document.querySelector('.word-scroll').scrollTop=135;});await swipe(-125);await until(()=>S.word.sourceId==='c');await quiet();await swipe(125);await until(()=>S.word.sourceId==='b');await quiet();
 await check('Animated dictionary changes preserve each source scroll offset',async()=>assert.equal(await page.locator('.word-scroll').evaluate(e=>e.scrollTop),135));
 await touchStart();await move(-24);await end();await quiet();
 await check('A short horizontal pull rebounds without selecting another dictionary',async()=>assert(await page.evaluate(()=>S.word.sourceId==='b'&&Math.abs(wordDictionaryPose(scrollIdentity).x)<.1)));
 await touchStart();await move(-95);await end(true);await quiet();
 await check('Pointer cancellation rebounds and keeps the current definition',async()=>assert(await page.evaluate(()=>S.word.sourceId==='b'&&Math.abs(wordDictionaryPose(scrollIdentity).x)<.1)));
 await page.evaluate(async()=>selectWordDictionary('a'));await quiet();await touchStart();await move(120);
 await check('Pulling beyond the first dictionary applies edge resistance',async()=>assert(await page.evaluate(()=>{const x=wordDictionaryPose(scrollIdentity).x;return x>5&&x<40;})));
 await end();await quiet();await check('Edge release returns to the same dictionary',async()=>assert(await page.evaluate(()=>S.word.sourceId==='a'&&wordDictionaryPose(scrollIdentity).x===0)));
 await page.evaluate(()=>stepWordDictionary(1));await until(()=>S.word.sourceId==='b');
 await page.evaluate(()=>{const a=document.querySelector('.word-scroll').getAnimations()[0];if(a){a.pause();a.currentTime=55;}window.grabX=wordDictionaryPose(scrollIdentity).x;});await touchStart();await move(35);
 await check('Reversing during an entrance takes over the visible pose without jumping to the old target',async()=>assert(await page.evaluate(()=>{const x=wordDictionaryPose(scrollIdentity).x;return x>grabX+15&&x<grabX+60&&scrollIdentity.getAnimations().length===0;})));
 await move(115);await end();await until(()=>S.word.sourceId==='a');await quiet();
 await check('Reversed swipe settles on the intended previous source',async()=>assert(await page.evaluate(()=>S.word.sourceId==='a'&&S.word.entry.translation.startsWith('a definition'))));
 await page.evaluate(()=>{stepWordDictionary(1);stepWordDictionary(1);});await until(()=>S.word.sourceId==='c');await quiet();
 await check('Rapid consecutive changes settle on the latest intended source without stale animation',async()=>assert(await page.evaluate(()=>S.word.entry.translation.startsWith('c definition')&&scrollIdentity.getAnimations().length===0&&!S.word.dictionaryTargetId)));
 await page.evaluate(async()=>{window.realDictionaryEntry=dictionaryEntry;window.slowRequest=null;S.word.entries.delete('b');dictionaryEntry=(source,word)=>source.id==='b'?new Promise(resolve=>window.slowRequest=resolve):realDictionaryEntry(source,word);window.pendingSelection=selectWordDictionary('b');});await until(()=>S.word.sourceId==='b'&&!!slowRequest);await page.evaluate(async()=>{await selectWordDictionary('a');slowRequest({translation:'stale b result'});await pendingSelection;dictionaryEntry=realDictionaryEntry;});await quiet();
 await check('Late lookup results cannot replace a newer animated selection',async()=>assert(await page.evaluate(()=>S.word.sourceId==='a'&&S.word.entry.translation.startsWith('a definition'))));
 await page.evaluate(()=>{S.settings.reducedMotion=true;setTheme();});await page.evaluate(async()=>selectWordDictionary('b'));
 await check('Reduced motion switches directly with no lingering transform or animation',async()=>assert(await page.evaluate(()=>S.word.sourceId==='b'&&scrollIdentity.getAnimations().length===0&&wordDictionaryPose(scrollIdentity).x===0)));
 await page.evaluate(()=>{S.settings.reducedMotion=false;stepWordDictionary(1);});await page.setViewportSize({width:844,height:390});await quiet();
 await check('Rotation cancels stale slide work and keeps card bounds valid',async()=>assert(await page.evaluate(()=>{const r=cardIdentity.getBoundingClientRect();return r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&wordDictionaryPose(scrollIdentity).x===0;})));
 await page.evaluate(()=>{stepWordDictionary(-1);window.closedWord=S.word;return closeOverlay(true);});await page.waitForTimeout(450);
 await check('Closing during a switch cleans animations and cannot resurrect the card',async()=>assert(await page.evaluate(()=>!S.word&&!document.querySelector('.word-popover')&&closedWord.dictionaryMotion.el.getAnimations().length===0)));
 await page.setViewportSize({width:390,height:844});await lookup();await page.locator('.word-source').tap();await settle();await page.locator('[data-action=word-set-dictionary][data-id=c]').tap();await until(()=>S.word.sourceId==='c');await quiet();
 await check('Selecting a dictionary by name uses the same transition and retains one card',async()=>assert(await page.evaluate(()=>document.querySelectorAll('.word-popover').length===1&&S.word.entry.translation.startsWith('c definition'))));
 await page.screenshot({path:path.join(__dirname,'../../lookup-0554-rest.png')});
 await check('No uncaught browser errors',async()=>assert.deepEqual(errors,[]));console.log('TOTAL',count);
})().catch(e=>{console.error(e,errors);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
