/* Locale switching and data preservation in a synthetic DOM, not a rendered device. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),{IDBFactory,IDBKeyRange}=require('fake-indexeddb');
const web=path.join(__dirname,'../web');let passed=0;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function check(label,fn){fn();passed++;console.log('PASS',label);}
async function boot(languages=['en-US'],factory=new IDBFactory()){
 const dom=new JSDOM(fs.readFileSync(path.join(web,'index.html'),'utf8'),{url:'https://appassets.androidplatform.net/assets/index.html',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,doc=w.document,ctx=dom.getInternalVMContext(),requests=[];
 Object.assign(w,{indexedDB:factory,IDBKeyRange,TextEncoder,TextDecoder,Blob,File,fflate:require('fflate')});
 Object.defineProperty(w.navigator,'languages',{value:languages,configurable:true});w.HTMLElement.prototype.scrollIntoView=function(){};
 w.IntersectionObserver=class{observe(){}disconnect(){}unobserve(){}};
 w.fetch=async url=>{assert(!String(url).startsWith('https:'));const data=fs.readFileSync(path.join(web,String(url).split('?')[0]));return {ok:true,json:async()=>JSON.parse(data)};};
 w.LumiNative={request(op,data,id){requests.push({op,data:JSON.parse(data)});queueMicrotask(()=>w.nativeReply(id,{ok:true,data:null}));}};
 for(const file of ['locale.js','motion.js','reading-structure.js','app.js'])vm.runInContext(require('./legacy-fixture.cjs')(fs.readFileSync(path.join(web,file),'utf8')),ctx);
 const run=code=>vm.runInContext(code,ctx);
 for(let i=0;i<100&&!doc.querySelector('.hero-book');i++)await wait(10);
 assert(doc.querySelector('.hero-book'));return {dom,w,doc,run,requests,factory,close(){run('db.close()');dom.window.close();}};
}
(async()=>{
 const h=await boot(),{w,doc,run,requests}=h;
 check('A fresh install follows English system language with functional Library heading',()=>{assert.equal(doc.documentElement.lang,'en');assert.equal(doc.querySelector('h1').textContent,'Library');assert.equal(run('S.settings.uiLanguage'),'system');assert.equal(doc.title,'TransRead');});
 check('Library has a naturally wrapping subtitle and no app-name header',()=>{assert.equal(doc.querySelector('.shelf-title br'),null);assert.equal(doc.querySelector('.welcome-copy').textContent,'Read a little each day. Understand a little more.');assert(!doc.querySelector('.shelf-toolbar').textContent.includes('TransRead'));});
 check('English book titles use original metadata without altering the stored Chinese title',()=>{assert.equal(doc.querySelector('.hero-copy h2').textContent,'The Little Prince');assert.equal(run('S.books[0].titleZh'),'小王子');});
 const headings={search:'Search',notes:'Notes',profile:'Profile'};
 for(const [page,title] of Object.entries(headings)){await run(`navigate('${page}')`);check(`${page} uses its short localized heading`,()=>assert.equal(doc.querySelector('h1').textContent,title));}
 check('Personal language settings describe the current system locale',()=>{const row=doc.querySelector('[data-action="app-language"]');assert(row);assert(row.textContent.includes('Follow system'));assert(row.textContent.includes('English'));});
 run('appLanguages()');
 check('Language choices retain autonyms and an accessible current selection',()=>{assert.deepEqual([...doc.querySelectorAll('.app-language-options strong')].map(x=>x.textContent),['Follow system','简体中文','繁體中文','English']);assert.equal(doc.querySelector('[data-locale="system"]').getAttribute('aria-pressed'),'true');});
 run('S.settings.translationTarget="ja";S.settings.name="中文昵称";S.settings.fontSize=25;S.settings.leading=1.7');
 const snapshot=run('JSON.stringify(S.books)');
 await run('setAppLanguage("zh-TW")');
 check('Switching immediately updates page, dialog, Dock and document language to Traditional Chinese',()=>{assert.equal(doc.documentElement.lang,'zh-TW');assert.equal(doc.querySelector('h1').textContent,'個人');assert.equal(doc.querySelector('.sheet h2').textContent,'應用語言');assert.deepEqual([...doc.querySelectorAll('.main-dock span')].map(x=>x.textContent).filter(Boolean),['書架','搜尋','筆記','個人']);});
 check('Switching UI language preserves translation target, nickname and reading settings',()=>{assert.equal(run('S.settings.translationTarget'),'ja');assert.equal(run('S.settings.name'),'中文昵称');assert.equal(run('S.settings.fontSize'),25);assert.equal(run('S.settings.leading'),1.7);assert.equal(run('JSON.stringify(S.books)'),snapshot);});
 const saved=(await run('getAll("settings")')).find(row=>row.id==='main');
 check('UI language is persisted alongside existing settings',()=>{assert.equal(saved.uiLanguage,'zh-TW');assert.equal(saved.translationTarget,'ja');});
 await run('setAppLanguage("en")');await run('setAppLanguage("zh-CN")');await run('setAppLanguage("en")');
 check('Repeated switching leaves exactly one panel and one active choice, without duplicate overlays',()=>{assert.equal(doc.querySelectorAll('.sheet').length,1);assert.equal(doc.querySelectorAll('[data-locale][aria-pressed="true"]').length,1);assert.equal(doc.querySelector('.sheet').getAttribute('aria-label'),'App language');});
 await run('setAppLanguage("unknown")');check('Invalid selections do not overwrite the chosen locale',()=>assert.equal(run('S.settings.uiLanguage'),'en'));
 run('closeOverlay(true);userGuide();M.mark(document.querySelector(".guide-content [data-action=app-language]"));appLanguages()');await run('setAppLanguage("zh-CN")');await run('closePanel()');
 check('Changing language from the guide returns to a freshly localized guide',()=>{assert(doc.querySelector('.guide-content'));assert.equal(doc.querySelector('.sheet h2').textContent,'使用指南');assert(doc.querySelector('.guide-content [data-action="app-language"]'));assert(!doc.querySelector('.guide-content').textContent.includes('Tap a cover'));});
 run('appLanguages()');await run('setAppLanguage("en")');await run('closePanel()');
 check('The guide is fully localized in English after switching back',()=>{assert.equal(doc.querySelector('.sheet h2').textContent,'User guide');const content=doc.querySelector('.guide-content').textContent;assert(!/[\u3400-\u9fff]/.test(content),content);});
 for(const fn of ['themes','customColors','translationSettings','translationTools','dictionarySettings','hapticSettings','privacy','about']){
  run('closeOverlay(true)');run(fn+'()');
  check(`${fn} translates application labels and explanatory copy`,()=>{let content=doc.querySelector('.sheet').textContent;assert(!/[\u3400-\u9fff]/.test(content),content);});
 }
 run('closeOverlay(true);S.notes=[{id:"local-note",type:"word",word:"语言",meaning:"中文解释，保持原样",context:"在文字里，遇见更大的世界。",comment:"我的中文想法",created:1,due:1}];renderNotes()');
 check('Chinese words, definitions and comments authored by the user stay untouched in English UI',()=>{assert.equal(doc.querySelector('.note-word').textContent,'语言');assert.equal(doc.querySelector('.note-meaning').textContent,'中文解释，保持原样');run('noteDetail("local-note")');assert.equal(doc.querySelector('.note-comment').textContent,'我的中文想法');assert.equal(doc.querySelector('.context'),null);assert.equal(run('S.notes[0].context'),'在文字里，遇见更大的世界。');});
 run('closeOverlay(true)');await run('openBook("little-prince",2)');const original=doc.querySelector('.original').textContent;doc.querySelector('#reader-scroll').scrollTop=220;
 run('window.__lumiSystemLocales=["zh-Hant-HK"];refreshSystemLanguage()');
 check('A manual language choice ignores later system-language changes',()=>{assert.equal(doc.documentElement.lang,'en');assert.equal(doc.querySelector('#reader-scroll').scrollTop,220);});
 await run('setAppLanguage("system")');
 check('Following a Traditional Chinese device updates tools while preserving reading scroll and original text',()=>{assert.equal(doc.documentElement.lang,'zh-TW');assert.equal(doc.querySelector('#reader-scroll').scrollTop,220);assert.equal(doc.querySelector('.original').textContent,original);assert.equal(run('S.settings.translationTarget'),'ja');});
 run('window.Lumi.systemLanguages(["en-GB"])');
 check('Native system-language updates refresh only when Follow system is selected',()=>{assert.equal(doc.documentElement.lang,'en');assert.equal(doc.querySelector('.reading-dock [data-action=toc] span').textContent,'Contents');assert.equal(doc.querySelector('#reader-scroll').scrollTop,220);});
 check('The native bridge receives the app preference independently from translation settings',()=>{const calls=requests.filter(x=>x.op==='locale');assert(calls.length);assert(calls.some(x=>x.data.choice==='zh-TW'));assert.equal(calls.at(-1).data.choice,'system');assert(!('translationTarget' in calls.at(-1).data));});
 check('Chinese locale normalization handles script and regional variants with safe English fallback',()=>{const i=w.TransReadI18n;for(const [input,expected] of [['zh-Hant','zh-TW'],['zh-Hans-SG','zh-CN'],['zh_HK','zh-TW'],['en-AU','en'],['fr-FR','en']])assert.equal(i.normalize([input]),expected);});
 await run('setAppLanguage("zh-TW")');h.close();const reload=await boot(['en-US'],h.factory);
 check('A saved manual choice survives restart on a differently configured device',()=>{assert.equal(reload.doc.documentElement.lang,'zh-TW');assert.equal(reload.run('S.settings.uiLanguage'),'zh-TW');assert.equal(reload.run('S.settings.translationTarget'),'ja');});reload.close();
 const fallback=await boot(['de-DE']);check('Unsupported fresh device languages get a complete English interface',()=>assert.equal(fallback.doc.querySelector('h1').textContent,'Library'));fallback.close();
 console.log(`\n${passed} app-language checks passed. Synthetic DOM and native-bridge stubs only.`);
})().catch(e=>{console.error(e);process.exitCode=1;process.exit(1);});
