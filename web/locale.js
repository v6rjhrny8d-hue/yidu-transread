'use strict';
// Translate application-owned literal copy only. Never walk the live DOM or
// pass book paragraphs, translations, definitions, names or notes to this layer.
window.TransReadI18n=(()=>{
 const choices=['system','zh-CN','zh-TW','en'];let choice='system',locale='en',catalog={},matcher=null;
 const caches=new Map(),autonyms={'zh-CN':'简体中文','zh-TW':'繁體中文',en:'English'};
 function normalize(tags){
  for(const value of tags||[]){const tag=String(value).replace(/_/g,'-').toLowerCase();
   if(/^zh(?:-|$)/.test(tag))return /(?:hant|tw|hk|mo)(?:-|$)/.test(tag)?'zh-TW':'zh-CN';
   if(/^en(?:-|$)/.test(tag))return 'en';
  }return 'en';
 }
 function system(){return normalize(window.__lumiSystemLocales||navigator.languages||[navigator.language]);}
 function validChoice(value){return choices.includes(value)?value:'system';}
 function set(value){choice=validChoice(value);locale=choice==='system'?system():choice;document.documentElement.lang=locale;document.documentElement.dir='ltr';document.title=locale==='en'?'TransRead':locale==='zh-TW'?'譯讀 · TransRead':'译读 · TransRead';return locale;}
 function tr(value){
  const text=String(value??'');if(!matcher)return text;
  const cacheKey=locale+'\0'+text;if(caches.has(cacheKey))return caches.get(cacheKey);
  const result=text.replace(matcher,key=>catalog[locale]?.[key]??key);
  if(caches.size>=600)caches.delete(caches.keys().next().value);caches.set(cacheKey,result);return result;
 }
 function ui(strings,...values){let html=tr(strings[0]);for(let i=0;i<values.length;i++)html+=values[i]+tr(strings[i+1]);return html;}
 async function load(){
  const r=await fetch('assets/ui-locales.json');if(!r.ok)throw Error('Unable to load interface languages');catalog=await r.json();
  const keys=[...new Set(Object.values(catalog).flatMap(c=>Object.keys(c)))].filter(Boolean).sort((a,b)=>b.length-a.length);
  matcher=new RegExp(keys.map(k=>k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');caches.clear();set(choice);
 }
 set('system');
 return {tr,ui,load,set,system,normalize,validChoice,autonyms,get locale(){return locale;},get choice(){return choice;}};
})();
