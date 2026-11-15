/* Controlled DOM, event, I/O-count and idle/frame scheduling checks.
 * No Android motor, frame-time, GPU, or power measurement is claimed. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),{indexedDB,IDBKeyRange}=require('fake-indexeddb');
const web=path.join(__dirname,'../web'),dom=new JSDOM(fs.readFileSync(path.join(web,'index.html'),'utf8'),{url:'https://appassets.androidplatform.net/assets/index.html',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window,doc=w.document,ctx=dom.getInternalVMContext(),requests=[],frames=new Map(),idle=new Map(),images=[];
let clock=1000,serial=0,passed=0;
Object.assign(w,{indexedDB,IDBKeyRange,TextEncoder,TextDecoder,Blob,File,fflate:require('fflate'),innerWidth:390,innerHeight:844});
Object.defineProperty(w.performance,'now',{value:()=>clock});
w.HTMLElement.prototype.scrollIntoView=function(){};w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
w.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial;};w.cancelAnimationFrame=id=>frames.delete(id);
w.requestIdleCallback=(fn,options)=>{idle.set(++serial,{fn,options});return serial;};w.cancelIdleCallback=id=>idle.delete(id);
w.Image=class{constructor(){this.src='';images.push(this);}decode(){this.decoded=true;return Promise.resolve();}};
w.fetch=async url=>{if(String(url).startsWith('https:'))throw Error('Network disabled');const data=fs.readFileSync(path.join(web,String(url).split('?')[0]));return {ok:true,json:async()=>JSON.parse(data)};};
w.LumiNative={request(op,payload,id){requests.push({op,data:JSON.parse(payload)});queueMicrotask(()=>w.nativeReply(id,{ok:true,data:null}));}};
Object.defineProperty(w.navigator,'languages',{value:['zh-CN'],configurable:true});
for(const file of ['locale.js','motion.js','reading-structure.js','app.js'])vm.runInContext(require('./legacy-fixture.cjs')(fs.readFileSync(path.join(web,file),'utf8')),ctx);
const run=code=>vm.runInContext(code,ctx),wait=ms=>new Promise(r=>setTimeout(r,ms)),tick=()=>wait(0);
function check(name,fn){fn();passed++;console.log('PASS',name);}
function pulses(){return requests.filter(r=>r.op==='haptic');}
function clearRequests(){requests.length=0;clock+=100;}
function control(action){const el=doc.querySelector('[data-action="'+action+'"]');assert(el,action);el.getBoundingClientRect=()=>({left:24,top:300,right:366,bottom:380,width:342,height:80});return el;}
function pointer(type,target,x=180,y=340,id=1){clock+=16;const e=new w.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{pointerId:id,pointerType:'touch',isPrimary:true,button:0,clientX:x,clientY:y});target.dispatchEvent(e);return e;}
function tap(el,id=1){pointer('pointerdown',el,180,340,id);pointer('pointerup',el,180,340,id);const click=new w.MouseEvent('click',{bubbles:true,cancelable:true,detail:1,clientX:180,clientY:340});Object.defineProperty(click,'pointerId',{value:id});el.dispatchEvent(click);}
function input(el,value,type='input'){el.value=value;el.dispatchEvent(new w.Event(type,{bubbles:true}));}
async function mode(value){await run(`S.settings.hapticFeedback="${value}";saveSettings()`);clearRequests();}
async function open(chapter=0){run('closeOverlay(true)');run("S.settings.verticalMode='chapter';S.settings.horizontalMode='slide';for(const fixtureBook of S.books)fixtureBook.readingModes={verticalMode:'chapter',horizontalMode:'slide'}");await run(`openBook("little-prince",${chapter})`);clearRequests();}
(async()=>{
 for(let i=0;i<100&&!doc.querySelector('.hero-book');i++)await wait(10);assert(doc.querySelector('.hero-book'));
 async function swipe(dx,{dy=0,dt=300,chapter=2,image=false,hold=300,end='pointerup'}={}){await open(chapter);const target=doc.querySelector(image?'.illustration-open img':'.word');pointer('pointerdown',target,190,400,30);clock+=dt;pointer('pointermove',target,190+dx,400+dy,30);clock+=hold;pointer(end,target,190+dx,400+dy,30);await tick();return target;}
 await swipe(-40);check('A 40px slow left stroke advances a chapter',()=>assert.equal(run('S.chapter'),3));
 await swipe(40);check('A 40px slow right stroke returns a chapter',()=>assert.equal(run('S.chapter'),1));
 await swipe(-36,{image:true});check('A short slow stroke over an illustration switches without opening the image',()=>{assert.equal(run('S.chapter'),3);assert(!doc.querySelector('.image-viewer'));});
 await swipe(36,{image:true});check('Illustration strokes work in both directions at the shorter distance',()=>assert.equal(run('S.chapter'),1));
 await swipe(-24,{dt:0,hold:0});check('A 24px fast left flick advances',()=>assert.equal(run('S.chapter'),3));
 await swipe(24,{dt:0,hold:0});check('A 24px fast right flick returns',()=>assert.equal(run('S.chapter'),1));
 await open(2);let target=doc.querySelector('.illustration-open img');pointer('pointerdown',target,190,400,31);pointer('pointerup',target,166,400,31);await tick();
 check('A quick image stroke can commit from release coordinates when no move event arrived',()=>{assert.equal(run('S.chapter'),3);assert(!doc.querySelector('.image-viewer'));});
 await swipe(-24);check('A slow 24px sideways adjustment remains a rebound',()=>{assert.equal(run('S.chapter'),2);assert.equal(pulses().length,0);});
 await swipe(-14,{dt:0,hold:0});check('Tiny fast finger jitter does not turn chapters',()=>assert.equal(run('S.chapter'),2));
 await swipe(-40,{dy:60});check('Vertical-dominant scrolling cannot meet the shorter chapter trigger',()=>assert.equal(run('S.chapter'),2));
 await swipe(-40,{dy:30});check('Ambiguous diagonal gestures stay outside chapter switching',()=>assert.equal(run('S.chapter'),2));
 await open(2);target=doc.querySelector('.word');pointer('pointerdown',target,250,400,32);pointer('pointermove',target,190,400,32);pointer('pointermove',target,210,400,32);pointer('pointerup',target,210,400,32);await tick();
 check('Pulling back toward the origin still cancels a short chapter stroke',()=>{assert.equal(run('S.chapter'),2);assert.equal(pulses().length,0);});
 await swipe(-40,{end:'pointercancel'});check('Cancelling a short swipe never commits navigation',()=>assert.equal(run('S.chapter'),2));
 await swipe(40,{chapter:0});check('Short gestures respect the first chapter boundary',()=>assert.equal(run('S.chapter'),0));
 await swipe(-40,{chapter:26});check('Short gestures respect the last chapter boundary',()=>assert.equal(run('S.chapter'),26));
 await run('navigate("profile")');clearRequests();tap(control('custom-colors'));
 check('Default gentle mode gives a soft pulse to theme settings',()=>{assert.equal(pulses().length,1);assert.equal(pulses()[0].data.kind,'soft');assert.equal(pulses()[0].data.gentle,true);});
 clearRequests();tap(control('app-palette'));check('The theme palette button also has soft press feedback',()=>assert.deepEqual(pulses().map(x=>x.data.kind),['soft']));
 run('closeOverlay(true)');clearRequests();tap(control('translation-settings'));check('Translation settings receive feedback without switching to standard mode',()=>assert.deepEqual(pulses().map(x=>x.data.kind),['soft']));
 run('closeOverlay(true)');await run('navigate("search")');clearRequests();tap(control('search-tab'));check('Search tabs receive soft feedback',()=>assert.deepEqual(pulses().map(x=>x.data.kind),['soft']));
 doc.querySelector('#book-search').value='Prince';clearRequests();tap(control('submit-search'));await tick();
 check('A search arrow touch submits on release with exactly one pulse',()=>{assert.equal(run('S.search'),'Prince');assert.deepEqual(pulses().map(x=>x.data.kind),['soft']);});
 clearRequests();doc.querySelector('#search-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));check('Keyboard search submission keeps one matching feedback event',()=>assert.deepEqual(pulses().map(x=>x.data.kind),['soft']));
 await run('navigate("profile")');run('hapticSettings()');clearRequests();tap(control('preview-haptics'));check('Gentle preview represents the new soft-button sensation',()=>assert.deepEqual(pulses().map(x=>x.data.kind),['soft']));
 run('closeOverlay(true);typography()');let font=doc.querySelector('[data-setting="fontSize"]'),leading=doc.querySelector('[data-setting="leading"]');clearRequests();input(font,'23');
 check('Font size has a gentle tick in the default mode and applies instantly',()=>{assert.deepEqual(pulses().map(x=>x.data.kind),['segment']);assert.equal(pulses()[0].data.gentle,true);assert.equal(doc.querySelector('#font-value').textContent,'23px');});
 clearRequests();input(leading,'1.9');check('Line spacing also has a gentle default tick',()=>{assert.deepEqual(pulses().map(x=>x.data.kind),['segment']);assert.equal(doc.querySelector('#leading-value').textContent,'1.9');});
 clearRequests();input(leading,'1.9');check('An unchanged slider value does not create another tick',()=>assert.equal(pulses().length,0));
 clock+=100;input(leading,'1.95');clock+=5;input(leading,'2');clock+=5;input(leading,'2.05');
 check('Dense ticks are coalesced while every slider adjustment still applies',()=>{assert.equal(pulses().length,1);assert.equal(run('S.settings.leading'),2.05);});
 clearRequests();const handle=doc.querySelector('.sheet-handle');doc.querySelector('.sheet').getBoundingClientRect=()=>({left:12,top:200,width:366,height:500});pointer('pointerdown',handle,180,220,34);pointer('pointermove',handle,180,410,34);pointer('pointerup',handle,180,410,34);await tick();
 check('A committed downward card dismissal uses one soft sheet event',()=>{assert.deepEqual(pulses().map(x=>x.data.kind),['sheet']);assert(!doc.querySelector('.sheet'));});
 run('typography()');clearRequests();tap(control('close'));await tick();check('The close button gives one soft pulse rather than a second gesture pulse',()=>assert.deepEqual(pulses().map(x=>x.data.kind),['soft']));
 clearRequests();await run('navigate("shelf")');check('Main Dock selection requests the softened selection effect',()=>assert.deepEqual(pulses().map(x=>x.data.kind),['selection']));
 clearRequests();tap(control('nav-shelf'));check('Repeated current-Dock taps still get one soft response',()=>assert.deepEqual(pulses().map(x=>x.data.kind),['soft']));
 await mode('off');await run('navigate("profile")');clearRequests();tap(control('reading-settings'));run('closeOverlay(true);translationTools()');tap(control('toggle-orb'));run('closeOverlay(true);themes()');input(doc.querySelector('[data-setting="fontSize"]'),'25');
 check('Off mode still suppresses the expanded button and slider coverage',()=>assert.equal(pulses().length,0));
 console.log(`\n${passed} short-swipe/soft-feedback checks passed. Synthetic events only.`);dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
