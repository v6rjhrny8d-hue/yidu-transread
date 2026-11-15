'use strict';
/* Shared pronunciation metadata. Parse inert dictionary DOM; never infer IPA from spelling. */
window.YiduPronunciation=(()=>{
 const GB='en-GB',US='en-US';
 const marker=/\b(?:BrE|NAmE|AmE|British|American|en[-_]GB|en[-_]US|UK|US|GB)\b/gi;
 function accent(raw){const s=String(raw||'').toLowerCase(),uk=/(?:^|[^a-z])(?:bre|british|uk|gb|en[-_]gb)(?:[^a-z]|$)/.test(s),us=/(?:^|[^a-z])(?:name|ame|american|us|en[-_]us)(?:[^a-z]|$)/.test(s);return uk!==us?(uk?GB:US):null;}
 function form(raw){const matches=[...String(raw||'').matchAll(/\b(weak|strong)(?:[ _-]+form)?\b/gi)];return matches.length?matches.at(-1)[1].toLowerCase():'default';}
 function localPath(raw){let s=String(raw||'').replace(/^sound:\/\//i,'').replace(/\\/g,'/').replace(/^\/+/, '');try{s=decodeURIComponent(s);}catch{}s=s.split(/[?#]/)[0];return s&&s.length<=500&&!/[\0-\x1f]/.test(s)&&!s.split('/').includes('..')&&!/^[a-z][\w+.-]*:/i.test(s)?s:null;}
 function onlineURL(raw){try{const u=new URL(String(raw).startsWith('//')?'https:'+raw:raw);if(u.protocol!=='https:'||u.username||u.password||u.port&&!['443'].includes(u.port))return null;if(!['api.dictionaryapi.dev','ssl.gstatic.com','upload.wikimedia.org'].includes(u.hostname.toLowerCase()))return null;if(!/\.(?:mp3|wav|ogg|oga)$/i.test(u.pathname))return null;return u.href;}catch{return null;}}
 function parse(root){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_ALL),offsets=new WeakMap();let node,flat='';while(node=walker.nextNode()){offsets.set(node,flat.length);if(node.nodeType===3)flat+=' '+node.data+' '; }
  const start=el=>offsets.get(el)||0;
  const attrs=el=>['class','title','data-accent','data-dialect','data-region','data-src-mp3','href','src'].map(k=>el.getAttribute?.(k)||'').join(' ');
  const lastAccent=text=>{const matches=[...String(text).matchAll(marker)];return matches.length?accent(matches.at(-1)[0]):null;};
  function hints(el,at){let region=accent(attrs(el)),kind=form(attrs(el));for(let p=el.parentElement,depth=0;p&&depth<4;p=p.parentElement,depth++){region||=accent(attrs(p));if(kind==='default')kind=form(attrs(p));if(region&&kind!=='default')break;}
   const before=flat.slice(Math.max(0,at-140),at),marks=[...before.matchAll(marker)],scope=marks.length?before.slice(marks.at(-1).index):before.slice(-65);region||=lastAccent(before);if(kind==='default')kind=form(scope);return {accent:region,form:kind};}
  const records=[];
  function add(text,metadata){text=String(text).trim().replace(/^\/+|\/+$/g,'').trim();if(!text||text.length>100||!/[a-zɐ-ʯˈˌəθðŋɜɒɑʊʌʃʒɛæ]/i.test(text)||/\b(?:form|british|american|phonetic|bre|name)\b/i.test(text))return;
   if(!records.some(r=>r.text===text&&r.accent===metadata.accent&&r.form===metadata.form))records.push({text,...metadata,audio:[]});}
  for(const el of [...root.querySelectorAll('[class*=phon],[class*=ipa]')].slice(0,128)){
   if(el.querySelector('[class*=phon],[class*=ipa]'))continue;const text=el.textContent||'',base=start(el),matches=[...text.matchAll(/\/([^/\n]{1,100})\//g)];
   if(matches.length){for(const m of matches){const h=hints(el,base+m.index);h.accent=lastAccent(text.slice(0,m.index))||h.accent;const f=form(text.slice(0,m.index));if(f!=='default')h.form=f;add(m[1],{...h,offset:base+m.index});}}
   else{const clean=text.replace(marker,'').replace(/\b(?:weak|strong)(?:\s+form)?\b/gi,'').trim();add(clean,{...hints(el,base),offset:base});}
  }
  // Some Oxford packages use a flat line rather than a separate IPA span.
  for(const m of [...flat.matchAll(/\b(BrE|NAmE|AmE)\b\s*((?:(?:weak|strong)\s+form\s*)?)\/([^/\n]{1,100})\//gi)].slice(0,64))add(m[3],{accent:accent(m[1]),form:form(m[2]),offset:m.index});
  const pronunciations=[];
  for(const el of [...root.querySelectorAll('a[href],audio[src],source[src],[data-src-mp3],[data-src-ogg]')].slice(0,128)){
   const raw=el.getAttribute('data-src-mp3')||el.getAttribute('data-src-ogg')||el.getAttribute('href')||el.getAttribute('src');if(!/^sound:\/\//i.test(raw||'')&&!/\.(mp3|wav|ogg)(?:[?#].*)?$/i.test(raw||''))continue;
   const path=localPath(raw);if(!path||pronunciations.some(p=>p.path===path))continue;const at=start(el),h=hints(el,at),region=accent(path)||h.accent;
   const candidates=records.filter(r=>!region||!r.accent||r.accent===region).sort((a,b)=>Math.abs(a.offset-at)-Math.abs(b.offset-at)),near=candidates[0],kind=form(path)!=='default'?form(path):h.form!=='default'?h.form:near?.form||'default';
   const record=records.find(r=>r.accent===region&&r.form===kind)||near;if(record&&!record.accent&&region)record.accent=region;
   pronunciations.push({path,accent:region||record?.accent||null,form:kind,phonetic:record?.text||''});if(record)record.audio.push(path);if(pronunciations.length>=16)break;
  }
  const pronunciationForms={},phonetics={};for(const r of records){if(!r.accent)continue;pronunciationForms[r.accent]||=[];pronunciationForms[r.accent].push({text:r.text,form:r.form,audio:r.audio});}
  for(const [region,forms] of Object.entries(pronunciationForms)){if(forms.some(p=>p.form==='strong'))for(const p of forms)if(p.form==='default'){p.form='weak';for(const a of pronunciations)if(a.accent===region&&a.phonetic===p.text&&a.form==='default')a.form='weak';}phonetics[region]=(forms.find(p=>p.form==='weak')||forms[0]).text;}
  return {phonetic:records[0]?.text||'',phonetics,pronunciationForms,pronunciations,audio:pronunciations.map(p=>p.path)};
 }
 function fromOnline(data){const item=Array.isArray(data)?data[0]:data,pronunciationForms={},pronunciations=[];for(const p of item?.phonetics||[]){const path=onlineURL(p.audio),region=accent(p.audio||'')||accent(p.sourceUrl||'');if(path)pronunciations.push({url:path,accent:region,form:'default',phonetic:p.text||''});if(region&&p.text){pronunciationForms[region]||=[];pronunciationForms[region].push({text:p.text.replace(/^\/+|\/+$/g,''),form:'default',audio:path?[path]:[]});}}return {pronunciationForms,pronunciations,phonetics:Object.fromEntries(Object.entries(pronunciationForms).map(([k,v])=>[k,v[0].text])),phonetic:item?.phonetic||item?.phonetics?.find(p=>p.text)?.text||''};}
 function selected(entry,region,kind='default'){const list=entry?.pronunciationForms?.[region]||[];return list.find(p=>p.form===kind)||list.find(p=>p.form==='weak')||list[0]||(entry?.phonetics?.[region]?{text:entry.phonetics[region],form:'default',audio:[]}:null);}
 return {accent,form,parse,fromOnline,selected,localPath,onlineURL};
})();
