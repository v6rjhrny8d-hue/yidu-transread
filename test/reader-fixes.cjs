/* User screenshot regressions: rendering ownership and real input sequence semantics.
 * Controlled WAAPI and geometry; not an Android FPS measurement. */
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const {JSDOM}=require('jsdom'),{indexedDB,IDBKeyRange}=require('fake-indexeddb');
const web=path.join(__dirname,'../web'),dom=new JSDOM(fs.readFileSync(path.join(web,'index.html'),'utf8'),{url:'https://appassets.androidplatform.net/assets/index.html',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window,doc=w.document,ctx=dom.getInternalVMContext(),animations=[];let clock=1000,passed=0;
Object.assign(w,{indexedDB,IDBKeyRange,TextEncoder,TextDecoder,Blob,File,fflate:require('fflate'),innerWidth:390,innerHeight:844});Object.defineProperty(w.performance,'now',{value:()=>clock});
w.HTMLElement.prototype.scrollIntoView=function(){};w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
w.fetch=async url=>{if(String(url).startsWith('https:'))throw Error('Network disabled');const data=fs.readFileSync(path.join(web,String(url).split('?')[0]));return {ok:true,json:async()=>JSON.parse(data)};};
w.HTMLElement.prototype.animate=function(frames,options){let resolve,reject;const a={target:this,frames,options,state:'running',finished:new Promise((a,b)=>{resolve=a;reject=b;}),finish(){if(this.state==='running'){this.state='finished';resolve();}},cancel(){if(this.state==='running'){this.state='cancelled';reject(Error('cancelled'));}}};animations.push(a);return a;};
Object.defineProperty(w.navigator,'languages',{value:['zh-CN'],configurable:true});for(const file of ['locale.js','motion.js','reading-structure.js','app.js'])vm.runInContext(require('./legacy-fixture.cjs')(fs.readFileSync(path.join(web,file),'utf8')),ctx);
const run=code=>vm.runInContext(code,ctx),wait=ms=>new Promise(r=>setTimeout(r,ms));
function check(label,fn){fn();passed++;console.log('PASS',label);}
function pointer(type,target,x,y=400,dt=20){clock+=dt;const e=new w.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{pointerId:22,pointerType:'touch',isPrimary:true,button:0,clientX:x,clientY:y});target.dispatchEvent(e);}
async function settle(){for(let i=0;i<8;i++){animations.filter(a=>a.state==='running').forEach(a=>a.finish());await wait(0);}}
async function open(ch=2){const p=run(`openBook('little-prince',${ch})`);await settle();await p;}
(async()=>{
 for(let i=0;i<100&&!doc.querySelector('.hero-book');i++)await wait(10);await settle();run("S.settings.verticalMode='chapter';S.settings.horizontalMode='slide';for(const fixtureBook of S.books)fixtureBook.readingModes={verticalMode:'chapter',horizontalMode:'slide'}");await open();
 const shell=doc.querySelector('.reader'),back=doc.querySelector('#reader-top'),line=doc.querySelector('#reading-line');let word=doc.querySelector('#reader-scroll .word');
 pointer('pointerdown',word,260);pointer('pointermove',word,200);const preview=doc.querySelector('.chapter-preview'),previewWord=preview.querySelector('.word');
 check('Dragging translates only chapter content and keeps back/progress outside that layer',()=>{assert.equal(shell.style.transform,'');assert.equal(back.parentNode,shell);assert.equal(line.parentNode.parentNode,shell);assert.equal(doc.querySelector('#reader-scroll').style.transform,'translate3d(-60px,0,0)');assert(!preview.querySelector('#reader-top,.reader-progress,.reader-edge'));});
 run('var savedTokenizer=tokenize,tokenizeCount=0;tokenize=(text)=>{tokenizeCount++;return savedTokenizer(text)}');pointer('pointerup',word,200);
 check('Release promotes the existing preview and words without parsing the chapter a second time',()=>{assert.equal(doc.querySelector('#reader-scroll'),preview);assert.equal(doc.querySelector('#reader-scroll .word'),previewWord);assert.equal(run('tokenizeCount'),0);assert.equal(doc.querySelector('.reader'),shell);assert.equal(doc.querySelector('#reader-top'),back);assert.equal(doc.querySelector('#reading-line'),line);});
 await settle();run('tokenize=savedTokenizer;persistReadingPosition();var savedPut=put,positionWrites=0;put=(store,data)=>{if(store==="settings"&&data.id.startsWith("book-position:"))positionWrites++;return savedPut(store,data)}');
 // Re-touch the stationary viewport while the incoming chapter is still to the right.
 for(let i=0;i<7;i++){
  const current=doc.querySelector('#reader-scroll'),width=390,base=240;
  current.style.transform=`translate3d(${base}px,0,0)`;
  for(const p of doc.querySelectorAll('.chapter-preview'))p.style.transform=`translate3d(${base+(Number(p.dataset.chapter)-run('S.chapter'))*width}px,0,0)`;
  const stage=doc.querySelector('.chapter-stage');pointer('pointerdown',stage,240);pointer('pointermove',stage,185);pointer('pointerup',stage,185);
 }
 check('Seven fast same-direction flicks all commit before the previous coast finishes',()=>{assert.equal(run('S.chapter'),10);assert.equal(doc.querySelector('.reader'),shell);assert.equal(doc.querySelectorAll('#reader-scroll').length,1);assert.equal(doc.querySelectorAll('#reading-line').length,1);assert.equal(doc.querySelectorAll('#reader-top').length,1);assert.equal(shell.style.transform,'');});
 check('A burst of chapter changes updates in-memory position without synchronous position writes',()=>{assert.equal(run('S.book.position.chapter'),10);assert.equal(run('positionWrites'),0);});
 await settle();await wait(380);
 check('The burst persists the final chapter once and releases all temporary layers',()=>{assert.equal(run('positionWrites'),1);assert.equal(doc.querySelectorAll('.chapter-preview').length,0);assert.equal(doc.querySelector('#reader-scroll').style.transform,'');assert(run('chapterPanes.size<=5'));assert(!doc.querySelector('.chapter-moving'));});
 const persisted=await run('getAll("settings")');check('Stored reading progress matches the final accepted chapter',()=>assert.equal(persisted.find(b=>b.id==='book-position:little-prince').position.chapter,10));run('put=savedPut');
 await open(4);run('prepareChapterPane(3);prepareChapterPane(5)');const warm=run('chapterPanes.get(chapterPaneKey(5))');run('var savedTokenizer2=tokenize;tokenize=()=>{throw Error("prewarmed chapter must not reparse")}');
 word=doc.querySelector('#reader-scroll .word');pointer('pointerdown',word,250);pointer('pointermove',word,160);pointer('pointerup',word,160);
 check('A prewarmed chapter handles the complete drag and release without tokenization',()=>assert.equal(doc.querySelector('#reader-scroll'),warm));run('tokenize=savedTokenizer2');await settle();
 // Pull a returning chapter in the opposite direction while the previous turn is settling.
 run('changeChapter(6)');let current=doc.querySelector('#reader-scroll');current.style.transform='translate3d(180px,0,0)';doc.querySelector('.chapter-outgoing').style.transform='translate3d(-210px,0,0)';const stage=doc.querySelector('.chapter-stage');pointer('pointerdown',stage,130);pointer('pointermove',stage,210);pointer('pointerup',stage,210);
 check('An immediate opposite flick returns to the prior chapter and remains interactive',()=>{assert.equal(run('S.chapter'),5);assert(!doc.querySelector('#reader-scroll').inert);});await settle();
 run('S.settings.paragraphTranslateButton=true;renderReader()');
 check('Even a legacy enabled preference cannot insert paragraph buttons into reading',()=>assert.equal(doc.querySelectorAll('.paragraph-translate').length,0));
 run('translationTools()');const parent=doc.querySelector('.sheet');parent.scrollTop=42;const trigger=doc.querySelector('#translation-target');w.trigger=trigger;run('M.mark(trigger);translationLanguages()');await settle();
 check('Language selection uses themed app controls, with every target and one selected state',()=>{assert(doc.querySelector('.secondary-panel'));assert.equal(doc.querySelector('.sheet'),parent);assert.equal(doc.querySelectorAll('.language-option').length,20);assert.equal(doc.querySelectorAll('.language-option.selected').length,1);assert.equal(doc.querySelector('select'),null);assert.equal(doc.querySelector('.language-option.selected').dataset.language,'zh-CN');});
 const japanese=doc.querySelector('[data-language="ja"]');w.japanese=japanese;const choosing=run('action("set-translation-language",japanese)');await settle();await choosing;
 check('Choosing a language returns to the same parent and updates its label and saved target',()=>{assert.equal(doc.querySelector('.sheet'),parent);assert.equal(parent.scrollTop,42);assert.equal(run('S.settings.translationTarget'),'ja');assert.equal(doc.querySelector('#translation-target-name').textContent,'日语');assert.equal(doc.querySelector('[data-action="toggle-paragraph-buttons"]'),null);});
 // Back/cancel must preserve the setting and the original parent sheet.
 run('M.mark(document.querySelector("#translation-target"));translationLanguages()');await settle();const closing=run('closePanel({foldInline:true})');await settle();await closing;
 check('Cancelling language selection restores the parent without changing the translation target',()=>{assert.equal(doc.querySelector('.sheet'),parent);assert.equal(run('S.settings.translationTarget'),'ja');});
 run('closeOverlay(true)');for(const locale of ['en','zh-TW']){run(`window.TransReadI18n.set('${locale}');translationTools()`);check(`Compact language tools have complete ${locale} UI copy`,()=>{if(locale==='en')assert(!/[\u3400-\u9fff]/.test(doc.querySelector('.sheet').textContent));else assert(doc.querySelector('.sheet').textContent.includes('譯文'));});run('closeOverlay(true)');}
 const css=fs.readFileSync(path.join(web,'style.css'),'utf8');doc.head.insertAdjacentHTML('beforeend','<style>'+css+'</style>');run('S.notes=[{id:"glyphs",type:"word",word:"glorious gypsy pqj",meaning:"letter descenders"}];S.page="notes";render()');
 check('Word cards reserve extra leading and bottom ink space for descending glyphs',()=>{const title=doc.querySelector('.note-word'),style=w.getComputedStyle(title);assert.equal(style.lineHeight,'1.45');assert.equal(style.paddingBottom,'7px');assert.equal(w.getComputedStyle(doc.querySelector('.note-card')).height,'auto');});
 check('Landscape translation tools use two columns and internally scrollable content',()=>{assert.match(css,/\.translation-tools-body\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1\.15fr\)/);assert.match(css,/\.translation-tools-body\{overflow-y:auto;min-height:0/);assert(!doc.querySelector('.paragraph-translate'));});
 check('Android entry and script/style cache keys follow the installed package version',()=>{const manifest=fs.readFileSync(path.join(web,'../android/AndroidManifest.xml'),'utf8'),version=manifest.match(/versionName="([^"]+)"/)[1],html=fs.readFileSync(path.join(web,'index.html'),'utf8'),native=fs.readFileSync(path.join(web,'../android/src/app/lumi/reader/MainActivity.java'),'utf8');const versions=[...html.matchAll(/(?:style\.css|motion\.js|locale\.js|app\.js)\?v=([^"']+)/g)].map(m=>m[1]);assert.equal(versions.length,4);assert(versions.every(v=>v===version));assert(native.includes('/assets/index.html?v='+version));assert(native.includes('"Cache-Control","no-store"'));});
 console.log(`\n${passed} reader-fix checks passed. No real-device frame-rate or pixel claims.`);dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
