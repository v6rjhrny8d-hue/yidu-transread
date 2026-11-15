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
async function open(chapter=0){run('closeOverlay(true)');await run(`openBook("little-prince",${chapter})`);for(let i=0;i<200&&!doc.querySelector('#reader-scroll').chapterBuild.done;i++){if(!idle.size)await wait(20);for(const [id,entry] of [...idle]){idle.delete(id);entry.fn({timeRemaining:()=>10,didTimeout:false});}}clearRequests();}
(async()=>{
 for(let i=0;i<100&&!doc.querySelector('.hero-book');i++)await wait(10);assert(doc.querySelector('.hero-book'));run("S.settings.verticalMode='chapter';S.settings.horizontalMode='slide';for(const fixtureBook of S.books)fixtureBook.readingModes={verticalMode:'chapter',horizontalMode:'slide'}");
 check('Existing installations retain gentle haptics after the additive resource-store upgrade',()=>{assert.equal(run('S.settings.hapticFeedback'),'gentle');assert.equal(run('db.version'),2);});
 await run('navigate("profile")');tap(control('haptic-settings'));let panel=doc.querySelector('.sheet');
 check('Profile exposes three touch-feedback modes and a preview control',()=>{assert.equal(panel.getAttribute('aria-label'),'交互与触感');assert.equal(panel.querySelectorAll('.haptic-option').length,3);assert(control('preview-haptics'));});
 let choice=panel.querySelector('[data-mode="off"]');w.choice=choice;await run('action("set-haptics",choice)');clearRequests();tap(control('preview-haptics'));
 check('Off mode suppresses preview and functional feedback',()=>{assert.equal(pulses().length,0);assert(doc.querySelector('#toast').textContent.includes('先选择'));assert.equal(run('haptic("confirm")'),false);});
 choice=panel.querySelector('[data-mode="standard"]');w.choice=choice;panel.scrollTop=90;await run('action("set-haptics",choice)');
 check('Changing feedback modes updates in place and persists the choice',()=>{assert.equal(doc.querySelector('.sheet'),panel);assert.equal(panel.scrollTop,90);assert.equal(choice.getAttribute('aria-pressed'),'true');assert.equal(run('S.settings.hapticFeedback'),'standard');});
 check('Enabling feedback emits one selection pulse',()=>{assert.equal(pulses().length,1);assert.equal(pulses()[0].data.kind,'selection');});
 const stored=await run('getAll("settings")');check('Feedback preference is stored with the existing settings record',()=>assert.equal(stored.find(x=>x.id==='main').hapticFeedback,'standard'));
 run('closeOverlay(true)');clearRequests();tap(control('reading-settings'));await tick();
 check('Pointer release plus compatibility click opens a card with exactly one standard pulse',()=>{assert.equal(doc.querySelector('.sheet').getAttribute('aria-label'),'主题与排版');assert.equal(pulses().length,1);assert.equal(pulses()[0].data.kind,'soft');});
 run('closeOverlay(true)');await mode('gentle');tap(control('reading-settings'));
 check('Gentle mode includes one soft pulse for ordinary card-opening taps',()=>{assert(doc.querySelector('.sheet'));assert.equal(pulses().length,1);assert.equal(pulses()[0].data.kind,'soft');});
 run('closeOverlay(true);translationTools()');clearRequests();tap(control('toggle-orb'));tap(control('toggle-orb'),2);
 check('Consecutive switch taps both apply and emit one pulse each without cooldown',()=>{assert.deepEqual(pulses().map(x=>x.data.kind),['toggle-off','toggle-on']);assert.equal(run('S.settings.translateButton'),true);});
 run('closeOverlay(true)');clearRequests();await run('navigate("search")');await run('action("nav-search",document.querySelector("[data-action=nav-search]"))');
 check('Navigation changes and repeated current-tab taps each receive one pulse',()=>assert.deepEqual(pulses().map(x=>x.data.kind),['selection','soft']));
 await open();const word=doc.querySelector('#reader-scroll .word');w.word=word;await run('lookup(word)');
 check('Frequent word lookups do not add custom haptics in reading',()=>assert.equal(pulses().length,0));
 await Promise.all([run('saveWord()'),run('saveWord()')]);
 check('A completed word collection emits one confirmation despite duplicate taps',()=>assert.deepEqual(pulses().map(x=>x.data.kind),['confirm']));
 clearRequests();await run('saveWord()');check('Removing a collected word uses a lighter off effect',()=>assert.deepEqual(pulses().map(x=>x.data.kind),['toggle-off']));
 clearRequests();run('const actualPut=put;put=(store,data)=>store==="notes"?Promise.reject(Error("fixture write failed")):actualPut(store,data)');await assert.rejects(run('saveWord()'));run('put=actualPut');
 check('Failed storage does not claim success through a confirmation pulse',()=>{assert.equal(pulses().length,0);assert(!doc.querySelector('[data-action="save-word"]').disabled);});
 run('closeOverlay(true)');const paragraph=doc.querySelector('.original'),range=doc.createRange();range.selectNodeContents(paragraph);w.getSelection().addRange(range);clearRequests();await run('saveSentence()');
 check('Sentence collection confirms after successful persistence',()=>assert.deepEqual(pulses().map(x=>x.data.kind),['confirm']));
 clearRequests();run('toggleTranslate()');check('Translation feedback occurs once for the switch rather than once per paragraph',()=>assert.deepEqual(pulses().map(x=>x.data.kind),['soft']));
 run('toggleTranslate()');clearRequests();await run('changeChapter(1)');await run('changeChapter(1)');await run('changeChapter(-1)');
 check('Chapter confirmation is emitted once for a valid committed change',()=>assert.deepEqual(pulses().map(x=>x.data.kind),['gesture']));
 clearRequests();let target=doc.querySelector('.word');pointer('pointerdown',target,250,400,4);pointer('pointermove',target,230,400,4);clock+=400;pointer('pointerup',target,230,400,4);
 check('Short chapter drags rebound silently without changing chapter',()=>{assert.equal(run('S.chapter'),1);assert.equal(pulses().length,0);});
 Object.defineProperty(doc,'hidden',{value:true,configurable:true});doc.dispatchEvent(new w.Event('visibilitychange'));clearRequests();run('haptic("confirm")');
 check('Backgrounded pages do not request haptic feedback',()=>{assert.equal(pulses().length,0);assert.equal(run('readerPreparation'),null);assert.equal(run('preparedImages.size'),0);});Object.defineProperty(doc,'hidden',{value:false,configurable:true});
 await mode('standard');clearRequests();for(let i=0;i<10;i++){run('haptic("segment")');clock+=5;}clock+=80;run('haptic("segment")');
 check('Only dense haptic ticks are rate-limited',()=>{assert.equal(pulses().length,2);assert(pulses().every(x=>x.data.kind==='segment'));});
 await mode('off');run('haptic("selection");haptic("gesture");haptic("toggle-on");haptic("confirm")');check('Off mode applies consistently to all app feedback semantics',()=>assert.equal(pulses().length,0));
 await mode('standard');await run('navigate("profile")');run('themes()');clearRequests();let font;
 run('closeOverlay(true);typography()');font=doc.querySelector('[data-setting="fontSize"]');
 w.settingsWrites=0;run('const savedPut=put;put=(store,data)=>{if(store==="settings")settingsWrites++;return savedPut(store,data)}');
 clearRequests();for(let n=17;n<=31;n++)input(font,String(n));
 check('Slider values and visual labels update immediately while writes are coalesced',()=>{assert.equal(run('S.settings.fontSize'),31);assert.equal(doc.querySelector('#font-value').textContent,'31px');assert.equal(w.settingsWrites,0);});
 check('Font changes do not repeatedly notify the native system theme',()=>assert.equal(requests.filter(x=>x.op==='theme').length,0));
 input(font,'31','change');await tick();check('Releasing a slider immediately flushes exactly one settings write',()=>assert.equal(w.settingsWrites,1));await wait(210);
 check('A completed slider change leaves no delayed duplicate write',()=>assert.equal(w.settingsWrites,1));
 input(font,'24');await wait(210);check('Idle slider adjustments are automatically saved once',()=>{assert.equal(w.settingsWrites,2);assert.equal(run('S.settings.fontSize'),24);});run('put=savedPut');
 clearRequests();for(let i=0;i<20;i++)run('setTheme()');check('Repeated theme application reuses native state',()=>assert.equal(requests.filter(x=>x.op==='theme').length,0));
 run('S.settings.appearance="dark";setTheme();setTheme()');check('A real dark-mode change still updates native system bars once',()=>assert.equal(requests.filter(x=>x.op==='theme').length,1));run('S.settings.appearance="light";setTheme()');
 let removes=0;const style=doc.body.style,remove=style.removeProperty.bind(style);style.removeProperty=name=>{removes++;return remove(name);};for(let i=0;i<10;i++)run('setTheme()');
 check('Unchanged palettes avoid rebuilding all custom color properties',()=>assert.equal(removes,0));style.removeProperty=remove;
 w.tokenCalls=0;run('const realTokenizer=tokenizeUncached;tokenizeUncached=text=>{tokenCalls++;return realTokenizer(text)}');w.sample='A lamb & a fox <script>éclair</script>';
 const markup=run('tokenize(sample)');run('tokenize(sample);tokenize(sample)');
 check('Repeated text is tokenized once without changing escaped output',()=>{assert.equal(w.tokenCalls,1);assert(markup.includes('&amp;'));assert(!markup.includes('<script>'));assert.equal(markup,run('realTokenizer(sample)'));});
 for(let i=0;i<350;i++){w.sample=('Sample '+i+' ').repeat(35);run('tokenize(sample)');}
 check('The text cache has both entry and total-character limits',()=>{assert(run('tokenCache.size<=256'));assert(run('tokenCacheChars<=400000'));});
 w.large='Long sentence. '.repeat(10000);const long=run('tokenize(large)');check('Oversized text is fully rendered without being retained in the cache',()=>{assert.equal(long,run('realTokenizer(large)'));assert.equal(run('tokenCache.has(large)'),false);});
 const baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/motion-0.4.7.json'),'utf8'));
 check('Spring samples exactly match the previous release for representative interactions',()=>{for(const item of baseline.cases){const frames=w.ReaderMotion.spring(...item.args);assert.deepEqual(JSON.parse(JSON.stringify(frames)),item.frames);}});
 const first=w.ReaderMotion.spring(...baseline.cases[0].args);first[0].value=999;
 check('Cached spring curves cannot be corrupted by a caller',()=>assert.equal(w.ReaderMotion.spring(...baseline.cases[0].args)[0].value,0));
 const motionSource=fs.readFileSync(path.join(web,'motion.js'),'utf8'),timing=JSON.parse(motionSource.match(/const timing=(\{[^;]+\});/)[1].replace(/([A-Za-z]+):/g,'"$1":'));
 check('Only card entrance timing changes for the requested spring',()=>{const {sheetIn,popIn,...rest}=timing,{sheetIn:oldSheet,popIn:oldPop,...previous}=baseline.timing;assert.deepEqual(rest,previous);assert(sheetIn>oldSheet&&sheetIn<=500);assert(popIn>oldPop&&popIn<=450);});
 await open(2);let scroll=doc.querySelector('#reader-scroll');Object.defineProperties(scroll,{scrollHeight:{value:2000,configurable:true},clientHeight:{value:500,configurable:true}});frames.clear();run('window.originalSourceRatio=sourceReadingRatio;sourceReadingRatio=sc=>sc.scrollTop/1500');
 for(let i=0;i<20;i++){scroll.scrollTop=i*20;scroll.dispatchEvent(new w.Event('scroll'));}
 check('A burst of scroll events schedules only one progress paint',()=>assert.equal(frames.size,1));
 for(const [id,fn] of [...frames]){frames.delete(id);fn(clock);}
 check('The coalesced progress paint uses the latest scroll position',()=>assert(Math.abs(Number(doc.querySelector('#reading-line').style.transform.match(/scaleX\(([^)]+)\)/)[1])-run('weightedProgress(S.book,2,380/1500)'))<1e-9));
 run('sourceReadingRatio=originalSourceRatio');scroll.dispatchEvent(new w.Event('scroll'));await run('navigate("profile")');check('Leaving reading cancels pending progress work',()=>{assert.equal(frames.size,0);assert.equal(run('progressTarget'),null);});
 const mock=doc.createElement('div');let reads=0;for(let i=0;i<1024;i++){const el=doc.createElement('div');el.className='para';el.dataset.para=i;el.getBoundingClientRect=()=>{reads++;return {bottom:(i-850)*80+80};};mock.appendChild(el);}w.mock=mock;
 check('Finding the visible paragraph preserves the anchor with logarithmic layout reads',()=>{assert.equal(run('firstVisibleParagraph(mock,24).dataset.para'),'850');assert(reads<=11);});
 await open(2);run('tokenCache.clear();tokenCacheChars=0;tokenCalls=0;scheduleReaderPreparation()');await wait(420);
 check('Adjacent preparation waits for idle time instead of running during entry',()=>{assert.equal(w.tokenCalls,0);assert.equal(idle.size,1);assert.equal([...idle.values()][0].options.timeout,1200);});
 let count=0;while(idle.size&&count++<200){const [id,entry]=idle.entries().next().value;idle.delete(id);const before=w.tokenCalls;entry.fn({timeRemaining:()=>10,didTimeout:false});assert(w.tokenCalls-before<=2);}
 check('Preparation runs in bounded slices and keeps at most two nearby images',()=>{assert.equal(run('readerPreparation'),null);assert(run('preparedImages.size<=2'));assert(w.tokenCalls>0);assert(images.some(x=>x.decoded));assert(images.every(x=>!x.src||x.src.startsWith('assets/')||x.src.startsWith('data:')));});
 run('scheduleReaderPreparation()');await wait(420);target=doc.querySelector('.word');pointer('pointerdown',target,200,400,11);
 check('A new touch immediately cancels optional idle preparation',()=>{assert.equal(idle.size,0);assert.equal(run('readerPreparation'),null);});pointer('pointercancel',target,200,400,11);
 await run('navigate("profile")');check('Leaving a book releases its optional decoded-image references',()=>{assert.equal(run('preparedImages.size'),0);assert.equal(run('readerPreparation'),null);});
 clearRequests();w.nativeFailure=true;const bridge=w.LumiNative;w.LumiNative={request(op,payload,id){if(op==='haptic')queueMicrotask(()=>w.nativeReply(id,{ok:false,error:'fixture unavailable'}));else bridge.request(op,payload,id);}};tap(control('reading-settings'));await tick();
 check('Unavailable haptics never delay or fail the original button action',()=>assert.equal(doc.querySelector('.sheet').getAttribute('aria-label'),'主题与排版'));
 delete w.LumiNative;check('Browser fallback silently ignores functional haptics',()=>assert.equal(run('haptic("confirm")'),false));
 console.log(`\n${passed} haptic/performance checks passed. Operation counts and synthetic scheduling only.`);dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
