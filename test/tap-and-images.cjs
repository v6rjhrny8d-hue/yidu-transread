/* Pointer-only activation and illustration regressions with assigned geometry.
 * No click is synthesized unless the test explicitly asks for one. This is a
 * controlled DOM/event test, not a rendered WebView or native-device test. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),{indexedDB,IDBKeyRange}=require('fake-indexeddb');
const web=path.join(__dirname,'../web'),codeDir=process.env.TAP_IMAGE_CODE_DIR||web;
const dom=new JSDOM(fs.readFileSync(path.join(web,'index.html'),'utf8'),{url:'https://appassets.androidplatform.net/assets/index.html',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window,doc=w.document,ctx=dom.getInternalVMContext(),captured=new Map(),pending=new Map(),animations=[];
const rafs=new Map();let rafId=0;let clock=1000,passed=0,failed=0,nextId=200;
Object.assign(w,{indexedDB,IDBKeyRange,TextEncoder,TextDecoder,Blob,File,fflate:require('fflate'),innerWidth:390,innerHeight:844});
Object.defineProperty(w.performance,'now',{value:()=>clock});w.requestAnimationFrame=fn=>{rafs.set(++rafId,fn);return rafId;};w.cancelAnimationFrame=id=>rafs.delete(id);
w.HTMLElement.prototype.scrollIntoView=function(){};
w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
w.fetch=async url=>{if(String(url).startsWith('https:'))throw Error('Network disabled');const data=fs.readFileSync(path.join(web,String(url).split('?')[0]));return {ok:true,json:async()=>JSON.parse(data)};};
w.HTMLElement.prototype.setPointerCapture=function(id){pending.set(id,this);};
w.HTMLElement.prototype.hasPointerCapture=function(id){return captured.get(id)===this;};
Object.defineProperty(w.navigator,'languages',{value:['zh-CN'],configurable:true});
for(const file of ['locale.js','motion.js','reading-structure.js','app.js'])vm.runInContext(require('./legacy-fixture.cjs')(fs.readFileSync(path.join(codeDir,file),'utf8')),ctx);
const run=code=>vm.runInContext(code,ctx),tick=()=>new Promise(r=>setTimeout(r,0));
function check(name,fn){try{fn();passed++;console.log('PASS',name);}catch(e){failed++;console.error('FAIL',name,'—',e.message);}}
function rect(el,left=24,top=330,width=342,height=72){const box={left,top,width,height,right:left+width,bottom:top+height,x:left,y:top};el.getBoundingClientRect=()=>box;return box;}
function emit(type,target,x,y,id,{primary=true,pointerType='touch'}={}){const e=new w.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{pointerId:id,pointerType,isPrimary:primary,button:0,clientX:x,clientY:y});target.dispatchEvent(e);return e;}
function pointer(type,target,x,y,{id=1,dt=16,...options}={}){
 clock+=dt;if(type==='pointerdown')captured.set(id,target);
 if(['pointermove','pointerup','pointercancel'].includes(type)){const old=captured.get(id),next=pending.get(id);pending.delete(id);if(next&&next!==old){captured.set(id,next);if(old?.isConnected)emit('lostpointercapture',old,x,y,id,options);emit('gotpointercapture',next,x,y,id,options);}target=captured.get(id)||target;}
 const e=emit(type,target,x,y,id,options);
 if(type==='pointerup'||type==='pointercancel'){const old=captured.get(id);captured.delete(id);pending.delete(id);if(old?.isConnected)emit('lostpointercapture',old,x,y,id,options);}
 return e;
}
function tap(target,{x=180,y=360,id=nextId++,pointerType='touch',click=false}={}){pointer('pointerdown',target,x,y,{id,pointerType});pointer('pointerup',target,x,y,{id,pointerType});if(click)compatClick(target,{id,x,y});return id;}
function compatClick(target,{id,x=180,y=360,legacy=false,detail=1}={}){const e=new w.MouseEvent('click',{bubbles:true,cancelable:true,detail,clientX:x,clientY:y});if(!legacy)Object.defineProperty(e,'pointerId',{value:id??-1});target.dispatchEvent(e);return e;}
function control(action,root=doc){const el=root.querySelector('.settings-row[data-action="'+action+'"]')||root.querySelector('[data-action="'+action+'"]');assert(el,action);rect(el);return el;}
function resetOverlay(){run('closeOverlay(true)');}
function count(action){return w.actions.filter(a=>a===action).length;}
function controlled(){w.HTMLElement.prototype.animate=function(frames,options){let resolve,reject;const a={target:this,frames,options,state:'running',finished:new Promise((yes,no)=>{resolve=yes;reject=no;}),finish(){if(this.state==='running'){this.state='finished';resolve();}},cancel(){if(this.state==='running'){this.state='cancelled';reject(Error('cancelled'));}}};animations.push(a);return a;};}
async function settle(){for(let j=0;j<32&&rafs.size;j++){clock+=16;const callbacks=[...rafs.values()];rafs.clear();callbacks.forEach(fn=>fn(clock));}for(let i=0;i<6;i++){for(const a of animations)if(a.state==='running')a.finish();await tick();}}
async function profile(){resetOverlay();const p=run('navigate("profile")');await settle();await p;}
async function reader(chapter=2){resetOverlay();const p=run(`openBook("little-prince",${chapter})`);await settle();await p;const image=doc.querySelector('#reader-scroll .illustration-open');assert(image,'Chapter must contain an illustration');rect(image,75,250,240,320);rect(image.querySelector('img'),75,250,240,320);return image;}
function dragImage(image,{from=260,to=110,slow=false,cancel=false,id=nextId++,y=400}={}){const target=image.querySelector('img');pointer('pointerdown',target,from,y,{id});for(let i=1;i<=5;i++)pointer('pointermove',target,from+(to-from)*i/5,y,{id,dt:slow?240:30});pointer(cancel?'pointercancel':'pointerup',target,to,y,{id,dt:slow?300:16});return id;}
(async()=>{
 for(let i=0;i<100&&!doc.querySelector('.hero-book');i++)await new Promise(r=>setTimeout(r,10));assert(doc.querySelector('.hero-book'));run("S.settings.verticalMode='chapter';S.settings.horizontalMode='slide';for(const fixtureBook of S.books)fixtureBook.readingModes={verticalMode:'chapter',horizontalMode:'slide'}");
 w.actions=[];run('const actualAction=action;action=async function(name,el){actions.push(name);return actualAction(name,el);}');
 if(process.env.TAP_IMAGE_REPRO_ONLY){
  await profile();tap(control('custom-colors'));
  check('Pointer-only first touch opens the profile card',()=>assert.equal(doc.querySelector('.sheet')?.getAttribute('aria-label'),'主题色彩'));
  const image=await reader();dragImage(image);await settle();
  check('Dragging directly on the illustration advances the chapter',()=>assert.equal(run('S.chapter'),3));
  console.log(`${passed} reproduction checks passed, ${failed} failed. Controlled event sequences only.`);dom.window.close();if(failed)process.exitCode=1;return;
 }
 await profile();let row=control('custom-colors');tap(row.querySelector('strong'));
 check('The first profile touch opens its card on release without any click event',()=>assert.equal(doc.querySelector('.sheet')?.getAttribute('aria-label'),'主题色彩'));
 resetOverlay();let opened=0;const menus=[['custom-colors','主题色彩'],['translation-settings','翻译服务'],['dictionary-info','词典与发音'],['reading-settings','主题与排版'],['library-settings','图书与存储'],['backup-settings','图书备份与恢复'],['edit-profile','怎么称呼你'],['privacy','隐私与数据'],['about','关于译读']];
 for(const [name,title] of menus)for(const part of ['i','strong','blank']){resetOverlay();row=control(name);tap(part==='blank'?row:row.querySelector(part));if(doc.querySelector('.sheet')?.getAttribute('aria-label')===title)opened++;}
 check('All nine profile cards accept their icon, label and row padding on the first touch',()=>assert.equal(opened,27));
 resetOverlay();row=control('reading-settings');tap(row,{x:25,y:331});
 check('A corner tap inside the full control remains a valid first tap',()=>assert.equal(doc.querySelector('.sheet')?.getAttribute('aria-label'),'主题与排版'));
 resetOverlay();run('translationTools()');let orb=control('toggle-orb'),before=run('S.settings.translateButton'),n=count('toggle-orb'),id=tap(orb);compatClick(orb,{id});
 check('A native click following touch release does not execute the switch twice',()=>{assert.equal(run('S.settings.translateButton'),!before);assert.equal(count('toggle-orb'),n+1);});
 before=run('S.settings.translateButton');n=count('toggle-orb');id=tap(orb);clock+=650;compatClick(orb,{id,legacy:true});
 check('A delayed legacy compatibility click is deduplicated without undoing the action',()=>{assert.equal(run('S.settings.translateButton'),!before);assert.equal(count('toggle-orb'),n+1);});
 before=run('S.settings.translateButton');n=count('toggle-orb');for(let i=0;i<12;i++)tap(orb,{id:1,click:true});
 check('Rapid consecutive touches with a reused Android pointer id all execute once',()=>{assert.equal(run('S.settings.translateButton'),before);assert.equal(count('toggle-orb'),n+12);});
 before=run('S.settings.translateButton');n=count('toggle-orb');for(let i=0;i<5;i++)tap(orb,{id:80+i});
 check('A new finger sequence never waits for a click or animation cooldown',()=>{assert.equal(run('S.settings.translateButton'),!before);assert.equal(count('toggle-orb'),n+5);});
 n=count('toggle-orb');id=tap(orb,{pointerType:'pen'});compatClick(orb,{id});
 check('Pen release activates once through the same control route',()=>assert.equal(count('toggle-orb'),n+1));
 n=count('toggle-orb');compatClick(orb,{detail:0});orb.click();
 check('Keyboard, accessibility and programmatic clicks retain their normal route',()=>assert.equal(count('toggle-orb'),n+2));
 n=count('toggle-orb');tap(orb,{pointerType:'mouse'});compatClick(orb,{legacy:true});
 check('Mouse activation continues to use click instead of firing on pointer release',()=>assert.equal(count('toggle-orb'),n+1));
 n=count('toggle-orb');pointer('pointerdown',orb,180,360,{id:90});pointer('pointermove',orb,180,367,{id:90});pointer('pointerup',orb,180,367,{id:90});
 check('Small finger jitter remains a valid tap with nonzero bounds',()=>assert.equal(count('toggle-orb'),n+1));
 n=count('toggle-orb');pointer('pointerdown',orb,180,360,{id:91});pointer('pointermove',orb,180,382,{id:91});pointer('pointerup',orb,180,382,{id:91});compatClick(orb,{id:91,y:382});
 check('Dragging a switch scrolls or pulls its card without toggling it on release',()=>assert.equal(count('toggle-orb'),n));
 await settle();n=count('toggle-orb');pointer('pointerdown',orb,180,360,{id:92});pointer('pointercancel',orb,180,360,{id:92});compatClick(orb,{id:92});
 check('Pointer cancellation cannot activate a control through a trailing click',()=>assert.equal(count('toggle-orb'),n));
 n=count('toggle-orb');pointer('pointerdown',orb,180,360,{id:93});orb.dispatchEvent(new w.Event('contextmenu',{bubbles:true}));pointer('pointerup',orb,180,360,{id:93});compatClick(orb,{id:93});
 check('A long-press context menu cancels ordinary button activation',()=>assert.equal(count('toggle-orb'),n));
 n=count('toggle-orb');pointer('pointerdown',orb,180,360,{id:94});pointer('pointerdown',orb,190,360,{id:95,primary:false});pointer('pointerup',orb,180,360,{id:94});pointer('pointerup',orb,190,360,{id:95,primary:false});
 check('A second finger cancels a pending control tap',()=>assert.equal(count('toggle-orb'),n));
 n=count('toggle-orb');pointer('pointerdown',orb,180,360,{id:106});Object.defineProperty(doc,'hidden',{value:true,configurable:true});doc.dispatchEvent(new w.Event('visibilitychange'));Object.defineProperty(doc,'hidden',{value:false,configurable:true});pointer('pointerup',orb,180,360,{id:106});compatClick(orb,{id:106});
 check('Backgrounding the app cancels a pending tap instead of executing on return',()=>assert.equal(count('toggle-orb'),n));
 n=count('toggle-orb');orb.disabled=true;tap(orb);orb.disabled=false;doc.querySelector('.sheet').setAttribute('inert','');tap(orb);doc.querySelector('.sheet').removeAttribute('inert');
 check('Disabled controls and an inert ancestor reject pointer-only activation',()=>assert.equal(count('toggle-orb'),n));
 resetOverlay();row=control('custom-colors');n=count('custom-colors');pointer('pointerdown',row,180,360,{id:96});row.remove();pointer('pointerup',doc.body,180,360,{id:96});
 check('A removed button is not invoked by a late pointer release',()=>assert.equal(count('custom-colors'),n));
 await profile();row=control('dictionary-info');pointer('pointerdown',row.querySelector('strong'),180,360,{id:97});captured.set(97,row);pointer('pointerup',row,180,360,{id:97});
 check('Retargeting release from animated contents to the stable row still opens the card',()=>assert.equal(doc.querySelector('.sheet')?.getAttribute('aria-label'),'词典与发音'));
 resetOverlay();row=control('translation-settings');pointer('pointerdown',row,180,360,{id:98});rect(row,24,280,342,72);pointer('pointerup',row,180,360,{id:98});
 check('A card moving during a tap keeps the original hit area valid',()=>assert.equal(doc.querySelector('.sheet')?.getAttribute('aria-label'),'翻译服务'));
 resetOverlay();row=control('reading-settings');n=count('reading-settings');pointer('pointerdown',row,180,360,{id:99});pointer('pointerup',row,180,500,{id:99});
 check('Releasing far outside the control does not open its card',()=>assert.equal(count('reading-settings'),n));
 row=control('reading-settings');n=count('reading-settings');pointer('pointerdown',row,180,360,{id:107});rect(row,0,0,0,0);pointer('pointerup',row,180,360,{id:107});compatClick(row,{id:107});
 check('A control hidden before release rejects the gesture and its compatibility click',()=>assert.equal(count('reading-settings'),n));
 await run('S.notes=[{id:"tap-review",type:"word",word:"lamb",meaning:"小羊",due:0}];navigate("notes")');const meaningButton=control('toggle-note-meanings');tap(meaningButton);
 check('The meaning switch accepts its first touch without opening a modal',()=>{assert(!doc.querySelector('#page-actions').hasAttribute('inert'));assert(doc.querySelector('.notes-page').classList.contains('meanings-hidden'));assert.equal(doc.querySelector('.sheet'),null);});await profile();
 controlled();const departure=run('navigate("search")');row=control('reading-settings');tap(row);await settle();await departure;
 check('A first touch can interrupt a pending navigation and open the visible setting',()=>{assert.equal(run('S.page'),'profile');assert.equal(doc.querySelector('.sheet')?.getAttribute('aria-label'),'主题与排版');});
 run('closeOverlay(true);translationTools()');orb=control('toggle-orb');n=count('toggle-orb');tap(orb);await settle();
 check('A button is usable before its card entry animation finishes',()=>assert.equal(count('toggle-orb'),n+1));
 const closing=run('closeOverlay()');row=control('dictionary-info');tap(row);await settle();await closing;
 check('A background card cannot open through an unfinished modal exit',()=>assert.equal(doc.querySelector('.sheet'),null));tap(row);await settle();
 check('A new card opens on the first fresh touch after the modal exit completes',()=>{assert.equal(doc.querySelector('.sheet')?.getAttribute('aria-label'),'词典与发音');assert(!doc.querySelector('#overlay-root').hasAttribute('inert'));});
 let image=await reader();run('toggleDock();S.settings.translateButton=!S.settings.translateButton;renderDock();toggleDock()');tap(control('theme'));
 check('Rebuilt reading controls become clickable again when immersive mode ends',()=>{assert(!doc.querySelector('.reading-dock-zone').hasAttribute('inert'));assert.equal(doc.querySelector('.sheet')?.getAttribute('aria-label'),'主题与排版');});
 image=await reader();let img=image.querySelector('img');tap(img,{x:190,y:400});
 check('A stationary touch on an illustration opens the image without waiting for click',()=>assert(doc.querySelector('.image-viewer')));
 let fullViewer=doc.querySelector('.image-viewer'),fullImage=fullViewer.querySelector('img'),fullId=nextId++;pointer('pointerdown',fullImage,180,390,{id:fullId});emit('lostpointercapture',fullImage,180,390,fullId);pointer('pointerup',fullImage,180,390,{id:fullId});await settle();
 check('An image child losing implicit capture before the viewer gains capture does not cancel an exit tap',()=>assert(!doc.querySelector('.image-viewer')));
 run('viewIllustration(currentChapter().illustrations[0].id)');await settle();fullViewer=doc.querySelector('.image-viewer');fullImage=fullViewer.querySelector('img');fullId=nextId++;pointer('pointerdown',fullImage,180,390,{id:fullId});pointer('pointerup',fullImage,180,470,{id:fullId});await settle();
 check('A drag delivered only as final release coordinates cannot be mistaken for an image exit tap',()=>assert(doc.querySelector('.image-viewer')));
 fullId=nextId++;pointer('pointerdown',fullViewer,4,500,{id:fullId});check('Image gestures are isolated from the global button tap recognizer',()=>assert.equal(run('controlTap'),null));pointer('pointerup',fullViewer,4,500,{id:fullId,dt:850});await settle();
 check('A stationary held tap anywhere on the image still exits without an arbitrary time cutoff',()=>assert(!doc.querySelector('.image-viewer')));
 run('viewIllustration(currentChapter().illustrations[0].id)');await settle();compatClick(doc.querySelector('.image-viewer img'),{detail:0});await settle();
 check('An accessibility click on the full-screen image follows the same exit route',()=>assert(!doc.querySelector('.image-viewer')));
 image=await reader();dragImage(image);await settle();
 check('A left drag starting on an illustration advances to the next chapter',()=>{assert.equal(run('S.chapter'),3);assert(!doc.querySelector('.image-viewer'));});
 image=await reader();dragImage(image,{from:110,to:270});await settle();
 check('A right drag starting on an illustration returns to the previous chapter',()=>{assert.equal(run('S.chapter'),1);assert(!doc.querySelector('.image-viewer'));});
 image=await reader();img=image.querySelector('img');pointer('pointerdown',img,260,400,{id:101});pointer('pointermove',img,256,400,{id:101,dt:180});pointer('pointermove',img,245,400,{id:101,dt:500});
 check('Slow motion over an image follows the finger and exposes the neighboring chapter',()=>{assert.equal(doc.querySelector('#reader-scroll').style.transform,'translate3d(-15px,0,0)');assert(doc.querySelector('.chapter-preview'));assert(!doc.querySelector('.image-viewer'));});
 pointer('pointermove',img,120,400,{id:101,dt:800});pointer('pointerup',img,120,400,{id:101,dt:500});await settle();
 check('A slow image drag commits by distance after a held release',()=>assert.equal(run('S.chapter'),3));
 image=await reader();pointer('pointerdown',image,260,400,{id:102});pointer('pointermove',image,120,400,{id:102,dt:200});pointer('pointerup',image,120,400,{id:102});await settle();
 check('Dragging the illustration button padding also switches chapters',()=>assert.equal(run('S.chapter'),3));
 image=await reader();n=count('view-illustration');id=dragImage(image,{to:240,slow:true});compatClick(doc.querySelector('#reader-scroll'),{id,x:240,y:400});await settle();
 check('A short image drag rebounds without opening the image or switching chapters',()=>{assert.equal(run('S.chapter'),2);assert.equal(count('view-illustration'),n);assert(!doc.querySelector('.image-viewer'));assert.equal(doc.querySelector('#reader-scroll').style.transform,'');});
 image=await reader();img=image.querySelector('img');n=count('view-illustration');pointer('pointerdown',img,190,400,{id:103});pointer('pointermove',img,192,480,{id:103});pointer('pointercancel',img,192,480,{id:103});compatClick(img,{id:103,x:192,y:480});await settle();
 check('Native vertical scrolling from an image neither switches chapters nor opens it',()=>{assert.equal(run('S.chapter'),2);assert.equal(count('view-illustration'),n);assert(!doc.querySelector('.chapter-preview'));});
 image=await reader();dragImage(image,{cancel:true});await settle();
 check('A cancelled image swipe restores the chapter and removes preview layers',()=>{assert.equal(run('S.chapter'),2);assert.equal(doc.querySelector('#reader-scroll').style.transform,'');assert(!doc.querySelector('.chapter-preview'));assert(!doc.querySelector('.image-viewer'));});
 image=await reader();img=image.querySelector('img');pointer('pointerdown',img,260,400,{id:104});pointer('pointermove',img,160,400,{id:104});pointer('pointerdown',img,230,420,{id:105,primary:false});pointer('pointerup',img,160,400,{id:104});pointer('pointerup',img,230,420,{id:105,primary:false});await settle();
 check('A second finger cancels an image swipe without opening or navigating',()=>{assert.equal(run('S.chapter'),2);assert(!doc.querySelector('.image-viewer'));assert(!doc.querySelector('.chapter-preview'));});
 image=await reader();const nativeDrag=new w.Event('dragstart',{bubbles:true,cancelable:true});image.querySelector('img').dispatchEvent(nativeDrag);
 check('Illustrations disable native image dragging so horizontal gestures stay with the reader',()=>{assert.equal(image.querySelector('img').draggable,false);assert(nativeDrag.defaultPrevented);});
 check('Image touch policy permits native vertical scrolling and pinch zoom',()=>{const css=fs.readFileSync(path.join(web,'style.css'),'utf8');assert(css.includes('.illustration-open{touch-action:pan-y pinch-zoom}'));});
 image=await reader(0);dragImage(image,{from:110,to:290});await settle();
 check('An image swipe at the first chapter cannot navigate before the book',()=>assert.equal(run('S.chapter'),0));
 // Use an illustration copied into the last chapter to exercise the same boundary route.
 run('S.book.chapters[26].illustrations=[{...S.book.chapters[2].illustrations[0],after:-1}]');image=await reader(26);dragImage(image);await settle();
 check('An image swipe at the last chapter cannot wrap around the book',()=>assert.equal(run('S.chapter'),26));
 console.log(`\n${passed} tap/image checks passed, ${failed} failed. Assigned geometry and synthetic events only.`);
 await settle();dom.window.close();if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
