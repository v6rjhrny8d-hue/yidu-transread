/* Real Chromium touch input and layout. Run with PLAYWRIGHT_MODULE pointing
 * to an installed Playwright module, or install Playwright locally first.
 * This checks browser event ownership; it does not measure Android hardware. */
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../web'),before=process.env.TRANSREAD_BEFORE_ROOT;
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'};
const server=http.createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://local').pathname),relative=name==='/'?'index.html':name.slice(1);let p=path.resolve(root,relative);if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return;}if(before&&['index.html','app.js','motion.js','style.css'].includes(relative))p=path.resolve(before,relative);fs.readFile(p,(err,data)=>{if(err)res.writeHead(404).end();else{res.setHeader('Content-Type',mime[path.extname(p)]||'application/octet-stream');res.end(data);}});});
let browser,page,cdp,passed=0,failed=0;
async function check(name,fn){try{await fn();passed++;console.log('PASS',name);}catch(e){failed++;console.error('FAIL',name,'—',e.message);}}
async function until(fn){for(let i=0;i<250;i++){if(await page.evaluate(fn))return;await page.waitForTimeout(24);}throw Error('Condition did not become true: '+fn.toString());}
async function ready(fn){await page.evaluate(()=>closeOverlay(true));await page.evaluate(fn);await page.waitForTimeout(300);await page.evaluate(()=>{window.touchEvents=[];window.controlActions=[];window.guideScrollWrites=0;});}
async function touch(type,points){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map((p,i)=>({x:p.x,y:p.y,id:p.id??i,radiusX:2,radiusY:2,force:1}))});}
async function swipe(x,y,dy,{tail=false,interval=16,hold=0,steps=6}={}){await touch('touchStart',[{x,y}]);for(let i=1;i<=steps;i++){await page.waitForTimeout(interval);await touch('touchMove',[{x,y:y+dy*i/steps}]);}if(tail){await page.waitForTimeout(24);await touch('touchMove',[{x,y:y+dy+Math.sign(dy)}]);}if(hold)await page.waitForTimeout(hold);await touch('touchEnd',[]);}
async function point(selector){return page.locator(selector).first().evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page=await context.newPage();cdp=await context.newCDPSession(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.hero-book');await page.waitForSelector('#startup-screen',{state:'detached'});


 const E='TransReadExperience';await page.evaluate(async()=>{await setAppLanguage('zh-CN');closeOverlay(true);});
 const settle=()=>page.waitForTimeout(440);
 await page.evaluate(()=>openBook('little-prince',2));await settle();
 await page.evaluate(()=>themes());await settle();
 await check('Theme removes custom color entry and has two bottom segments',async()=>{assert.equal(await page.locator('.theme-settings-sheet [data-action=custom-colors]').count(),0);assert.equal(await page.locator('.theme-settings-sheet [role=tab]').count(),2);});
 await page.locator('[data-action=theme-tab][data-tab=sliding]').click();await settle();await page.screenshot({path:'/tmp/transread-0523-theme.png'});
 await page.locator('[data-action=reading-style-menu][data-axis=vertical]').click();await settle();
 await check('Style menu is a bottom sheet with conflict explanation',async()=>{assert.equal(await page.locator('#overlay-root .theme-settings-sheet').count(),1);assert.equal(await page.locator('.secondary-panel [data-mode=continuous]').isDisabled(),true);assert.match(await page.locator('.secondary-panel [data-mode=continuous]').innerText(),/左右/);const r=await page.locator('.secondary-panel').boundingBox();assert(r.x>=9&&r.y>=9&&r.x+r.width<=391&&r.y+r.height<=845);});
 await page.evaluate(()=>Lumi.back());await settle();await check('Back closes only child and preserves theme panel',async()=>{assert.equal(await page.locator('.secondary-panel').count(),0);assert.equal(await page.locator('.theme-settings-sheet').count(),1);});
 await page.evaluate(()=>{closeOverlay(true);S.settings.verticalMode='off';S.settings.horizontalMode='slide';renderReader();});await page.waitForTimeout(2000);
 await check('Vertical off lays out genuine horizontal screen pages',async()=>{const v=await page.evaluate(()=>{const p=TransReadExperience.reading.paged;return {count:p.count,height:p.article.clientHeight,screen:p.sc.clientHeight,sw:p.article.scrollWidth,width:p.step,paras:p.sc.querySelectorAll('.para').length,total:currentChapter().paragraphs.length};});assert(v.count>2&&v.sw>v.width*2&&v.height<v.screen&&v.paras===v.total,JSON.stringify(v));});
 await page.evaluate(()=>TransReadExperience.reading.turnPage(1));await settle();
 await check('Page movement advances content without vertical scroll',async()=>{const v=await page.evaluate(()=>({index:TransReadExperience.reading.paged.index,top:$('#reader-scroll').scrollTop,word:S.book.position.paragraph}));assert.equal(v.index,1);assert.equal(v.top,0);assert(Number.isInteger(v.word));});
 const anchor=await page.evaluate(()=>{savePosition();return {...S.book.position};});
 await page.setViewportSize({width:844,height:390});await settle();
 await check('Rotation repaginates around the original word',async()=>{const v=await page.evaluate(()=>{savePosition();return {p:S.book.position,step:TransReadExperience.reading.paged.step};});assert.equal(v.step,844);assert(Math.abs(v.p.paragraph-anchor.paragraph)<=1,JSON.stringify({v,anchor}));});
 await page.screenshot({path:'/tmp/transread-0523-pages.png'});
 await page.setViewportSize({width:390,height:844});await settle();
 await page.evaluate(()=>{S.settings.verticalMode='continuous';S.settings.horizontalMode='off';S.chapter=0;renderReader();});await page.waitForTimeout(1800);
 await check('Continuous mode joins adjacent chapters in one native viewport',async()=>{const v=await page.evaluate(()=>({blocks:TransReadExperience.reading.stream.blocks.length,overflow:getComputedStyle($('#reader-scroll')).overflowY,chapters:[...document.querySelectorAll('.stream-chapter')].map(e=>Number(e.dataset.chapter))}));assert(v.blocks>=1&&v.blocks<=5&&v.overflow==='auto',JSON.stringify(v));});
 await page.evaluate(()=>{const s=TransReadExperience.reading.stream;s.sc.scrollTop=s.sc.scrollHeight;});await page.waitForTimeout(1800);await page.evaluate(()=>{const s=TransReadExperience.reading.stream;const second=s.blocks[1];if(second)s.sc.scrollTop=second.offsetTop;});await page.waitForTimeout(900);
 await check('Continuous chapter crossing updates active chapter and bounded DOM',async()=>{const v=await page.evaluate(()=>({chapter:S.chapter,blocks:TransReadExperience.reading.stream.blocks.length,build:$('#reader-scroll').chapterBuild.index}));assert(v.chapter>=1&&v.chapter===v.build&&v.blocks<=5,JSON.stringify(v));});
 const originalBook=await page.evaluate(()=>S.book.id);
 await page.evaluate(()=>{const book={id:'short-stream-fixture',title:'Short chapters',language:'en',chapters:Array.from({length:20},(_,i)=>({title:'Chapter '+i,paragraphs:['A very short chapter '+i+'.']})),created:Date.now()};S.books.push(book);S.book=book;S.chapter=0;renderReader();});await page.waitForTimeout(800);
 for(let i=0;i<8;i++){await page.evaluate(()=>{const s=TransReadExperience.reading.stream;s.sc.scrollTop=s.sc.scrollHeight;});await page.waitForTimeout(180);}
 await check('Short-chapter continuous scrolling advances while retaining only five blocks',async()=>{const v=await page.evaluate(()=>({chapter:S.chapter,blocks:TransReadExperience.reading.stream.blocks.length,panes:chapterPanes.size}));assert(v.chapter>=5&&v.blocks<=5&&v.panes<=5,JSON.stringify(v));});
 await check('Continuous sentence selection retains its chapter-local paragraph index',async()=>{const v=await page.evaluate(()=>{const s=TransReadExperience.reading.stream,original=s.active.querySelector('.original'),range=document.createRange();range.selectNodeContents(original);getSelection().removeAllRanges();getSelection().addRange(range);const info=getSelectionInfo();getSelection().removeAllRanges();return {index:info?.index,chapter:S.chapter};});assert.equal(v.index,0);assert(v.chapter>=5);});
 await page.evaluate(id=>{S.book=S.books.find(b=>b.id===id);S.chapter=2;S.settings.verticalMode='off';S.settings.horizontalMode='slide';renderReader();},originalBook);await page.waitForTimeout(1600);
 await page.evaluate(()=>{const sc=$('#reader-scroll'),n=currentChapter().paragraphs.length-1;const tag={id:'paged-tag-fixture',bookId:S.book.id,chapter:S.chapter,paragraph:n,offset:0,quote:'Tagged text',created:Date.now()};S.readingTags.push(tag);sc.readerTagTarget=tag;restoreReaderPosition(sc,{paragraph:n});applyReadingTagTarget(sc);});await settle();
 await check('A reading tag can seek and display on a later horizontal page',async()=>{const v=await page.evaluate(()=>{const marker=$('.paged-tag-marker'),b=marker?.getBoundingClientRect();return {page:TransReadExperience.reading.paged.index,marker:!!marker,top:b?.top,left:b?.left};});assert(v.page>0&&v.marker&&v.top>=0&&v.top<844&&v.left>=0,JSON.stringify(v));});
 await page.evaluate(()=>{S.readingTags=S.readingTags.filter(t=>t.id!=='paged-tag-fixture');});
 await check('All twelve navigation combinations have the specified compatibility',async()=>{const v=await page.evaluate(()=>['continuous','chapter','off'].flatMap(v=>['off','slide','fade','curl'].map(h=>TransReadExperience.reading.compatibility(v,h))));assert.deepEqual(v,[true,false,false,false,true,true,true,true,false,true,true,true]);});
 async function horizontal(dx,{cancel=false}={}){await touch('touchStart',[{x:dx<0?290:100,y:430}]);for(let i=1;i<=6;i++){await page.waitForTimeout(20);await touch('touchMove',[{x:(dx<0?290:100)+dx*i/6,y:430}]);}await touch(cancel?'touchCancel':'touchEnd',[]);}
 for(const effect of ['slide','fade','curl']){
  await page.evaluate(effect=>{closeOverlay(true);S.settings.verticalMode='off';S.settings.horizontalMode=effect;S.chapter=2;renderReader();},effect);await page.waitForTimeout(1400);
  await horizontal(-120);await settle();await check(effect+' uses real touch to turn exactly one screen page',async()=>{assert.equal(await page.evaluate(()=>TransReadExperience.reading.paged.index),1);assert.equal(await page.locator('.reading-effect-layer').count(),0);});
  await horizontal(110,{cancel:true});await settle();await check(effect+' cancels a partial reverse turn without losing its page',async()=>{assert.equal(await page.evaluate(()=>TransReadExperience.reading.paged.index),1);assert.equal(await page.locator('.reading-effect-layer').count(),0);});
 }
 await page.evaluate(()=>{S.settings.verticalMode='chapter';S.settings.horizontalMode='curl';S.chapter=2;renderReader();});await page.waitForTimeout(650);
 await touch('touchStart',[{x:290,y:430}]);await touch('touchMove',[{x:160,y:430}]);await page.waitForTimeout(70);await page.screenshot({path:'/tmp/transread-0523-curl.png'});
 await check('Paper curl follows the finger with a paper back, shadow, and next chapter underneath',async()=>{const v=await page.evaluate(()=>{const layer=document.querySelector('.reading-effect-layer:not(.reading-underlay)');return {fold:!!layer?.querySelector('.reading-paper-fold'),clip:layer?.querySelector('.reading-paper-front').style.clipPath,under:document.querySelector('.reading-underlay .chapter-heading')?.textContent};});assert(v.fold&&v.clip.includes('polygon')&&!!v.under,JSON.stringify(v));});
 await touch('touchCancel',[]);await settle();
 await page.evaluate(()=>{closeOverlay(true);S.settings.verticalMode='chapter';S.settings.horizontalMode='fade';S.settings.translationService='custom';S.chapter=2;renderReader();translationTools();});await settle();
 await page.locator('[data-action=translation-settings]').click();await settle();
 await page.locator('#api-model').fill('preserved draft');
 await page.locator('.secondary-layer:not([hidden]) .secondary-panel [data-service=custom]').click();await settle();
 await check('Direct service choice preserves form draft and primary card',async()=>{assert.equal(await page.locator('#api-model').inputValue(),'preserved draft');assert.equal(await page.locator('#translation-service').inputValue(),'custom');assert.equal(await page.locator('#overlay-root .translation-tools-sheet').count(),1);});
 await page.evaluate(()=>closeOverlay(true));
 await page.evaluate(()=>{const source=$('#reader-scroll .illustration-open');source.scrollIntoView({block:'center'});M.mark(source);viewIllustration(currentChapter().illustrations[0].id);});await page.waitForTimeout(85);
 await check('Image and blur share one running clock, with blur increasing during entry',async()=>{const v=await page.evaluate(()=>{const r=M.currentOverlay();return {p:r.imageProgress,b:r.blur,frame:r.imageFrame,animations:r.image.getAnimations().length};});assert(v.p>0&&v.p<1&&v.b>0&&v.b<18&&v.frame&&v.animations===0,JSON.stringify(v));});
 await page.evaluate(()=>{window.imageBefore={...M.currentOverlay().pose};closeOverlay();window.imageAfter={...M.currentOverlay().pose};});
 await check('Mid-entry close starts at the exact current image pose',async()=>{assert.deepEqual(await page.evaluate(()=>imageAfter),await page.evaluate(()=>imageBefore));});await page.waitForTimeout(70);
 const box=await page.locator('.image-viewer').boundingBox();await touch('touchStart',[{x:box.width/2,y:box.height/2}]);await touch('touchEnd',[]);await settle();
 await check('A deliberate new touch reverses an unfinished close and keeps viewer open',async()=>{assert.equal(await page.locator('.image-viewer').count(),1);const v=await page.evaluate(()=>{const r=M.currentOverlay();return {b:r.blur,p:r.imageProgress,scale:r.pose.sx,frame:r.imageFrame};});assert.equal(v.b,18);assert.equal(v.p,1);assert.equal(v.scale,1);assert.equal(v.frame,0);});
 await page.evaluate(()=>{closeOverlay(true);const source=$('#reader-scroll .illustration-open');M.mark(source);viewIllustration(currentChapter().illustrations[0].id);const grab=M.imageGrab;M.imageGrab=function(){const before=getComputedStyle($('.image-viewer img')).transform,result=grab();window.pinchCapture={before,after:getComputedStyle($('.image-viewer img')).transform};return result;};});await page.waitForTimeout(40);
 await touch('touchStart',[{x:145,y:390,id:7},{x:245,y:390,id:8}]);
 await check('Two fingers grab the actual opening image geometry without snapping',async()=>{const v=await page.evaluate(()=>({capture:pinchCapture,gesture:M.currentOverlay().gesture}));assert.equal(v.capture.before,v.capture.after);assert(v.gesture);});
 await touch('touchMove',[{x:125,y:380,id:7},{x:265,y:400,id:8}]);await touch('touchEnd',[]);await settle();
 await check('Pinch release keeps the viewer open and finishes with a sharp fitted or zoomed picture',async()=>{assert.equal(await page.locator('.image-viewer').count(),1);const v=await page.evaluate(()=>({blur:M.currentOverlay().blur,scale:M.currentOverlay().pose.sx}));assert.equal(v.blur,18);assert(v.scale>=1);});
 await page.evaluate(()=>closeOverlay());await settle();
 await check('Exit removes image, blur and input lock together',async()=>{assert.equal(await page.locator('.image-viewer').count(),0);assert.equal(await page.locator('#app').evaluate(e=>e.inert),false);});
 await check('No browser runtime errors occurred',async()=>assert.deepEqual(errors,[]));
 console.log(`\n${passed} iteration 0.5.23 checks passed; ${failed} failed. Chromium layout/touch emulation, not Android hardware.`);if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
