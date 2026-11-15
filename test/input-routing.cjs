/* Input sequence regressions. Simulates browser event ordering; no native-device claims. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),{indexedDB,IDBKeyRange}=require('fake-indexeddb');
const dom=new JSDOM('<!doctype html><body><main id="app"></main><div id="dock-root"></div><div id="page-actions" class="notebook-bottom" aria-hidden="true" inert></div><div id="overlay-root"></div><div id="toast"></div><input id="file-input" type="file"></body>',{url:'https://appassets.androidplatform.net/assets/index.html',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window,doc=w.document,ctx=dom.getInternalVMContext(),captured=new Map(),pendingCapture=new Map();let clock=1000,passed=0,failed=0;
Object.assign(w,{indexedDB,IDBKeyRange,TextEncoder,TextDecoder,Blob,File,fflate:require('fflate'),innerWidth:390,innerHeight:844});Object.defineProperty(w.performance,'now',{value:()=>clock});
w.HTMLElement.prototype.scrollIntoView=function(){};w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
w.fetch=async url=>{if(String(url).startsWith('https:'))throw Error('Network disabled');const data=fs.readFileSync(path.join(__dirname,'../web',String(url).split('?')[0]));return {ok:true,json:async()=>JSON.parse(data)};};
const codeDir=process.env.READER_ROUTING_CODE_DIR||path.join(__dirname,'../web');
Object.defineProperty(w.navigator,'languages',{value:['zh-CN'],configurable:true});
for(const name of ['locale.js','motion.js','reading-structure.js','app.js'])vm.runInContext(require('./legacy-fixture.cjs')(fs.readFileSync(path.join(codeDir,name),'utf8')),ctx);
w.HTMLElement.prototype.setPointerCapture=function(id){pendingCapture.set(id,this);};w.HTMLElement.prototype.hasPointerCapture=function(id){return captured.get(id)===this;};
const run=code=>vm.runInContext(code,ctx),tick=()=>new Promise(r=>setTimeout(r,0));
function check(name,fn){try{fn();passed++;console.log('PASS',name);}catch(e){failed++;console.error('FAIL',name,'—',e.message);}}
function emit(type,target,x,y,id,primary=true){const e=new w.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{pointerId:id,pointerType:'touch',isPrimary:primary,clientX:x,clientY:y,button:0});target.dispatchEvent(e);return e;}
function pointer(type,target,x,y,id=1,{primary=true,dt=30}={}){clock+=dt;if(type==='pointerdown')captured.set(id,target);if(type==='pointermove'||type==='pointerup'||type==='pointercancel'){const next=pendingCapture.get(id),old=captured.get(id);pendingCapture.delete(id);if(next&&next!==old){captured.set(id,next);if(old?.isConnected)emit('lostpointercapture',old,x,y,id,primary);emit('gotpointercapture',next,x,y,id,primary);}target=captured.get(id)||target;}const e=emit(type,target,x,y,id,primary);if(type==='pointerup'||type==='pointercancel'){const old=captured.get(id);captured.delete(id);pendingCapture.delete(id);if(old?.isConnected)emit('lostpointercapture',old,x,y,id,primary);}return e;}
function click(target){target.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));}
(async()=>{
 for(let i=0;i<100&&!doc.querySelector('.hero-book');i++)await new Promise(r=>setTimeout(r,10));assert(doc.querySelector('.hero-book'));run("S.settings.verticalMode='chapter';S.settings.horizontalMode='slide';for(const fixtureBook of S.books)fixtureBook.readingModes={verticalMode:'chapter',horizontalMode:'slide'}");
 await run('openBook("little-prince",1)');let word=doc.querySelector('#reader-scroll .word'),page=doc.querySelector('#reader-scroll');
 pointer('pointerdown',word,250,400,11);pointer('pointermove',word,200,400,11);pointer('lostpointercapture',word,200,400,11);pointer('pointermove',page,100,400,11);pointer('pointerup',page,100,400,11);await tick();
 check('Losing implicit capture on the original word does not cancel a swipe captured by the page',()=>assert.equal(run('S.chapter'),2));
 run('closeOverlay(true)');await run('navigate("profile")');let row=doc.querySelector('[data-action="custom-colors"]');pointer('pointerdown',row,180,400,71);
 row=doc.querySelector('[data-action="translation-settings"]');pointer('pointerdown',row,180,440,72);pointer('pointerup',row,180,440,72);click(row);await tick();
 check('A fresh primary tap opens a profile card after an earlier touch ends outside the app',()=>assert.equal(doc.querySelector('.sheet')?.getAttribute('aria-label'),'翻译服务'));
 pointer('pointercancel',doc.body,180,400,71);run('closeOverlay(true)');
 await run('openBook("little-prince",1)');word=doc.querySelector('#reader-scroll .word');page=doc.querySelector('#reader-scroll');
 pointer('pointerdown',word,250,400,81);pointer('pointermove',word,210,402,81);pointer('pointermove',page,90,404,81);pointer('pointerup',page,90,404,81);await tick();
 check('The browser-style implicit-to-explicit capture sequence completes the next-chapter swipe',()=>assert.equal(run('S.chapter'),2));
 word=doc.querySelector('#reader-scroll .word');page=doc.querySelector('#reader-scroll');pointer('pointerdown',word,110,400,82);pointer('pointermove',word,155,398,82);pointer('pointermove',page,260,397,82);pointer('pointerup',page,260,397,82);await tick();
 check('The same capture-transfer sequence completes the previous-chapter swipe',()=>assert.equal(run('S.chapter'),1));
 word=doc.querySelector('#reader-scroll .word');page=doc.querySelector('#reader-scroll');pointer('pointerdown',word,250,400,83);pointer('pointermove',word,190,400,83);pointer('pointermove',page,150,400,83);captured.delete(83);pendingCapture.delete(83);emit('lostpointercapture',page,150,400,83);pointer('pointerup',page,90,400,83);await tick();
 check('Losing the page capture itself still cancels chapter navigation and clears displacement',()=>{assert.equal(run('S.chapter'),1);assert.equal(page.style.transform,'');});
 word=doc.querySelector('#reader-scroll .word');pointer('pointerdown',word,250,400,84);pointer('pointermove',word,190,400,84);pointer('pointerdown',word,250,400,85);pointer('pointermove',word,200,400,85);pointer('pointermove',word,90,400,85);pointer('pointerup',word,90,400,85);await tick();
 check('A new primary touch recovers reading swipes after an earlier gesture never sends its ending event',()=>assert.equal(run('S.chapter'),2));
 run('closeOverlay(true)');await run('navigate("profile")');row=doc.querySelector('[data-action="dictionary-info"]');pointer('pointerdown',row,180,400,91);pointer('pointermove',row,180,412,91);pointer('pointerup',row,180,412,91);click(row);await tick();
 check('A browser-qualified settings click is not discarded by the global reading drag flag',()=>assert.equal(doc.querySelector('.sheet')?.getAttribute('aria-label'),'词典与发音'));
 run('closeOverlay(true);translationTools()');row=doc.querySelector('[data-action="toggle-orb"]');const orb=run('S.settings.translateButton');pointer('pointerdown',row,180,400,92);pointer('pointermove',row,180,407,92);pointer('pointerup',row,180,407,92);click(row);await tick();
 check('Small finger jitter inside a settings card remains a tap',()=>assert.equal(run('S.settings.translateButton'),!orb));
 run('closeOverlay(true)');const menus=[['custom-colors','主题色彩'],['translation-settings','翻译服务'],['dictionary-info','词典与发音'],['reading-settings','主题与排版'],['library-settings','图书与存储'],['backup-settings','图书备份与恢复'],['edit-profile','怎么称呼你'],['privacy','隐私与数据'],['about','关于译读']];let completed=0;
 for(let round=0;round<5;round++)for(const [action,title] of menus){run('closeOverlay(true)');row=doc.querySelector('#app [data-action="'+action+'"]');const target=row.querySelector('strong,i')||row,id=200+completed;pointer('pointerdown',target,180,400,id);pointer('pointerup',target,180,400,id);click(target);await tick();if(doc.querySelector('.sheet')?.getAttribute('aria-label')===title)completed++;}
 check('All nine profile cards open over 45 successive taps on their labels and icons',()=>assert.equal(completed,45));
 run('closeOverlay(true)');const effects=[];w.HTMLElement.prototype.animate=function(){let resolve,reject;const effect={state:'running',finished:new Promise((a,b)=>{resolve=a;reject=b;}),finish(){if(this.state==='running'){this.state='finished';resolve();}},cancel(){if(this.state==='running'){this.state='cancelled';reject(Error('cancelled'));}}};effects.push(effect);return effect;};
 row=doc.querySelector('#app [data-action="custom-colors"]');pointer('pointerdown',row,180,400,401);pointer('pointerup',row,180,400,401);click(row);const firstPanel=doc.querySelector('.sheet');run('closePanel()');row=doc.querySelector('#app [data-action="translation-settings"]');pointer('pointerdown',row,180,440,402);pointer('pointerup',row,180,440,402);click(row);for(const effect of effects)effect.finish();await tick();await tick();
 check('A settings control below a closing modal cannot receive its trailing tap',()=>assert.equal(doc.querySelector('.sheet'),null));
 pointer('pointerdown',row,180,440,403);pointer('pointerup',row,180,440,403);click(row);await tick();
 check('A fresh settings tap works as soon as the modal shield has gone',()=>{assert.notEqual(doc.querySelector('.sheet'),firstPanel);assert.equal(doc.querySelector('.sheet')?.getAttribute('aria-label'),'翻译服务');assert(!doc.querySelector('#overlay-root').inert);assert.equal(run('M.currentOverlay().closing'),false);});
 run('closeOverlay(true)');for(const effect of effects)effect.finish();await tick();
 console.log(`\n${passed} input-routing checks passed, ${failed} failed. No rendered or native touch claims.`);dom.window.close();if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
