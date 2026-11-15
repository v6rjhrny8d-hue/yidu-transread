/* Landscape constraints and interruptible release motion. Synthetic DOM/WAAPI,
 * assigned geometry and CSS contracts only, not a rendered phone or FPS test. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),{indexedDB,IDBKeyRange}=require('fake-indexeddb');
const web=path.join(__dirname,'../web'),dom=new JSDOM(fs.readFileSync(path.join(web,'index.html'),'utf8'),{url:'https://appassets.androidplatform.net/assets/index.html',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window,doc=w.document,ctx=dom.getInternalVMContext(),animations=[],frames=new Map();let clock=1000,fid=0,passed=0;
Object.assign(w,{indexedDB,IDBKeyRange,TextEncoder,TextDecoder,Blob,File,fflate:require('fflate'),innerWidth:390,innerHeight:844});
Object.defineProperty(w.performance,'now',{value:()=>clock});w.requestAnimationFrame=cb=>{frames.set(++fid,cb);return fid;};w.cancelAnimationFrame=id=>frames.delete(id);
w.HTMLElement.prototype.scrollIntoView=function(){};w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
w.fetch=async url=>{if(String(url).startsWith('https:'))throw Error('Network disabled');const b=fs.readFileSync(path.join(web,String(url).split('?')[0]));return {ok:true,json:async()=>JSON.parse(b)};};
w.HTMLElement.prototype.animate=function(keyframes,options){let resolve,reject;const a={target:this,keyframes,options,state:'running',finished:new Promise((a,b)=>{resolve=a;reject=b;}),finish(){if(this.state==='running'){this.state='finished';resolve();}},cancel(){if(this.state==='running'){this.state='cancelled';reject(Error('cancelled'));}}};animations.push(a);return a;};
Object.defineProperty(w.navigator,'languages',{value:['zh-CN'],configurable:true});
for(const file of ['locale.js','motion.js','reading-structure.js','app.js'])vm.runInContext(require('./legacy-fixture.cjs')(fs.readFileSync(path.join(web,file),'utf8')),ctx);
const run=code=>vm.runInContext(code,ctx),wait=ms=>new Promise(r=>setTimeout(r,ms)),tick=()=>wait(0);
function check(name,fn){fn();passed++;console.log('PASS',name);}
async function settle(){for(let i=0;i<8;i++){animations.filter(a=>a.state==='running').forEach(a=>a.finish());await tick();}}
function flush(){let loops=0;while(frames.size){assert(++loops<100);const batch=[...frames.values()];frames.clear();clock+=16;batch.forEach(cb=>cb(clock));}}
function pointer(type,target,x,y,dt=16){clock+=dt;const e=new w.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{pointerId:22,pointerType:'touch',isPrimary:true,button:0,clientX:x,clientY:y});target.dispatchEvent(e);}
async function open(chapter=2){run('closeOverlay(true)');const p=run(`openBook("little-prince",${chapter})`);await settle();await p;return doc.querySelector('.word');}
const shift=f=>Number(f.transform.match(/translate3d\(([-\d.]+)/)[1]);
(async()=>{
 for(let i=0;i<100&&!doc.querySelector('.hero-book');i++)await wait(10);assert(doc.querySelector('.hero-book'));run("S.settings.verticalMode='chapter';S.settings.horizontalMode='slide';for(const fixtureBook of S.books)fixtureBook.readingModes={verticalMode:'chapter',horizontalMode:'slide'}");await settle();
 check('Release trajectories are densely sampled for high-refresh displays, stay bounded and finish at rest',()=>{for(const x of [-844,-300,-25,25,300,844])for(const v of [-5,-.5,0,.5,5]){w.x=x;w.v=v;const m=run('readerInertia(x,v)');assert(m.duration>=90&&m.duration<=300);assert.equal(m.samples.length,65);assert.equal(m.samples[0].value,0);assert.equal(m.samples.at(-1).value,1);assert(m.samples.every(p=>Number.isFinite(p.value)&&p.value>=-.06&&p.value<=1));}});
 check('Fast same-direction releases settle sooner than slow releases at the same distance',()=>assert(run('readerInertia(320,-2).duration')<run('readerInertia(320,-.2).duration')));
 check('Forward inertia is monotonic and decelerates toward the last frame',()=>{const s=run('readerInertia(300,-.8).samples');assert(s.every((p,i)=>i===0||p.value>=s[i-1].value));assert(s.at(-1).value-s.at(-2).value<s[17].value-s[16].value);});
 let word=await open(),sc=doc.querySelector('#reader-scroll'),reader=doc.querySelector('#reader-scroll');
 run('S.book.position={chapter:S.chapter,paragraph:0,offset:30,scroll:200,ratio:.2}');sc.scrollTop=200;const anchor=doc.querySelector('[data-para="0"]');sc.getBoundingClientRect=()=>({top:0});anchor.getBoundingClientRect=()=>({top:80-(sc.scrollTop-200),bottom:240});
 w.innerWidth=844;w.innerHeight=390;w.dispatchEvent(new w.Event('resize'));flush();
 check('Rotation keeps the reader nodes and restores the saved paragraph offset',()=>{assert.equal(doc.querySelector('#reader-scroll'),reader);assert.equal(doc.querySelector('.word'),word);assert.equal(anchor.getBoundingClientRect().top,30);});
 // Mobile orientation and insets may arrive as two size events in one frame.
 run('S.book.position={chapter:S.chapter,paragraph:0,offset:30,scroll:200,ratio:.2}');
 w.innerWidth=390;w.innerHeight=844;w.dispatchEvent(new w.Event('resize'));w.innerHeight=830;w.dispatchEvent(new w.Event('resize'));flush();
 check('Coalesced orientation and inset events retain the same pending reading anchor',()=>assert.equal(anchor.getBoundingClientRect().top,30));
 w.innerWidth=844;w.innerHeight=390;w.dispatchEvent(new w.Event('resize'));const changedChapter=run('changeChapter(4)');const newScroll=doc.querySelector('#reader-scroll');newScroll.scrollTop=17;flush();
 check('A pending rotation restore cannot move a newly selected chapter',()=>assert.equal(newScroll.scrollTop,17));await settle();await changedChapter;await open();
 run('themes()');await settle();const panel=doc.querySelector('.sheet');w.innerWidth=780;w.innerHeight=360;w.dispatchEvent(new w.Event('resize'));flush();
 check('Viewport changes retain the open theme panel, its controls and clear backdrop',()=>{assert.equal(doc.querySelector('.sheet'),panel);assert(doc.querySelector('.preview-backdrop'));assert(doc.querySelector('[data-setting="fontSize"]'));});run('closeOverlay(true)');
 word=await open();reader=doc.querySelector('#reader-scroll');pointer('pointerdown',word,460,160);pointer('pointermove',word,320,160,70);pointer('pointerup',word,320,160,12);
 let incoming=doc.querySelector('#reader-scroll'),outgoing=doc.querySelector('.chapter-outgoing'),entry=animations.findLast(a=>a.target===incoming),exit=animations.findLast(a=>a.target===outgoing);
 check('Chapter release uses sampled inertia while committing input immediately',()=>{assert.equal(run('S.chapter'),3);assert(entry.keyframes.length>20);assert.equal(entry.options.easing,'linear');assert(!incoming.inert);assert(outgoing.inert);});
 check('Incoming and outgoing chapters remain joined for every inertia frame',()=>{assert.equal(entry.keyframes.length,exit.keyframes.length);assert.equal(entry.options.duration,exit.options.duration);entry.keyframes.forEach((f,i)=>assert(Math.abs(shift(f)-shift(exit.keyframes[i])-780)<.001));assert.equal(shift(entry.keyframes.at(-1)),0);assert.equal(shift(exit.keyframes.at(-1)),-780);});
 incoming.style.transform='translate3d(60px,0,0)';outgoing.style.transform='translate3d(-720px,0,0)';word=doc.querySelector('.word');pointer('pointerdown',word,400,160);pointer('pointermove',word,380,160,100);
 check('A fresh touch interrupts the coast at its visible offset without waiting',()=>{assert.equal(incoming.style.transform,'translate3d(40px,0,0)');assert.equal(entry.state,'cancelled');assert.equal(run('S.chapter'),3);});
 w.innerWidth=390;w.innerHeight=844;w.dispatchEvent(new w.Event('resize'));flush();await settle();
 check('Rotation during a grabbed coast clears old-width transforms and previews',()=>{assert.equal(run('readerSwipe'),null);assert.equal(run('readerVisual'),null);assert.equal(incoming.style.transform,'');assert.equal(doc.querySelector('.chapter-preview'),null);assert.equal(doc.querySelectorAll('#reader-scroll').length,1);});
 await open();run('S.settings.reducedMotion=true');const old=animations.length;word=doc.querySelector('.word');pointer('pointerdown',word,240,400);pointer('pointermove',word,180,400,100);pointer('pointerup',word,180,400);check('Reduced motion commits the chapter without a settling animation',()=>{assert.equal(run('S.chapter'),3);assert.equal(animations.length,old);assert.equal(doc.querySelector('#reader-scroll').style.transform,'');});run('S.settings.reducedMotion=false');
 w.innerWidth=844;w.innerHeight=390;w.dispatchEvent(new w.Event('resize'));flush();
 check('Landscape word bounds use the available height above the dock',()=>{const b=run('wordPopoverBounds(180,390,24,18,300)');assert.equal(b.top,36);assert.equal(b.height,252);assert(b.top+b.height<=300);});
 await open();run('viewIllustration(document.querySelector(".illustration-open").dataset.imageId)');await settle();let viewer=doc.querySelector('.image-viewer');viewer.querySelector('img').style.transform='translate3d(90px,20px,0) scale(2)';w.innerWidth=390;w.innerHeight=844;w.dispatchEvent(new w.Event('resize'));flush();
 check('Rotating a fullscreen illustration keeps it open and fits it to the new viewport',()=>{assert.equal(doc.querySelector('.image-viewer'),viewer);assert.equal(viewer.querySelector('img').style.transform,'translate3d(0px,0px,0) scale(1)');});run('closeOverlay(true)');
 doc.head.insertAdjacentHTML('beforeend','<style>'+fs.readFileSync(path.join(web,'style.css'),'utf8')+'</style>');
 const media=[...doc.styleSheets[doc.styleSheets.length-1].cssRules].find(r=>r.conditionText?.includes('orientation:landscape')&&r.conditionText.includes('max-height:600px'));assert(media);
 const rule=selector=>[...media.cssRules].find(r=>r.selectorText?.split(',').map(s=>s.trim()).includes(selector))?.style;
 check('Landscape theme and directory share a bounded centered footer',()=>{const css=fs.readFileSync(path.join(web,'style.css'),'utf8');assert.match(css,/\.sheet\.theme-settings-sheet\{max-width:640px/);assert.match(css,/width:min\(100%,400px\);align-self:center;justify-self:center/);assert.match(css,/\.preview-backdrop:has\(>\.theme-settings-sheet\)\{justify-content:center\}/);});
 check('Landscape directory separates progress and chapter scrolling into two columns',()=>{assert.equal(rule('.toc-sheet').display,'grid');assert.equal(rule('.toc-scroll').getPropertyValue('grid-column'),'2');assert.equal(rule('.toc-progress').getPropertyValue('grid-column'),'1');});
 check('Main navigation and review actions use compact safe-area offsets',()=>{assert.equal(rule('.dock').height,'56px');assert.match(rule('.dock-zone').bottom,/safe-bottom/);assert.match(rule('.notes-page').getPropertyValue('padding-bottom'),/142px.*safe-bottom/);});
 check('Shelf, notes, illustrations and word cards have landscape-specific width constraints',()=>{assert.match(rule('.book-grid').getPropertyValue('grid-template-columns'),/repeat\(5/);assert.match(rule('.notes-list').getPropertyValue('grid-template-columns'),/repeat\(2/);assert.equal(rule('.book-illustration img').getPropertyValue('max-height'),'70dvh');assert.equal(rule('.word-popover').left,'auto');});
 console.log(`\n${passed} landscape/inertia checks passed. Synthetic geometry and CSS contracts only.`);dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
