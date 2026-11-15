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




 const settle=async()=>{await page.waitForTimeout(430);await until(()=>!document.getAnimations().some(a=>a.playState==='running'&&Number.isFinite(a.effect?.getComputedTiming().endTime)));};
 await page.evaluate(()=>setAppLanguage('en'));
 await ready(()=>sheet('Parent settings','<input id="parent-draft" class="input-field" value="keep this draft"><div style="height:1400px">Parent content</div>'));
 await page.evaluate(()=>{window.parentPanel=M.currentOverlay().panel;window.parentRecord=M.currentOverlay();document.querySelector('#parent-draft').value='unsaved parent';document.querySelector('.sheet-body').scrollTop=80;M.mark(document.querySelector('#parent-draft'));TransReadExperience.secondary.open('Child settings','<div style="height:1400px">Child content</div>');});
 await check('Child uses the exact bottom-sheet motion record and mounted parent',async()=>{const v=await page.evaluate(()=>{const r=M.currentOverlay(),a=r.panel.getAnimations()[0];return{kind:r.kind,parent:r.parent===parentRecord,inert:parentPanel.inert,body:!!r.sheetInput,frames:a.effect.getKeyframes().map(f=>({t:f.transform,y:new DOMMatrix(f.transform).m42,o:f.opacity})),height:r.panel.getBoundingClientRect().height,separate:!!TransReadExperience.secondary.active().motionRecord};});assert(v.kind==='sheet'&&v.parent&&v.inert&&v.body&&v.separate);assert(v.frames.length>=32);assert(v.frames.every(f=>Number(f.o)===1&&!f.t.includes('scale')));assert(v.frames[0].y>=v.height);assert.equal(v.frames.at(-1).y,0);});await settle();
 await check('Child rests at the same bottom edge as a primary card',async()=>{const v=await page.locator('.secondary-panel').boundingBox();assert(Math.abs(v.y+v.height-834)<1,JSON.stringify(v));assert(v.x>=9&&v.x+v.width<=381);});
 await check('Nested cards keep one background shade and only one active dialog',async()=>{const v=await page.evaluate(()=>({transparent:getComputedStyle(M.currentOverlay().backdrop).backgroundColor,parentHidden:parentPanel.getAttribute('aria-hidden'),app:document.querySelector('#app').inert}));assert.equal(v.transparent,'rgba(0, 0, 0, 0)');assert.equal(v.parentHidden,'true');assert(v.app);});
 const head=await point('.secondary-panel .sheet-head');await swipe(head.x,head.y,24,{interval:85,hold:180});await settle();
 await check('A short child pull uses the original rebound and leaves its parent untouched',async()=>{assert.equal(await page.locator('.secondary-panel').count(),1);assert.equal(await page.locator('.secondary-panel').evaluate(e=>getComputedStyle(e).transform),'none');assert.equal(await page.evaluate(()=>document.querySelector('.sheet-body').scrollTop),80);});
 let b=await page.locator('.secondary-body').boundingBox();await swipe(b.x+40,b.y+b.height*.7,-140,{steps:4,interval:16});await page.waitForTimeout(150);
 await check('Long child content retains native scrolling below a fixed header',async()=>{assert(await page.locator('.secondary-body').evaluate(e=>e.scrollTop)>60);assert.equal(await page.locator('.secondary-panel').count(),1);});
 await page.evaluate(()=>{TransReadExperience.secondary.close();const a=M.currentOverlay().panel.getAnimations()[0];a.pause();a.currentTime=40;});let handle=await point('.secondary-panel .sheet-handle');await touch('touchStart',[handle]);await touch('touchEnd',[]);await settle();
 await check('A closing child is grabbed through the same primary interruption path',async()=>{assert.equal(await page.locator('.secondary-panel').count(),1);assert.equal(await page.evaluate(()=>M.currentOverlay().closing),false);assert.equal(await page.locator('.secondary-panel').evaluate(e=>getComputedStyle(e).transform),'none');});
 handle=await point('.secondary-panel .sheet-handle');await swipe(handle.x,handle.y,160,{interval:30,hold:100});await settle();
 await check('A sufficient downward pull dismisses only the top sheet and restores its parent',async()=>{assert.equal(await page.locator('.secondary-panel').count(),0);assert.equal(await page.evaluate(()=>M.currentOverlay()===parentRecord),true);assert.equal(await page.evaluate(()=>parentPanel.inert),false);assert.equal(await page.locator('#parent-draft').inputValue(),'unsaved parent');assert.equal(await page.locator('.sheet-body').evaluate(e=>e.scrollTop),80);assert.equal(await page.locator('#app').evaluate(e=>e.inert),true);});
 await page.evaluate(()=>TransReadExperience.secondary.open('Outside close','<p>Only this sheet closes.</p>'));await settle();await touch('touchStart',[{x:8,y:80}]);await touch('touchEnd',[]);await settle();
 await check('Outside touch closes one level without firing a parent control',async()=>{assert.equal(await page.locator('.secondary-panel').count(),0);assert.equal(await page.evaluate(()=>M.currentOverlay()===parentRecord),true);assert.equal(await page.locator('#parent-draft').inputValue(),'unsaved parent');});
 await page.evaluate(()=>{TransReadExperience.secondary.open('Nested form','<textarea id="child-draft" class="input-field">child draft</textarea><div style="height:900px">More content</div>');});await settle();
 await page.setViewportSize({width:844,height:390});await settle();
 await check('Rotating a child keeps its draft, bottom placement and fixed close button',async()=>{const r=await page.locator('.secondary-panel').boundingBox(),c=await page.locator('.secondary-panel .close-btn').boundingBox();assert.equal(await page.locator('#child-draft').inputValue(),'child draft');assert(Math.abs(r.y+r.height-382)<1);assert(c.y>=8&&c.y+c.height<=382);assert(r.width<=600);});
 await page.setViewportSize({width:844,height:250});await settle();
 await check('A short visual viewport leaves the child header reachable and body scrollable',async()=>{const v=await page.locator('.secondary-body').evaluate(e=>({max:e.scrollHeight-e.clientHeight,bottom:e.getBoundingClientRect().bottom}));assert(v.max>400&&v.bottom<=250);const c=await page.locator('.secondary-panel .close-btn').boundingBox();assert(c.y>=0&&c.y+c.height<=250);});

 await page.evaluate(()=>{TransReadExperience.secondary.open('Deep child','<p>A second nested layer.</p>');});await settle();await page.evaluate(()=>Lumi.back());await settle();
 await check('Multiple nested sheets unwind one level without replacing an intermediate draft',async()=>{assert.equal(await page.locator('.secondary-panel').count(),1);assert.equal(await page.locator('#child-draft').inputValue(),'child draft');assert.equal(await page.evaluate(()=>M.currentOverlay().panel===TransReadExperience.secondary.active().panel),true);assert.equal(await page.evaluate(()=>document.activeElement===M.currentOverlay().panel),true);});
 await page.evaluate(()=>{closeOverlay(true);});
 await check('Whole-stack cleanup removes all records and restores background input',async()=>{assert.equal(await page.locator('.secondary-layer').count(),0);assert.equal(await page.evaluate(()=>M.currentOverlay()),null);assert.equal(await page.locator('#app').evaluate(e=>e.inert),false);});
 await page.setViewportSize({width:844,height:390});await page.evaluate(()=>openBook('little-prince',2));await page.waitForTimeout(600);
 for(const size of [{width:844,height:390},{width:740,height:330},{width:1024,height:600},{width:390,height:844}]){
  await page.setViewportSize(size);await settle();await page.evaluate(()=>{closeOverlay(true);themes();});await settle();
  const theme=await page.locator('.theme-settings-sheet>.segmented').boundingBox();
  await check('Theme fits with bounded controls and visible paper choices '+size.width,async()=>{const v=await page.evaluate(()=>{const s=document.querySelector('.theme-stage').getBoundingClientRect(),a=document.querySelector('[data-setting=fontSize]').getBoundingClientRect(),b=document.querySelector('[data-setting=leading]').getBoundingClientRect(),swatches=[...document.querySelectorAll('.theme-swatch')].map(e=>e.getBoundingClientRect().toJSON());return{stage:s.toJSON(),a:a.toJSON(),b:b.toJSON(),swatches,width:document.querySelector('.theme-settings-sheet').getBoundingClientRect().width};});if(size.width>size.height){assert(v.width<=640);assert(Math.abs(v.a.y-v.b.y)<1);assert(v.a.width<310);}assert(v.swatches.every(r=>r.bottom<=v.stage.bottom+1),JSON.stringify(v));assert(theme.width<=400);});
  await page.screenshot({path:'/tmp/transread-0525-theme-'+size.width+'.png'});
  await page.evaluate(()=>{closeOverlay(true);showToc();});await settle();const toc=await page.locator('.toc-sheet>.segmented').boundingBox();
  await check('Theme and directory retain identical footer screen geometry '+size.width,async()=>{for(const k of ['x','y','width','height'])assert(Math.abs(theme[k]-toc[k])<1.1,JSON.stringify({theme,toc,k}));});
 }

 await page.setViewportSize({width:390,height:480});await page.evaluate(()=>{closeOverlay(true);showToc();});await settle();
 await check('Compact portrait directory retains a usable native list below its fixed controls',async()=>{const v=await page.locator('.toc-scroll').boundingBox(),footer=await page.locator('.toc-sheet>.segmented').boundingBox();assert(v.height>=120,JSON.stringify(v));assert(v.y+v.height<=footer.y+1);});
 await page.setViewportSize({width:844,height:390});
 for(const name of ['shelf','search','notes','profile']){
  await page.evaluate(name=>{closeOverlay(true);navigate(name);},name);await settle();
  if(name==='search'){await page.locator('[data-tab=web]').click();await settle();}
  await check('Landscape '+name+' stays within screen bounds with reachable navigation',async()=>{const v=await page.evaluate(()=>({width:document.documentElement.scrollWidth,screen:innerWidth,page:document.querySelector('.page').getBoundingClientRect().toJSON(),dock:document.querySelector('.main-dock').getBoundingClientRect().toJSON()}));assert(v.width<=v.screen+1,JSON.stringify(v));assert(v.page.left>=0&&v.page.right<=844);assert(v.dock.bottom<=390&&v.dock.top>=0);});
  await page.screenshot({path:'/tmp/transread-0525-'+name+'.png'});
 }

 await page.evaluate(()=>{navigate('profile');});await settle();await page.locator('.profile-page').evaluate(e=>e.scrollTop=e.scrollHeight);await settle();
 await check('Landscape profile can scroll its final setting clear of the navigation',async()=>{const r=await page.locator('[data-action=about]').boundingBox(),dock=await page.locator('.main-dock').boundingBox();assert(r.y+r.height<dock.y-5,JSON.stringify({r,dock}));});
 await page.setViewportSize({width:568,height:280});await ready(()=>sheet('Compact form','<label>Input<input class="input-field" value="A long editable field"></label><p>'+('Long card content. '.repeat(100))+'</p>'));await settle();
 await check('Compact landscape generic forms keep the header reachable and scroll horizontally unbroken',async()=>{const c=await page.locator('.close-btn').boundingBox();const v=await page.locator('.sheet-body').evaluate(e=>({scroll:e.scrollHeight>e.clientHeight,width:e.scrollWidth,available:e.clientWidth}));assert(c.y>=0&&c.y+c.height<=280);assert(v.scroll&&v.width<=v.available+1,JSON.stringify(v));});
 await page.setViewportSize({width:844,height:390});
 await ready(()=>appLanguages());await settle();
 await check('Generic primary language card pins its header and scrolls its content',async()=>{const head=await page.locator('.sheet-head').boundingBox();await page.locator('.sheet-body').evaluate(e=>e.scrollTop=80);const next=await page.locator('.sheet-head').boundingBox();assert(Math.abs(head.y-next.y)<1);assert(await page.locator('.sheet-body').evaluate(e=>e.scrollHeight>e.clientHeight));});
 await page.locator('[data-locale=zh-TW]').click();await settle();
 await check('Traditional Chinese language selection preserves the same primary card',async()=>{assert.equal(await page.locator('.app-language-sheet').count(),1);assert.equal(await page.locator('.secondary-panel').count(),0);assert.equal(await page.evaluate(()=>S.settings.uiLanguage),'zh-TW');});
 await page.evaluate(()=>{closeOverlay(true);translationSettings();chooseTranslationService('custom');});await settle();await page.locator('#api-model').fill('landscape form draft');
 await check('Landscape translation form keeps its save footer and close button in view',async()=>{const save=await page.locator('.translation-save').boundingBox(),close=await page.locator('.close-btn').boundingBox();assert(save.y>=0&&save.y+save.height<=390);assert(close.y>=0&&close.y+close.height<=390);assert.equal(await page.locator('#api-model').inputValue(),'landscape form draft');});
 await page.evaluate(()=>{closeOverlay(true);S.settings.reducedMotion=true;userGuide();M.mark(document.querySelector('.guide-content [data-action=app-language]'));appLanguages();});
 await check('Reduced motion still uses one nested bottom-sheet stack',async()=>{assert.equal(await page.evaluate(()=>M.currentOverlay().kind),'sheet');assert.equal(await page.evaluate(()=>!!M.currentOverlay().parent),true);assert.equal(await page.locator('.secondary-panel').evaluate(e=>e.getAnimations().length),0);});
 await page.evaluate(()=>Lumi.back());
 await check('Reduced-motion back returns directly to the same parent',async()=>{assert.equal(await page.locator('.secondary-panel').count(),0);assert.equal(await page.locator('.guide-sheet').count(),1);assert.equal(await page.locator('.guide-sheet').evaluate(e=>e.inert),false);});
 await page.setViewportSize({width:390,height:844});await page.evaluate(async()=>{closeOverlay(true);S.settings.reducedMotion=false;await setAppLanguage('en');await openBook('little-prince',2);});await page.waitForTimeout(600);
 // Sample image timing by animation phase, not a wall timer under software blur load.
 async function closeAtPhase(){await page.evaluate(()=>{const raf=window.requestAnimationFrame,caf=window.cancelAnimationFrame,pending=new Map(),start=performance.now();let next=10000000;window.requestAnimationFrame=fn=>{const id=++next;pending.set(id,fn);return id;};window.cancelAnimationFrame=id=>pending.delete(id);window.exitClock={step(ms){const id=M.currentOverlay().imageFrame,fn=pending.get(id);pending.delete(id);if(!fn)throw Error('Missing image frame');fn(start+ms);},restore(){window.requestAnimationFrame=raf;window.cancelAnimationFrame=caf;pending.clear();delete window.exitClock;}};closeOverlay();exitClock.step(210);});}
 async function show(){await page.evaluate(()=>{const source=document.querySelector('#reader-scroll .illustration-open');source.scrollIntoView({block:'center'});M.mark(source);viewIllustration(currentChapter().illustrations[0].id);});await until(()=>M.currentOverlay()?.kind==='image'&&!M.currentOverlay().imageFrame&&M.currentOverlay().blur===18);}
 await show();await closeAtPhase();
 await check('Exit blur reaches zero while the picture is still returning',async()=>{const v=await page.evaluate(()=>{const r=M.currentOverlay();return{blur:r.blur,p:r.imageProgress,closing:r.closing,frame:r.imageFrame,locked:document.querySelector('#app').inert};});assert.equal(v.blur,0);assert(v.closing&&v.p<1&&v.frame&&v.locked,JSON.stringify(v));});
 await page.evaluate(()=>{window.before={pose:{...M.currentOverlay().pose},blur:M.currentOverlay().blur};exitClock.restore();M.imageResume();window.after={pose:{...M.currentOverlay().pose},blur:M.currentOverlay().blur};});
 await check('Reversal after blur has cleared keeps exact current geometry and blur',async()=>assert.deepEqual(await page.evaluate(()=>before),await page.evaluate(()=>after)));await settle();
 await check('Reopened picture restores full blur without losing its input shield',async()=>{assert.equal(await page.locator('.image-viewer').count(),1);assert.equal(await page.evaluate(()=>M.currentOverlay().blur),18);assert.equal(await page.locator('#app').evaluate(e=>e.inert),true);});
 await page.evaluate(()=>closeOverlay());
 await check('Image and input shield clean up together after its return finishes',async()=>{assert.equal(await page.locator('.image-viewer').count(),0);assert.equal(await page.locator('#app').evaluate(e=>e.inert),false);});

 await page.evaluate(()=>{S.settings.theme='night';setTheme();});await show();await closeAtPhase();
 await check('Night-mode exit clears both blur and tint before the image finishes',async()=>{const v=await page.evaluate(()=>({blur:M.currentOverlay().blur,progress:M.currentOverlay().imageProgress,bg:getComputedStyle(document.querySelector('.image-viewer-dim')).backgroundColor,locked:document.querySelector('#app').inert}));assert.equal(v.blur,0);assert(v.progress<1&&v.locked);assert.match(v.bg,/rgba\(22, 31, 27, 0\)/);});await page.evaluate(()=>{exitClock.step(400);exitClock.restore();});
 await check('No runtime errors occurred in the new sheet and landscape scenarios',async()=>assert.deepEqual(errors,[]));
 console.log(`\n${passed} iteration 0.5.25 checks passed; ${failed} failed. Chromium touch/layout, not Android hardware.`);if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
