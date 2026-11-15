/* Rendered dictionary/translation/selection workflow regression. No Android hardware claims. */
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(__dirname,'../web');
const server=http.createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://local').pathname).slice(1)||'index.html',file=name.startsWith('fixtures/')?path.resolve(__dirname,name):path.resolve(root,name);if(!file.startsWith(root+path.sep)&&!file.startsWith(path.join(__dirname,'fixtures')+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,data)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',({'.css':'text/css','.js':'text/javascript','.html':'text/html','.json':'application/json','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
let browser,page,cdp,count=0;const errors=[];async function check(name,run){await run();console.log('PASS',name);count++;}
async function settle(){await page.waitForFunction(()=>!document.getAnimations().some(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity));}
async function reply(text,fail=false){return page.evaluate(({text,fail})=>{const p=pending.shift();if(!p)throw Error('No pending translation');if(fail)p.reject(Error('offline'));else p.resolve(JSON.stringify([[[text]]]));},{text,fail});}
async function until(fn){await page.waitForFunction(fn);}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'zh-CN'});page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.main-dock');await page.waitForSelector('#startup-screen',{state:'detached'});
 await page.evaluate(async()=>{
  window.wave=()=>{const n=800,buffer=new ArrayBuffer(44+n*2),d=new DataView(buffer),str=(at,s)=>[...s].forEach((c,i)=>d.setUint8(at+i,c.charCodeAt(0)));str(0,'RIFF');d.setUint32(4,36+n*2,true);str(8,'WAVE');str(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,8000,true);d.setUint32(28,16000,true);d.setUint16(32,2,true);d.setUint16(34,16,true);str(36,'data');d.setUint32(40,n*2,true);return new Uint8Array(buffer);};
  const zip=fflate.zipSync({'manifest.json':fflate.strToU8(JSON.stringify({format:'yidu-resource',version:1,kind:'pronunciation',name:'British PCM',language:'en-GB'})),'entries.jsonl':fflate.strToU8(JSON.stringify({word:'water',audio:'water.wav'})),'water.wav':wave()});await importResourceFile(zip,'british.zip');window.realPronunciation=resourcePacks[0].id;
  window.realAudio=Audio;window.realQuery=YiduDictionaryFiles.query;window.realAsset=YiduDictionaryFiles.asset;window.realSystem=playSystemSpeech;window.realUnavailable=speechUnavailable;
  window.data={};window.resetAudio=async function(){stopSpeech();resourcePacks=[];S.word=null;S.settings.wordAccent='en-GB';S.settings.wordSpeechSource='auto';S.settings.dictionaryOrder=['current','first','second','builtin'];window.queries=[];window.assets=[];window.system=[];window.notices=[];window.players=[];window.entries={};window.badAssets=[];window.badPlays=[];window.queryFailure=[];window.lookupBlock=null;window.assetBlock=null;window.lastAsset='';window.systemFails=false;window.onlineCount=0;};
  window.addPack=async function(id,entry,enabled=true){resourcePacks.push({id,name:id,format:'mdict',kind:'dictionary',enabled});entries[id]=entry;await put('resourceEntries',{id:resourceKey(id,'@mdict-data'),packId:id,files:[]});};
  window.entry=(region='en-GB',path='water_gb.wav',form='default')=>({translation:'fixture',pronunciations:[{path,accent:region,form}],audio:[path]});
  window.speakFixture=async function(source='builtin',region='en-GB',extra={}){return speak('water',{sourceId:source,accent:region,source:'auto',...extra});};
 });
 await check('Imported regional resource contains a real locally stored PCM recording',async()=>assert(await page.evaluate(async()=>{const p=resourcePacks.find(p=>p.id===realPronunciation),e=await getRecord('resourceEntries',resourceKey(p.id,'water'));return p.language==='en-GB'&&e.audio instanceof Blob&&e.audio.size===1644;})));
 await page.evaluate(async()=>{window.realFallbacks=[];playSystemSpeech=async(t,k,o)=>realFallbacks.push(o.accent);await speakFixture();});await page.waitForFunction(()=>resourcePlayback===null);
 await check('ECDICT can play actual imported regional WAV through the real browser audio pipeline',async()=>assert.deepEqual(await page.evaluate(()=>realFallbacks),[]));
 await check('Audio-only MDX query keeps real pronunciation metadata without preparing CSS or images',async()=>assert(await page.evaluate(async()=>{const p=await importResourceFile(new Uint8Array(await(await fetch('/fixtures/mdict/rich-v4.rar')).arrayBuffer()),'rich-v4.rar'),record=await getRecord('resourceEntries',resourceKey(p.id,'@mdict-data')),prepare=YiduDictionaryRich.prepare;let count=0;YiduDictionaryRich.prepare=async(...args)=>{count++;return prepare(...args);};try{const audio=await YiduDictionaryFiles.query(p.id,record.files,'water',{rich:false});const audioCount=count,normal=await YiduDictionaryFiles.query(p.id,record.files,'water');return audioCount===0&&count===1&&audio.translation===normal.translation&&JSON.stringify(audio.pronunciations)===JSON.stringify(normal.pronunciations)&&audio.pronunciations.length>0&&!audio.rich&&!!normal.rich;}finally{YiduDictionaryRich.prepare=prepare;}})));
 await page.evaluate(async()=>{
  await resetAudio();YiduDictionaryFiles.query=async(id,files,word)=>{queries.push([id,word]);if(queryFailure.includes(id))throw Error('bad index');if(lookupBlock&&lookupBlock.id===id)await new Promise(r=>lookupBlock.release=r);return entries[id]||null;};YiduDictionaryFiles.asset=async(id,files,path)=>{assets.push([id,path]);lastAsset=id+':'+path;if(assetBlock&&assetBlock.id===id)await new Promise(r=>assetBlock.release=r);if(badAssets.includes(lastAsset))throw Error('bad asset');return data[lastAsset]||wave();};
  window.Audio=class{constructor(url){this.url=url;this.path=lastAsset;players.push(this);}play(){if(badPlays.includes(this.path))return Promise.reject(Error('bad recording'));return Promise.resolve();}pause(){this.paused=true;}removeAttribute(){}};
  playSystemSpeech=async(t,k,o)=>{system.push([t,o.accent]);if(systemFails)throw Error('no system voice');};speechUnavailable=()=>notices.push('unavailable');onlineEntry=async()=>{onlineCount++;throw Error('online disabled');};
  await addPack('first',entry());
 });
 await page.evaluate(()=>speakFixture());
 await check('ECDICT searches another imported dictionary before system speech',async()=>assert.deepEqual(await page.evaluate(()=>[assets,system,notices,onlineCount]),[[['first','water_gb.wav']],[],[],0]));
 for(const source of ['online','mymemory','google','standard']){
  await page.evaluate(async source=>{await resetAudio();await addPack('first',entry());await speakFixture(source);},source);
  await check('Displayed '+source+' definition can reuse a different local dictionary recording',async()=>assert.deepEqual(await page.evaluate(()=>[assets,system]),[[['first','water_gb.wav']],[]]));
 }
 await page.evaluate(async()=>{await resetAudio();await addPack('first',entry('en-US','first_us.wav'));await addPack('current',entry('en-US','current_us.wav'));await speakFixture('current','en-US',{entry:entries.current});});
 await check('Current dictionary recording wins over other packs with the same accent',async()=>assert.deepEqual(await page.evaluate(()=>assets),[['current','current_us.wav']]));
 await page.evaluate(async()=>{await resetAudio();await addPack('current',entry('en-GB','current_gb.wav'));await addPack('first',entry('en-US','first_us.wav'));await speakFixture('current','en-US',{entry:entries.current});});
 await check('Missing American audio in current dictionary uses American audio from another pack',async()=>assert.deepEqual(await page.evaluate(()=>[assets,system]),[[['first','first_us.wav']],[]]));
 await page.evaluate(async()=>{await resetAudio();await addPack('first',{...entry(),pronunciations:[{path:'us.wav',accent:'en-US',form:'default'},{path:'unknown.wav',accent:null,form:'default'},{path:'gb.wav',accent:'en-GB',form:'default'}]});await speakFixture();});
 await check('Opposite and unknown accents are skipped while searching British recordings',async()=>assert.deepEqual(await page.evaluate(()=>assets),[['first','gb.wav']]));
 await page.evaluate(async()=>{await resetAudio();await addPack('first',entry('en-US','us.wav'));await addPack('second',entry(null,'unknown.wav'));await speakFixture();});
 await check('No matching local accent falls back to requested system accent without online lookup',async()=>assert.deepEqual(await page.evaluate(()=>[assets,system,notices,onlineCount]),[[],[['water','en-GB']],[],0]));
 await page.evaluate(async()=>{await resetAudio();await addPack('first',entry('en-GB','disabled.wav'),false);await addPack('second',entry('en-GB','enabled.wav'));await speakFixture();});
 await check('Disabled imported resources are neither queried nor played',async()=>assert.deepEqual(await page.evaluate(()=>[queries,assets]),[[['second','water']],[['second','enabled.wav']]]));
 await page.evaluate(async()=>{await resetAudio();await addPack('second',entry('en-GB','second.wav'));await addPack('first',entry('en-GB','first.wav'));await speakFixture();});
 await check('Other dictionaries follow the saved dictionary order',async()=>assert.deepEqual(await page.evaluate(()=>assets),[['first','first.wav']]));
 await page.evaluate(async()=>{await resetAudio();await addPack('first',entry());await addPack('second',entry('en-GB','second.wav'));queryFailure=['first'];await speakFixture();});
 await check('One broken dictionary index does not prevent another local recording',async()=>assert.deepEqual(await page.evaluate(()=>[assets,system,notices]),[[['second','second.wav']],[],[]]));
 await page.evaluate(async()=>{await resetAudio();await addPack('first',{...entry(),pronunciations:[{accent:'en-GB',form:'default',path:'bad.wav'},{accent:'en-GB',form:'default',path:'good.wav'}]});badAssets=['first:bad.wav'];await speakFixture();});
 await check('Missing first audio asset does not skip remaining recordings in the same pack',async()=>assert.deepEqual(await page.evaluate(()=>[assets,system]),[[['first','bad.wav'],['first','good.wav']],[]]));
 await page.evaluate(async()=>{await resetAudio();await addPack('first',entry());await addPack('second',entry('en-GB','second.wav'));badPlays=['first:water_gb.wav'];await speakFixture();});
 await check('Rejected playback tries the next matching local pack before system speech',async()=>assert.deepEqual(await page.evaluate(()=>[assets,system,notices]),[[['first','water_gb.wav'],['second','second.wav']],[],[]]));
 await page.evaluate(async()=>{await resetAudio();await addPack('first',entry());badPlays=['first:water_gb.wav'];await speakFixture();});
 await check('All rejected local recordings fall back once without a notice when system succeeds',async()=>assert.deepEqual(await page.evaluate(()=>[system,notices]),[[['water','en-GB']],[]]));
 await page.evaluate(async()=>{await resetAudio();await addPack('first',entry());badPlays=['first:water_gb.wav'];systemFails=true;await speakFixture();});
 await check('Only failure of local and system speech produces one final notice',async()=>assert.deepEqual(await page.evaluate(()=>[system.length,notices.length]),[1,1]));
 await page.evaluate(async()=>{await resetAudio();await addPack('first',entry('en-GB','strong.wav','strong'));await addPack('second',entry('en-GB','weak.wav','weak'));await speakFixture('builtin','en-GB',{form:'weak'});});
 await check('Requested weak form does not use a different packs strong recording',async()=>assert.deepEqual(await page.evaluate(()=>assets),[['second','weak.wav']]));
 await page.evaluate(async()=>{await resetAudio();await addPack('first',{pronunciations:[{accent:'en-GB',path:'strong.wav',form:'strong'},{accent:'en-GB',path:'weak.wav',form:'weak'}],pronunciationForms:{'en-GB':[{text:'wə',form:'weak',audio:['weak.wav']},{text:'wɔː',form:'strong',audio:['strong.wav']}]}});await speakFixture();});
 await check('Default cross-pack pronunciation uses its normal weak form instead of the first strong recording',async()=>assert.deepEqual(await page.evaluate(()=>assets),[['first','weak.wav']]));
 await page.evaluate(async()=>{await resetAudio();await addPack('first',entry());S.word={word:'water',sourceId:'builtin',entry:{translation:'water'},sources:[]};await speakCurrentWord();});
 await check('Actual word-card speaker reuses local audio while keeping ECDICT as definition',async()=>assert(await page.evaluate(()=>assets.length===1&&S.word.sourceId==='builtin'&&S.word.entry.translation==='water'&&system.length===0)));
 await page.evaluate(async()=>{await resetAudio();await addPack('first',entry());S.word={word:'water',sourceId:'online',entry:{missing:true},sources:[]};await speakCurrentWord();});
 await check('Missing definition does not block independent local word pronunciation',async()=>assert.deepEqual(await page.evaluate(()=>assets),[['first','water_gb.wav']]));
 await page.evaluate(async()=>{await resetAudio();await addPack('first',entry('en-GB','same.wav'));await addPack('current',entry('en-GB','same.wav'));badPlays=['current:same.wav'];await speakFixture('current','en-GB',{entry:entries.current,path:'same.wav'});});
 await check('Explicit audio link is scoped to its own pack, then other packs use normal matching',async()=>assert.deepEqual(await page.evaluate(()=>assets),[['current','same.wav'],['first','same.wav']]));
 await page.evaluate(async()=>{await resetAudio();await addPack('first',entry());lookupBlock={id:'first'};window.pendingAudio=speakFixture();});await page.waitForFunction(()=>!!lookupBlock.release);
 await page.evaluate(async()=>{stopSpeech();lookupBlock.release();await pendingAudio;});
 await check('Stopping a slow cross-pack lookup prevents late audio and system fallback',async()=>assert.deepEqual(await page.evaluate(()=>[assets,system]),[[],[]]));
 await page.evaluate(async()=>{await resetAudio();await addPack('first',entry());assetBlock={id:'first'};window.pendingAudio=speakFixture();});await page.waitForFunction(()=>!!assetBlock.release);
 await page.evaluate(async()=>{stopSpeech();assetBlock.release();await pendingAudio;});
 await check('Stopping slow audio asset retrieval prevents late playback',async()=>assert.deepEqual(await page.evaluate(()=>[players.length,system.length]),[0,0]));
 await page.evaluate(async()=>{await resetAudio();await addPack('first',entry());await speakFixture('builtin','en-GB',{source:'system'});});
 await check('Explicit system-only speech preference remains respected',async()=>assert.deepEqual(await page.evaluate(()=>[queries,assets,system]),[[],[],[['water','en-GB']]]));
 await page.evaluate(async()=>{await resetAudio();await addPack('first',entry());await speakFixture('online','en-US',{source:'online'});});
 await check('Explicit online speech preference remains opt-in and falls back to requested system accent',async()=>assert.deepEqual(await page.evaluate(()=>[onlineCount,assets,system]),[1,[],[['water','en-US']]]));
 await check('No uncaught browser errors',async()=>assert.deepEqual(errors,[]));console.log('TOTAL',count);
})().catch(e=>{console.error(e,errors);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
