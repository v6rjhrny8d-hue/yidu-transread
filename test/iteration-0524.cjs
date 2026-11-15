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



 const settle=()=>page.waitForTimeout(440);
 await check('Fresh settings default to chapter scrolling and realistic curl',async()=>{const m=await page.evaluate(()=>{delete S.settings.verticalMode;delete S.settings.horizontalMode;const m=TransReadExperience.modes();return[m.verticalMode,m.horizontalMode];});assert.deepEqual(m,['chapter','curl']);});
 await page.evaluate(()=>{S.settings.horizontalMode='fade';TransReadExperience.modes();});
 await check('Existing explicit reading mode is preserved',async()=>assert.equal(await page.evaluate(()=>S.settings.horizontalMode),'fade'));
 await page.evaluate(()=>openBook('little-prince',2));await page.waitForTimeout(1100);
 for(const size of [{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(size);await settle();await page.evaluate(()=>{closeOverlay(true);themes();});await settle();
  const theme=await page.locator('.theme-settings-sheet>.segmented').boundingBox();
  await check('Theme footer is fixed while its content scrolls '+size.width,async()=>{await page.locator('.theme-stage').evaluate(el=>el.scrollTop=el.scrollHeight);const b=await page.locator('.theme-settings-sheet>.segmented').boundingBox();assert(Math.abs(b.y-theme.y)<1);const content=await page.locator('.theme-stage').boundingBox();assert(content.y+content.height<=b.y+1);});
  await page.screenshot({path:'/tmp/transread-0524-theme-'+size.width+'.png'});
  await page.evaluate(()=>{closeOverlay(true);showToc();});await settle();const toc=await page.locator('.toc-sheet>.segmented').boundingBox();
  await check('Theme and directory footers have identical x y width height '+size.width,async()=>{for(const k of ['x','y','width','height'])assert(Math.abs(theme[k]-toc[k])<1.1,JSON.stringify({theme,toc,k}));});
 }
 await page.setViewportSize({width:390,height:844});

 await ready(()=>{S.page='profile';render();themes();});await settle();const profileFooter=await page.locator('.theme-settings-sheet>.segmented').boundingBox();
 await page.locator('[data-action=theme-tab][data-tab=sliding]').click();await settle();
 await check('Personal theme tabs keep one stable card height and bottom footer',async()=>{const b=await page.locator('.theme-settings-sheet>.segmented').boundingBox();assert(Math.abs(b.y-profileFooter.y)<1);assert(Math.abs(b.height-profileFooter.height)<1);});
 await ready(()=>{closeOverlay(true);S.page='profile';render();appLanguages();});await settle();
 await check('Personal application language is a primary bottom card',async()=>{assert.equal(await page.locator('.secondary-panel').count(),0);assert.equal(await page.locator('#overlay-root .app-language-sheet .sheet-handle').count(),1);});
 await ready(()=>{closeOverlay(true);userGuide();M.mark(document.querySelector('.guide-content [data-action=app-language]'));appLanguages();});await settle();
 await check('Guide application language is a child of the mounted guide',async()=>{assert.equal(await page.locator('.secondary-panel.app-language-sheet').count(),1);assert.equal(await page.locator('#overlay-root .guide-sheet').count(),1);});
 await ready(async()=>{await openBook('little-prince',2);translationTools();});await page.locator('[data-action=translation-settings]').click();await settle();
 await check('Translation form has direct provider choices and a separate save footer',async()=>{assert.equal(await page.locator('.secondary-panel').count(),1);assert.equal(await page.locator('.service-options [data-service]').count(),3);assert.equal(await page.locator('[data-action=translation-services]').count(),0);assert.equal(await page.locator('.secondary-panel>.translation-save').count(),1);});
 await page.locator('[data-service=custom]').click();await page.waitForTimeout(260);await page.locator('#api-endpoint').fill('https://example.com/v1/chat/completions');await page.locator('#api-model').fill('draft-0524');await page.locator('#api-key').fill('fixture-key');
 await page.locator('[data-service=google]').click();await page.waitForTimeout(240);await page.locator('[data-service=custom]').click();await page.waitForTimeout(240);
 await check('Switching providers retains custom fields without saving',async()=>{assert.equal(await page.locator('#api-model').inputValue(),'draft-0524');assert.equal(await page.locator('#api-key').inputValue(),'fixture-key');assert.equal(await page.evaluate(()=>S.settings.translationService),'google');assert.equal(await page.locator('.secondary-panel').count(),1);});
 await page.screenshot({path:'/tmp/transread-0524-service.png'});
 await page.locator('[data-action=save-translation-settings]').click();await settle();
 await check('Save commits the draft and closes only the service form',async()=>{assert.equal(await page.evaluate(()=>S.settings.apiModel),'draft-0524');assert.equal(await page.evaluate(()=>S.settings.translationService),'custom');assert.equal(await page.locator('.secondary-panel').count(),0);assert.equal(await page.locator('.translation-tools-sheet').count(),1);assert.match(await page.locator('.translation-tools-sheet [data-action=translation-settings] small').innerText(),/AI/);});
 await page.locator('[data-action=translation-settings]').click();await settle();await page.locator('[data-service=mymemory]').click();await page.evaluate(()=>Lumi.back());await settle();
 await check('Back cancels an unsaved provider change and retains the parent',async()=>{assert.equal(await page.evaluate(()=>S.settings.translationService),'custom');assert.equal(await page.locator('.translation-tools-sheet').count(),1);});
 await page.locator('[data-action=translation-languages]').click();await settle();
 let b=await page.locator('.secondary-panel').boundingBox();await page.locator('.secondary-body').evaluate(el=>el.scrollTop=0);await swipe(b.x+70,b.y+110,25,{interval:85,hold:160});await settle();
 await check('Short downward child pull springs back without closing parent or child',async()=>{assert.equal(await page.locator('.secondary-panel').count(),1);assert.equal(await page.locator('.secondary-panel').evaluate(e=>getComputedStyle(e).transform),'none');assert.equal(await page.locator('.translation-tools-sheet').count(),1);});
 b=await page.locator('.secondary-panel').boundingBox();await swipe(b.x+70,b.y+150,-160,{interval:20});await page.waitForTimeout(80);
 await check('Child list keeps native vertical scrolling with a stable header',async()=>{assert(await page.locator('.secondary-body').evaluate(e=>e.scrollTop)>30);assert.equal(await page.locator('.secondary-panel').count(),1);});
 const stop=await point('.secondary-panel .sheet-handle');await touch('touchStart',[stop]);await touch('touchEnd',[]);await page.locator('.secondary-body').evaluate(el=>el.scrollTop=0);await page.waitForTimeout(100);b=await page.locator('.secondary-panel').boundingBox();await swipe(b.x+80,b.y+130,160,{interval:35,hold:100});await settle();
 await check('A sufficient child pull dismisses only the top card',async()=>{assert.equal(await page.locator('.secondary-panel').count(),0,JSON.stringify(await page.evaluate(()=>{const c=TransReadExperience.secondary.active();return c?{closing:c.closing,transform:getComputedStyle(c.panel).transform,body:c.panel.querySelector('.secondary-body').scrollTop}:{};})));assert.equal(await page.locator('.translation-tools-sheet').count(),1);assert.equal(await page.locator('.translation-tools-sheet').evaluate(e=>e.inert),false);});
 await page.locator('[data-action=translation-languages]').click();await settle();await page.evaluate(()=>{TransReadExperience.secondary.close();const a=M.currentOverlay().panel.getAnimations()[0];a.pause();a.currentTime=40;});b=await page.locator('.secondary-panel .sheet-handle').boundingBox();await touch('touchStart',[{x:b.x+8,y:b.y+2}]);await touch('touchEnd',[]);await settle();
 await check('Touching a closing child cancels stale removal and rebounds into place',async()=>{assert.equal(await page.locator('.secondary-panel').count(),1);assert.equal(await page.locator('.secondary-panel').evaluate(e=>getComputedStyle(e).transform),'none');});
 await page.evaluate(()=>closeOverlay(true));
 const combos=[['chapter','curl'],['off','curl'],['chapter','fade'],['off','slide'],['chapter','off'],['continuous','off'],['chapter','slide'],['off','fade'],['chapter','curl']];
 for(const [vertical,horizontal] of combos){
  await page.evaluate(({vertical,horizontal})=>{savePosition();const pos={...S.book.position};cancelReaderInteraction();S.settings.verticalMode=vertical;S.settings.horizontalMode=horizontal;renderReader();restoreReaderPosition(document.querySelector('#reader-scroll'),pos);},{vertical,horizontal});await page.waitForTimeout(700);
  await check('Mode round trip is live without reopening '+vertical+'/'+horizontal,async()=>{const v=await page.evaluate(()=>{const sc=document.querySelector('#reader-scroll'),a=sc.querySelector('.reader-inner');return{paged:!!TransReadExperience.reading.paged,stream:!!TransReadExperience.reading.stream,pagedClass:sc.classList.contains('paged-scroll'),height:a?.style.height,column:a?.style.columnWidth,overflow:getComputedStyle(sc).overflowY,restoring:!!sc.readerRestore};});assert.equal(v.paged,vertical==='off');assert.equal(v.stream,vertical==='continuous');assert.equal(v.pagedClass,vertical==='off');if(vertical==='chapter'){assert.equal(v.height,'');assert.equal(v.column,'');}assert.equal(v.restoring,false,JSON.stringify(v));});
 }

 await ready(()=>{S.settings.verticalMode='chapter';S.settings.horizontalMode='curl';renderReader();themes();});await settle();await page.locator('[data-action=theme-tab][data-tab=sliding]').click();await settle();
 await page.locator('[data-axis=vertical][data-action=reading-style-menu]').click();await settle();await page.locator('.secondary-panel [data-mode=off]').click();await settle();
 await check('Actual mode menu initializes paging before returning to reading',async()=>{assert.equal(await page.evaluate(()=>!!TransReadExperience.reading.paged),true);assert.equal(await page.locator('.secondary-panel').count(),0);assert.equal(await page.locator('.theme-settings-sheet').count(),1);});
 await page.locator('[data-axis=vertical][data-action=reading-style-menu]').click();await settle();await page.locator('.secondary-panel [data-mode=chapter]').click();await settle();
 await check('Actual mode menu removes column geometry immediately on return to chapter scrolling',async()=>{const v=await page.evaluate(()=>({mode:S.settings.verticalMode,paged:!!TransReadExperience.reading.paged,height:document.querySelector('#reader-scroll .reader-inner').style.height}));assert.deepEqual(v,{mode:'chapter',paged:false,height:''});});
 await page.evaluate(()=>closeOverlay(true));

 await page.evaluate(()=>{changeChapter(S.chapter+1);});
 await page.evaluate(async()=>{const button=document.createElement('button');button.dataset.axis='vertical';button.dataset.mode='off';await action('reading-style',button);});await page.waitForTimeout(600);
 await check('Switching mode while a turn is settling cancels old layers and initializes the new layout',async()=>{assert.equal(await page.evaluate(()=>!!TransReadExperience.reading.paged),true);assert.equal(await page.locator('.reading-effect-layer').count(),0);assert.equal(await page.locator('#reader-scroll').count(),1);});
 await page.evaluate(()=>{closeOverlay(true);S.dock=true;S.settings.verticalMode='chapter';S.settings.horizontalMode='curl';S.chapter=2;renderReader();});await page.waitForTimeout(900);
 await touch('touchStart',[{x:290,y:430}]);await touch('touchMove',[{x:210,y:430}]);
 await check('Horizontal intent hides the rail and removes its hit target immediately',async()=>{const v=await page.locator('#reader-rail').evaluate(e=>({visibility:getComputedStyle(e).visibility,inert:e.inert,hidden:e.getAttribute('aria-hidden')}));assert.equal(v.visibility,'hidden');assert(v.inert);assert.equal(v.hidden,'true');});
 await page.evaluate(()=>{window.railLeak=[];window.watchRail=true;function sample(){if(!watchRail)return;const rail=document.querySelector('#reader-rail');if(getComputedStyle(rail).visibility!=='hidden')railLeak.push(performance.now());requestAnimationFrame(sample);}sample();});
 await touch('touchMove',[{x:140,y:430}]);await touch('touchEnd',[]);await page.waitForTimeout(100);
 await check('Rail stays hidden across drag release and chapter replacement',async()=>{assert.deepEqual(await page.evaluate(()=>railLeak),[]);assert.equal(await page.locator('#reader-rail').evaluate(e=>getComputedStyle(e).visibility),'hidden');});
 await page.waitForTimeout(500);await page.evaluate(()=>watchRail=false);
 await check('Rail returns only after the latest turn and stable chapter layout',async()=>{assert.equal(await page.evaluate(()=>S.chapter),3);assert.equal(await page.locator('.reading-effect-layer').count(),0);assert.equal(await page.locator('#reader-rail').getAttribute('aria-hidden'),'false');assert.equal(await page.locator('#reader-rail').evaluate(e=>e.inert),false);});

 await touch('touchStart',[{x:110,y:430}]);await touch('touchMove',[{x:150,y:430}]);await touch('touchCancel',[]);await page.waitForTimeout(70);
 await touch('touchStart',[{x:290,y:430}]);await touch('touchMove',[{x:215,y:430}]);await touch('touchEnd',[]);await settle();
 await check('A new turn during rebound leaves one correct chapter with no stale layers',async()=>{assert.equal(await page.evaluate(()=>S.chapter),4);assert.equal(await page.locator('.reading-effect-layer').count(),0);assert.equal(await page.locator('#reader-rail').getAttribute('aria-hidden'),'false');});
 await page.evaluate(()=>{S.chapter=2;renderReader();});await page.waitForTimeout(550);await page.evaluate(()=>{const source=document.querySelector('#reader-scroll .illustration-open');source.scrollIntoView({block:'center'});M.mark(source);viewIllustration(currentChapter().illustrations[0].id);});await page.waitForTimeout(235);
 await check('Gaussian blur reaches full before image geometry finishes',async()=>{const v=await page.evaluate(()=>({blur:M.currentOverlay().blur,p:M.currentOverlay().imageProgress,frame:M.currentOverlay().imageFrame}));assert.equal(v.blur,18);assert(v.p<1&&v.frame,JSON.stringify(v));});
 await page.evaluate(()=>{window.beforePose={...M.currentOverlay().pose};closeOverlay();window.afterPose={...M.currentOverlay().pose};});
 await check('Early blur completion keeps exact image pose on reversal',async()=>assert.deepEqual(await page.evaluate(()=>beforePose),await page.evaluate(()=>afterPose)));
 await settle();await page.evaluate(()=>closeOverlay(true));
 await check('No runtime errors occurred during new regression scenarios',async()=>assert.deepEqual(errors,[]));
 console.log(`\n${passed} iteration 0.5.24 checks passed; ${failed} failed. Chromium layout/touch emulation, not Android hardware.`);if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
