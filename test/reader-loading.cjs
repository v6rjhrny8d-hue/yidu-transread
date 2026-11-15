/* Cold entry, incremental DOM, interrupted work and high-rate input contracts.
 * Controlled scheduling/geometry, not measured Android frame rates. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),{indexedDB,IDBKeyRange}=require('fake-indexeddb');
const web=path.join(__dirname,'../web'),dom=new JSDOM(fs.readFileSync(path.join(web,'index.html'),'utf8'),{url:'https://appassets.androidplatform.net/assets/index.html',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window,doc=w.document,ctx=dom.getInternalVMContext(),idle=new Map(),frames=new Map(),observed=new Set();let clock=1000,serial=0,passed=0;
Object.assign(w,{indexedDB,IDBKeyRange,TextEncoder,TextDecoder,Blob,File,fflate:require('fflate'),innerWidth:390,innerHeight:844});Object.defineProperty(w.performance,'now',{value:()=>clock});
w.requestIdleCallback=(fn,options)=>{idle.set(++serial,{fn,options});return serial;};w.cancelIdleCallback=id=>idle.delete(id);
w.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial;};w.cancelAnimationFrame=id=>frames.delete(id);
w.IntersectionObserver=class{observe(el){observed.add(el);}unobserve(el){observed.delete(el);}disconnect(){observed.clear();}};
w.HTMLElement.prototype.scrollIntoView=function(){this.closest('#reader-scroll').centered=this.dataset.para;};
w.fetch=async url=>{assert(!String(url).startsWith('https:'));return {ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(web,String(url).split('?')[0]),'utf8'))};};
Object.defineProperty(w.navigator,'languages',{value:['zh-CN'],configurable:true});for(const file of ['locale.js','motion.js','reading-structure.js','app.js'])vm.runInContext(require('./legacy-fixture.cjs')(fs.readFileSync(path.join(web,file),'utf8')),ctx);
const run=code=>vm.runInContext(code,ctx),wait=ms=>new Promise(r=>setTimeout(r,ms));
function check(label,fn){fn();passed++;console.log('PASS',label);}
function oneIdle(deadline={timeRemaining:()=>10,didTimeout:false}){const entry=idle.entries().next().value;assert(entry,'idle work exists');idle.delete(entry[0]);clock+=8.33;entry[1].fn(deadline);}
function active(){let n=0;while(!doc.querySelector('#reader-scroll').chapterBuild.done){assert(++n<500);oneIdle();}}
function pointer(type,x,y=400){clock+=2;const el=doc.querySelector('.chapter-stage');const e=new w.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{pointerId:11,pointerType:'touch',isPrimary:true,button:0,clientX:x,clientY:y});el.dispatchEvent(e);}
function frame(){const batch=[...frames.values()];frames.clear();clock+=8.33;batch.forEach(fn=>fn(clock));}
(async()=>{
 for(let i=0;i<100&&!doc.querySelector('.hero-book');i++)await wait(10);assert(doc.querySelector('.hero-book'));run("S.settings.verticalMode='chapter';S.settings.horizontalMode='slide';for(const fixtureBook of S.books)fixtureBook.readingModes={verticalMode:'chapter',horizontalMode:'slide'}");
 w.fixture={id:'loading-fixture',readingModes:{verticalMode:'chapter',horizontalMode:'slide'},title:'Large book',language:'en',chapters:Array.from({length:16},(_,chapter)=>({title:'Part '+chapter,paragraphs:Array.from({length:80},(_,i)=>`Chapter ${chapter} paragraph ${i}. Quiet reading with words and more words.`),illustrations:chapter===0?[{id:'late-image',after:50,src:'assets/prince-illustrations/ch01-01.jpg',width:500,height:350}]:[]}))};
 run('S.books.push(fixture);var savedTokenize=tokenize,tokenizeCalls=0;tokenize=t=>{tokenizeCalls++;return savedTokenize(t)}');
 await run('openBook(fixture.id,0)');let sc=doc.querySelector('#reader-scroll'),first=sc.querySelector('.word');
 check('A cold open renders a readable first slice without synchronously tokenizing all 80 paragraphs',()=>{assert(sc.querySelector('.chapter-heading'));assert(first);assert(run('tokenizeCalls')<=4);assert.equal(sc.querySelectorAll('.para').length,4);assert(sc.classList.contains('is-building'));});
 check('The next active slice has a short deadline and the incomplete chapter has no premature end buttons',()=>{assert.equal([...idle.values()][0].options.timeout,80);assert(w.getComputedStyle(sc).height!==null);assert(sc.querySelector('.chapter-loading'));});
 const before=run('tokenizeCalls');oneIdle({timeRemaining:()=>0,didTimeout:true});
 check('An expired idle deadline still processes only one paragraph',()=>assert.equal(run('tokenizeCalls')-before,1));
 const zero=run('tokenizeCalls');oneIdle({timeRemaining:()=>0,didTimeout:false});
 check('A callback without idle budget yields without doing chapter work',()=>assert.equal(run('tokenizeCalls'),zero));
 sc.scrollTop=120;active();
 check('Incremental completion preserves the original word node and reading scroll',()=>{assert.equal(sc.querySelector('.word'),first);assert.equal(sc.scrollTop,120);assert.equal(sc.querySelectorAll('.para').length,80);assert(!sc.classList.contains('is-building'));assert(!sc.querySelector('.chapter-loading'));assert(sc.querySelector('[data-image-id="late-image"]'));});
 check('Every paragraph is present once, in source order, with intact text and final navigation',()=>{assert.deepEqual([...sc.querySelectorAll('.para')].map(p=>Number(p.dataset.para)),Array.from({length:80},(_,i)=>i));assert.equal(sc.querySelector('[data-para="79"] .original').textContent,w.fixture.chapters[0].paragraphs[79]);assert(sc.querySelector('[data-action="next-chapter"]'));});
 run('cancelReaderPreparation();clearChapterPanes();tokenizeCalls=0');pointer('pointerdown',270);pointer('pointermove',240);
 const preview=doc.querySelector('.chapter-preview');
 check('A cold neighbouring chapter also creates at most four paragraphs during a drag',()=>{assert(preview);assert.equal(preview.querySelectorAll('.para').length,4);assert(run('tokenizeCalls')<=4);});
 for(let x=239;x>=170;x--)pointer('pointermove',x);
 check('Seventy input updates coalesce into one frame while retaining the latest finger position',()=>{assert.equal(frames.size,1);assert.equal(run('readerSwipe.offset'),-100);assert.equal(sc.style.transform,'translate3d(-30px,0,0)');});
 frame();check('The next frame paints the latest offset, with the two chapters joined',()=>{assert.equal(sc.style.transform,'translate3d(-100px,0,0)');assert.equal(preview.style.transform,'translate3d(290px,0,0)');});
 pointer('pointermove',155);pointer('pointerup',140);
 check('Release flushes the latest input and promotes the same partial preview without reparsing it',()=>{assert.equal(run('S.chapter'),1);assert.equal(doc.querySelector('#reader-scroll'),preview);assert.equal(run('readerSwipeFrame'),0);assert.equal(run('tokenizeCalls'),4);});
 await wait(0);sc=doc.querySelector('#reader-scroll');run('scheduleReaderPreparation()');active();
 run('cancelReaderPreparation();clearChapterPanes();tokenizeCalls=0');
 for(let i=0;i<10;i++){pointer('pointerdown',270);pointer('pointermove',210);pointer('pointerup',205);await wait(0);}
 check('Ten immediate chapter flicks commit all ten targets with bounded parsing per change',()=>{assert.equal(run('S.chapter'),11);assert(run('tokenizeCalls')<=40);assert.equal(doc.querySelectorAll('#reader-scroll').length,1);assert(run('chapterPanes.size<=5'));});
 // Deep resume must not overwrite saved progress with the temporarily rendered first slice.
 run('cancelReaderInteraction();clearChapterPanes();fixture.position={chapter:2,paragraph:60,offset:28,scroll:6000,ratio:.75}');await run('openBook(fixture.id)');sc=doc.querySelector('#reader-scroll');
 Object.defineProperties(sc,{clientHeight:{value:600,configurable:true},scrollHeight:{get(){return this.querySelectorAll('.para').length*100+100;},configurable:true}});sc.getBoundingClientRect=()=>({top:0,bottom:600});
 const proto=w.HTMLElement.prototype.getBoundingClientRect;w.HTMLElement.prototype.getBoundingClientRect=function(){if(this.matches?.('.para'))return {top:Number(this.dataset.para)*100-sc.scrollTop,bottom:(Number(this.dataset.para)+1)*100-sc.scrollTop,height:100};return proto.call(this);};
 run('savePosition(true)');
 check('A pending deep restore retains its saved chapter/anchor and exposes localized loading feedback',()=>{assert.equal(run('fixture.position.paragraph'),60);assert(sc.readerRestore);assert(doc.querySelector('.reader').classList.contains('is-restoring'));assert.equal(doc.querySelector('.reader-entry-loading').getAttribute('aria-hidden'),'false');});
 let steps=0;while(sc.readerRestore){assert(++steps<100);oneIdle();}
 check('Resume waits until the anchor can reach its saved offset, then removes the loading cover',()=>{assert.equal(sc.scrollTop,5972);assert(!sc.readerRestore);assert(!doc.querySelector('.reader').classList.contains('is-restoring'));assert.equal(sc.querySelector('[data-para="60"]').getBoundingClientRect().top,28);});active();run('savePosition(true)');
 check('Saving after progressive resume records the same viewport rather than a temporary start',()=>{assert.equal(run('fixture.position.paragraph'),59);assert.equal(run('fixture.position.offset'),-72);assert.equal(sc.querySelector('[data-para="60"]').getBoundingClientRect().top,28);});
 // UI language changes rebuild labels while retaining a deep reading anchor.
 await run('setAppLanguage("en")');sc=doc.querySelector('#reader-scroll');Object.defineProperties(sc,{clientHeight:{value:600,configurable:true},scrollHeight:{get(){return this.querySelectorAll('.para').length*100+100;},configurable:true}});sc.getBoundingClientRect=()=>({top:0,bottom:600});active();
 check('Switching interface language restores the deep viewport after its new localized pane loads',()=>{assert.equal(sc.querySelector('[data-para="60"]').getBoundingClientRect().top,28);assert(!sc.readerRestore);assert(!doc.querySelector('.reader').classList.contains('is-restoring'));});
 // In-flight cache invalidations: subsequent paragraphs must follow the latest UI settings.
 await run('openBook(fixture.id,3)');sc=doc.querySelector('#reader-scroll');run('toggleTranslate();setTranslationTarget("ja")');await wait(0);run('closeOverlay(true);scheduleReaderPreparation()');active();
 check('Changing translation target during loading applies the latest target to every appended paragraph',()=>{assert.equal(sc.querySelectorAll('[data-target="ja"]').length,80);assert.equal(sc.querySelectorAll('[data-target="zh-CN"]').length,0);assert.equal(observed.size,80);});
 run('toggleTranslate();scheduleReaderPreparation()');await run('openBook(fixture.id,4)');
 run('S.notes.push({id:"late-note",type:"sentence",bookId:fixture.id,chapter:4,paragraph:60,text:fixture.chapters[4].paragraphs[60].slice(0,18),selection:{startParagraph:60,startOffset:0,endParagraph:60,endOffset:18}});syncSavedHighlights();scheduleReaderPreparation()');active();
 check('A saved sentence beyond the first slice receives the correct chapter-relative annotation',()=>{const p=doc.querySelector('[data-para="60"]');assert.equal([...p.querySelectorAll('.saved-sentence')].map(el=>el.textContent).join(''),w.fixture.chapters[4].paragraphs[60].slice(0,18));assert(!doc.querySelector('[data-para="0"] .saved-sentence'));});
 await run('openBook(fixture.id,5)');const abandoned=doc.querySelector('#reader-scroll'),stale=[...idle.values()][0];const oldCount=abandoned.querySelectorAll('.para').length;await run('navigate("profile")');stale?.fn({timeRemaining:()=>10,didTimeout:false});
 check('Leaving a chapter cancels work and a late callback cannot mutate abandoned content',()=>{assert.equal(abandoned.querySelectorAll('.para').length,oldCount);assert.equal(run('readerPreparation'),null);assert(!doc.querySelector('.reader-entry-loading'));});
 run('fixture.position={chapter:1,paragraph:0,offset:0};S.settings.lastBook=fixture.id');await run('navigate("shelf")');await wait(420);const originalActive=run('S.book');oneIdle();oneIdle();const warmed=run('chapterPanes.get(chapterPaneKey(1,fixture,false))');
 check('Shelf preparation warms only the entry slice and does not change the active book or location',()=>{assert(warmed);assert(warmed.querySelector('.word'));assert.equal(run('S.book'),originalActive);assert.equal(run('S.page'),'shelf');assert(warmed.chapterBuild.next<=4);});
 run('tokenizeCalls=0');await run('openBook(fixture.id)');
 check('Opening the warmed book reuses its paragraph nodes without synchronous tokenization',()=>{assert.equal(doc.querySelector('#reader-scroll'),warmed);assert.equal(run('tokenizeCalls'),0);});
 const css=fs.readFileSync(path.join(web,'style.css'),'utf8');
 check('Loading indicators are delayed, respect reduced motion, and are absent on completed chapters',()=>{assert.match(css,/chapter-loading-in 140ms ease 180ms both/);assert.match(css,/body\.reduced-motion \.chapter-loading \.loading/);assert.match(css,/\.is-building \.reader-footer/);});
 console.log(`\n${passed} incremental-reader checks passed. No device FPS or pixel claims.`);dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
