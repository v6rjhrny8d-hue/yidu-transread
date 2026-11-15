/* Language routing, persistence, cached data and asynchronous races. All network
 * responses are controlled doubles; this does not verify a live translation API. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),{indexedDB,IDBKeyRange}=require('fake-indexeddb');
const web=path.join(__dirname,'../web'),dom=new JSDOM(fs.readFileSync(path.join(web,'index.html'),'utf8'),{url:'https://appassets.androidplatform.net/assets/index.html',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window,doc=w.document,ctx=dom.getInternalVMContext(),observers=[];let passed=0;
Object.assign(w,{indexedDB,IDBKeyRange,TextEncoder,TextDecoder,Blob,File,fflate:require('fflate'),innerWidth:390,innerHeight:844});w.HTMLElement.prototype.scrollIntoView=function(){};
w.IntersectionObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}unobserve(){}disconnect(){}};
w.fetch=async url=>{if(String(url).startsWith('https:'))throw Error('Live network forbidden');const b=fs.readFileSync(path.join(web,String(url).split('?')[0]));return {ok:true,json:async()=>JSON.parse(b)};};
Object.defineProperty(w.navigator,'languages',{value:['zh-CN'],configurable:true});
for(const file of ['locale.js','motion.js','reading-structure.js','app.js'])vm.runInContext(require('./legacy-fixture.cjs')(fs.readFileSync(path.join(web,file),'utf8')),ctx);
const run=code=>vm.runInContext(code,ctx),wait=ms=>new Promise(r=>setTimeout(r,ms)),tick=()=>wait(0);
function check(name,fn){fn();passed++;console.log('PASS',name);}
async function until(fn,label){for(let i=0;i<200&&!fn();i++)await wait(5);assert(fn(),label);}
async function open(chapter=0){run('closeOverlay(true)');await run(`openBook("little-prince",${chapter})`);}
function visibleFirst(){const el=doc.querySelector('.translation');assert(el);observers.at(-1).callback([{isIntersecting:true,target:el}]);return el;}
function deferredNet(){w.pending=[];w.mockNet=(url,options={})=>new Promise((resolve,reject)=>w.pending.push({url,options,resolve,reject}));run('net=mockNet');}
const response=text=>JSON.stringify([[[text,'original']]]);
(async()=>{
 for(let i=0;i<100&&!doc.querySelector('.hero-book');i++)await wait(10);assert(doc.querySelector('.hero-book'));await open();run('translationTools()');
 check('Language settings expose 20 supported targets and default to Simplified Chinese',()=>{assert.equal(run('TRANSLATION_LANGUAGES.length'),20);assert.equal(doc.querySelector('#translation-target').tagName,'BUTTON');assert.equal(doc.querySelector('#translation-target').value,'zh-CN');assert.equal(doc.querySelector('.sheet').getAttribute('aria-label'),'翻译与发音');});
 check('The Dock language settings and the translation shortcut have distinct icons',()=>{assert(doc.querySelector('.reading-dock [data-action="translation-tools"] .ph-globe'));assert.equal(doc.querySelector('.reading-dock [data-action="translation-tools"] span').textContent,'语言');assert(doc.querySelector('.translate-orb .ph-translate'));});
 check('Legacy Chinese caches stay usable but cannot be read as another target language',()=>{run('transCache.set("little-prince:0:0","旧版中文缓存")');assert.equal(run('cachedTranslation("little-prince",0,0,currentChapter(),"zh-CN")'),'旧版中文缓存');assert.equal(run('cachedTranslation("little-prince",0,0,currentChapter(),"ja")'),null);});
 run('closeOverlay(true);toggleParagraphTranslation(0);translationTools()');const panel=doc.querySelector('.sheet'),original=doc.querySelector('.original'),scroll=doc.querySelector('#reader-scroll');scroll.scrollTop=123;
 await run('setTranslationTarget("ja")');
 check('Switching language preserves the current panel, original words, scroll and single-paragraph choice',()=>{assert.equal(doc.querySelector('.sheet'),panel);assert.equal(doc.querySelector('.original'),original);assert.equal(scroll.scrollTop,123);assert.equal(doc.querySelectorAll('.translation').length,1);assert.equal(doc.querySelector('.paragraph-translate'),null);assert.equal(run('S.paragraphTranslations.has(paragraphVisibilityId(0))'),true);});
 check('Japanese translation placeholders never fall back to the bundled Chinese seed',()=>{const el=doc.querySelector('.translation');assert.equal(el.lang,'ja');assert.equal(el.dataset.pending,'true');assert(!el.textContent.includes('旧版中文缓存'));assert(!el.textContent.includes('当我'));});
 await run('setTranslationTarget("ar")');
 check('Right-to-left targets carry their own language and automatic text direction',()=>{assert.equal(doc.querySelector('.translation').lang,'ar');assert.equal(doc.querySelector('.translation').dir,'auto');});
 let select=doc.querySelector('#translation-target');await run('setTranslationTarget("fr")');await tick();const saved=await run('getAll("settings")');
 check('Custom language choices persist the target and update the same controls in place',()=>{assert.equal(saved.find(row=>row.id==='main').translationTarget,'fr');assert.equal(doc.querySelector('#translation-target'),select);assert.equal(doc.querySelector('.sheet'),panel);});
 await run('setTranslationTarget("unknown")');check('Unknown target values are ignored without changing the saved preference',()=>assert.equal(run('S.settings.translationTarget'),'fr'));
 await run('setTranslationTarget("zh-CN")');check('Switching back restores the existing Chinese cache without network work',()=>assert.equal(doc.querySelector('.translation').textContent,'旧版中文缓存'));
 w.calls=[];w.mockNet=async(url,options={})=>{w.calls.push({url,options});return response('bonjour');};run('net=mockNet');await run('translateText("A tiny planet.",{target:"fr",source:"en",service:"google"})');
 check('Google requests use the chosen target with automatic source detection',()=>{const u=new URL(w.calls[0].url);assert.equal(u.searchParams.get('tl'),'fr');assert.equal(u.searchParams.get('sl'),'auto');assert.equal(u.searchParams.get('q'),'A tiny planet.');});
 w.calls=[];w.mockNet=async(url,options={})=>{w.calls.push({url,options});return JSON.stringify({choices:[{message:{content:'小さな惑星。'}}]});};run('net=mockNet');await run('translateText("A tiny planet.",{target:"ja",source:"en",service:"custom",endpoint:"https://example.com/chat/completions",model:"test-model"})');
 check('Custom AI requests name the chosen language and keep literary text in its user message',()=>{const body=JSON.parse(w.calls[0].options.body);assert.match(body.messages[0].content,/into Japanese/);assert(!body.messages[0].content.includes('Simplified Chinese'));assert.equal(body.messages[1].content,'A tiny planet.');assert.equal(body.model,'test-model');assert.equal(w.calls[0].options.useApiKey,true);});
 w.calls=[];w.mockNet=async(url,options={})=>{w.calls.push({url,options});return JSON.stringify({responseStatus:200,responseData:{translatedText:'Hola'}});};run('net=mockNet');await run('translateText("Bonjour",{target:"es",source:"fr",service:"mymemory"})');
 check('MyMemory receives the book source and selected target without an English-Chinese hardcode',()=>assert.equal(new URL(w.calls[0].url).searchParams.get('langpair'),'fr|es'));
 const prior=w.calls.length;await assert.rejects(run('translateText("世".repeat(200),{target:"ja",source:"zh-CN",service:"mymemory"})'),/较长/);
 check('Oversized multibyte MyMemory input is rejected whole before any request',()=>assert.equal(w.calls.length,prior));
 const same=await run('translateText("Original text",{target:"en",source:"en-US",service:"mymemory"})');check('Matching MyMemory source and target returns the original text without an invalid language pair',()=>{assert.equal(same,'Original text');assert.equal(w.calls.length,prior);});
 run('transCache.set(translationKey("little-prince",0,0,"ja"),"日本語キャッシュ")');await run('setTranslationTarget("ja")');check('The requested language cache is reused with its own language key',()=>assert.equal(doc.querySelector('.translation').textContent,'日本語キャッシュ'));
 run('S.translate=true;S.book.translate=true;transCache.clear();S.translationEpoch++;translateQueue=[]');await open(2);await run('setTranslationTarget("fr")');deferredNet();visibleFirst();for(let i=0;i<100&&w.pending.length<1;i++)await tick();assert.equal(w.pending.length,1);const french=w.pending[0];
 await run('setTranslationTarget("ja")');const current=visibleFirst();for(let i=0;i<100&&w.pending.length<2;i++)await tick();assert.equal(w.pending.length,2);const japanese=w.pending[1];japanese.resolve(response('日本語の訳文'));await tick();await tick();
 check('A current target can finish while an older target request is still in flight',()=>{assert.equal(current.textContent,'日本語の訳文');assert.equal(run('translationWorkers.size'),1);});
 french.resolve(response('Texte français'));await tick();await tick();
 check('A late old-target result is stored under its own key and cannot overwrite current text',()=>{assert.equal(current.textContent,'日本語の訳文');assert.equal(run('transCache.get(translationKey("little-prince",2,0,"fr"))'),'Texte français');assert.equal(run('transCache.get(translationKey("little-prince",2,0,"ja"))'),'日本語の訳文');});
 run('transCache.clear()');await run('setTranslationTarget("de")');deferredNet();visibleFirst();await until(()=>w.pending.length===1,"First request started after cache lookup");await run('setTranslationTarget("es")');visibleFirst();await until(()=>w.pending.length===2,"Second request started after cache lookup");await run('setTranslationTarget("it")');const italian=visibleFirst();
 check('Rapid switching bounds unfinished target generations to two workers',()=>{assert.equal(w.pending.length,2);assert.equal(run('translationWorkers.size'),2);});
 w.pending[0].resolve(response('Deutsch'));await until(()=>w.pending.length===3,'Newest request starts after a worker frees');assert.equal(w.pending.length,3);w.pending[2].resolve(response('Italiano'));w.pending[1].resolve(response('Español'));await tick();await tick();
 check('The newest queued target proceeds when a slot frees, with no stale language flash',()=>assert.equal(italian.textContent,'Italiano'));
 await until(()=>run('translationWorkers.size')===0,'Finish the prior responses and IndexedDB writes before replacing the deferred network fixture');
 await run('setTranslationTarget("ko")');deferredNet();visibleFirst();await until(()=>w.pending.length===1,'Old request started');await run('setTranslationTarget("uk")');const uk=visibleFirst(),toastBefore=doc.querySelector('#toast').textContent;await until(()=>w.pending.length===2,'Current request started');w.pending[0].reject(Error('old request failed'));w.pending[1].resolve(response('Український текст'));await tick();await tick();
 await until(()=>uk.textContent==='Український текст','The current target response must finish before checking obsolete-request errors');
 check('Failures from an obsolete target do not replace the new translation or show a stale error',()=>{assert.equal(uk.textContent,'Український текст');assert(!uk.classList.contains('error'));assert.equal(doc.querySelector('#toast').textContent,toastBefore);});
 run('transCache.set(translationKey("little-prince",3,0,"uk"),"Український початок")');const preview=run('previewChapterMarkup(3)');check('Adjacent chapter previews use the selected target instead of Chinese fallback',()=>{assert(preview.includes('Український початок'));assert(preview.includes('lang="uk"'));});
 run('S.settings.translationTarget="invalid-value"');check('Invalid stored language settings have a safe Simplified Chinese fallback',()=>assert.equal(run('translationLanguage()[0]'),'zh-CN'));run('S.settings.translationTarget="zh-CN"');
 console.log(`\n${passed} translation-language checks passed. Controlled network responses only.`);dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
