/* Dictionary HTML/CSS is inert, local-only, and confined to its own shadow tree. */
import DOMPurify from 'dompurify';
import {parse,walk,generate} from 'css-tree';

const MB=1024*1024;
const tags='a abbr b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img kbd li mark ol p pre q rp rt ruby s samp section small span strong sub summary sup table tbody td th thead tfoot tr u ul var'.split(' ');
const props=new Set(('content counter-increment counter-reset color background background-color background-image background-position background-repeat background-size background-origin background-clip font font-family font-size font-style font-weight font-variant line-height letter-spacing word-spacing text-align text-indent text-decoration text-decoration-color text-decoration-line text-decoration-style text-transform text-shadow white-space word-break overflow-wrap vertical-align border border-color border-style border-width border-top border-bottom border-left border-right border-radius border-collapse border-spacing padding padding-top padding-bottom padding-left padding-right margin margin-top margin-bottom margin-left margin-right width min-width max-width height min-height max-height display box-sizing float clear list-style list-style-type list-style-position list-style-image table-layout caption-side empty-cells direction unicode-bidi flex flex-direction flex-wrap flex-grow flex-shrink flex-basis align-items align-self align-content justify-content gap row-gap column-gap grid-template-columns grid-template-rows grid-column grid-row order').split(' '));
const functions=new Set('counter counters rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix calc min max clamp var linear-gradient radial-gradient repeating-linear-gradient repeating-radial-gradient'.split(' '));
function local(raw,base=''){
 if(typeof raw!=='string')return null;
 let value=raw.trim().replace(/\\/g,'/');try{value=decodeURIComponent(value);}catch{}
 if(!value||value.length>500||/^[a-z][\w+.-]*:/i.test(value)||value.startsWith('//')||/[\0-\x1f]/.test(value))return null;
 value=value.split(/[?#]/)[0];if(!value)return null;
 const parts=value.startsWith('/')?[]:base.split('/').slice(0,-1).filter(Boolean);
 for(const part of value.split('/')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length)return null;parts.pop();}else parts.push(part);}
 return parts.join('/');
}
function image(data){if(!data||data.length>2*MB)return null;let type;if(data[0]===137&&data[1]===80&&data[2]===78&&data[3]===71)type='image/png';else if(data[0]===255&&data[1]===216)type='image/jpeg';else if(data[0]===71&&data[1]===73&&data[2]===70)type='image/gif';else if(data[0]===82&&data[8]===87&&data[9]===69)type='image/webp';return type?new Blob([data],{type}):null;}
async function prepare(html,files,getAsset){
 const template=document.createElement('template');template.innerHTML=String(html).slice(0,200000);
 const root=template.content,mdx=files.find(f=>/\.mdx$/i.test(f.name)),base=mdx?.name||'',assets=[],loaded=new Map(),prefix='yiduasset'+crypto.randomUUID().replace(/-/g,'');let assetBytes=0;
 const lookup=name=>files.find(f=>f.name.replace(/\\/g,'/').toLowerCase()===name.toLowerCase());
 async function bytes(name){const f=lookup(name);if(f)return f.size<=5*MB?new Uint8Array(await f.arrayBuffer()):null;try{return await getAsset(name);}catch{return null;}}
 async function asset(raw,from=base){const name=local(raw,from);if(!name)return null;if(loaded.has(name))return loaded.get(name);if(loaded.size>=64)return null;loaded.set(name,null);const blob=image(await bytes(name));if(!blob||assetBytes+blob.size>16*MB)return null;assetBytes+=blob.size;const key=prefix+assets.length;assets.push({key,blob});loaded.set(name,key);return key;}
 async function css(text,from,inline=false){
  if(text.length>5*MB)return '';let ast;try{ast=parse(text,{context:inline?'declarationList':'stylesheet',onParseError(){throw Error('CSS_PARSE');}});}catch{return '';}
  const urls=[];walk(ast,node=>{if(node.type==='Url')urls.push(node);});for(const node of urls)node.value=await asset(node.value,from)||'';
  walk(ast,{leave(node,item,list){
   if(node.type==='Atrule'&&!['media','supports'].includes(node.name.toLowerCase())){list?.remove(item);return;}
   if(node.type==='Rule'){
    let bad=false;walk(node.prelude,n=>{if(n.type==='Raw'||n.type==='PseudoClassSelector'&&['host','host-context'].includes(n.name.toLowerCase())||n.type==='PseudoElementSelector'&&['slotted','part'].includes(n.name.toLowerCase()))bad=true;});
    if(bad){list?.remove(item);return;}
   }
   if(node.type==='TypeSelector'&&['html','body'].includes(node.name.toLowerCase())){node.type='ClassSelector';node.name=node.name.toLowerCase()==='html'?'dictionary-html':'dictionary-body';}
   if(node.type==='PseudoClassSelector'&&node.name.toLowerCase()==='root'){node.type='ClassSelector';node.name='dictionary-html';delete node.children;}
   if(node.type==='Declaration'){
    let bad=!props.has(node.property.toLowerCase())&&!/^--[\w-]+$/.test(node.property);walk(node.value,n=>{if(n.type==='Raw'||n.type==='Function'&&!functions.has(n.name.toLowerCase())||n.type==='Url'&&!n.value)bad=true;});
    if(bad)list?.remove(item);
   }
  }});return generate(ast);
 }
 const sheets=[];let cssBytes=0;
 const names=new Set();const defaultName=base.replace(/\.mdx$/i,'.css');if(lookup(defaultName))names.add(defaultName);
 for(const el of root.querySelectorAll('link[rel~="stylesheet"][href]')){const name=local(el.getAttribute('href'),base);if(name)names.add(name);}
 for(const name of [...names].slice(0,32)){const data=await bytes(name);if(!data||data.length>5*MB||(cssBytes+=data.length)>20*MB)continue;sheets.push(await css(new TextDecoder().decode(data),name));}
 for(const el of [...root.querySelectorAll('style')].slice(0,32)){const text=el.textContent;if((cssBytes+=text.length)>20*MB)break;sheets.push(await css(text,base));}
 // Keep legacy text-only rendering when no stylesheet or inline style exists.
 if(!sheets.some(Boolean)&&!root.querySelector('[style]'))return null;
 for(const el of root.querySelectorAll('script,style,link,iframe,object,embed,svg,math,form,template,audio,video,source'))el.remove();
 for(const el of root.querySelectorAll('*')){
  const src=el.localName==='img'?el.getAttribute('src'):null,href=el.localName==='a'?el.getAttribute('href'):null,style=el.getAttribute('style');
  for(const attr of [...el.attributes])if(!['class','id','title','lang','dir','colspan','rowspan'].includes(attr.name))el.removeAttribute(attr.name);
  if(style){const clean=await css(style,base,true);if(clean)el.setAttribute('style',clean);}
  if(src){const key=await asset(src);if(key)el.setAttribute('data-yidu-image',key);}
  if(href&&/^sound:\/\//i.test(href)){const path=href.replace(/^sound:\/\//i,'').replace(/\\/g,'/');if(path.length<=500&&!/[\0-\x1f]/.test(path)){el.setAttribute('data-yidu-audio',path);el.setAttribute('role','button');el.setAttribute('tabindex','0');}}
 }
 const clean=DOMPurify.sanitize(template.innerHTML,{ALLOWED_TAGS:tags,ALLOWED_ATTR:['class','id','title','lang','dir','colspan','rowspan','style','data-yidu-image','data-yidu-audio','role','tabindex'],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false});
 return {html:clean,css:sheets.join('\n'),assets};
}
const urls=new Set();
function clear(){for(const url of urls)URL.revokeObjectURL(url);urls.clear();}
function render(meaning,rich,onSpeak,options={}){
 if(!meaning||!rich)return false;
 const map=new Map(rich.assets.map(({key,blob})=>{const url=URL.createObjectURL(blob);urls.add(url);return [key,url];}));
 const replace=text=>text.replace(/yiduasset[a-f0-9]{32}\d+/g,key=>map.get(key)||'');
 const host=document.createElement('div');host.className='mdict-rich';host.style.cssText='display:block;contain:content;isolation:isolate;overflow:auto;touch-action:pan-y pinch-zoom;max-width:100%;color:inherit;white-space:normal';
 const shadow=host.attachShadow({mode:'open'}),style=document.createElement('style');style.textContent=(options.css===false?'':replace(rich.css))+'\n:host{all:initial;display:block;contain:content;isolation:isolate;overflow:auto;touch-action:pan-y pinch-zoom;max-width:100%;color:inherit;font:inherit}*,*::before,*::after{box-sizing:border-box}img{max-width:100%;height:auto}pre{white-space:pre-wrap}a[data-yidu-audio]{cursor:pointer;text-decoration:underline}';
 const outer=document.createElement('div');outer.className='dictionary-html';const body=document.createElement('div');body.className='dictionary-body';body.innerHTML=rich.html;
 for(const el of body.querySelectorAll('[style]'))if(options.css===false)el.removeAttribute('style');else el.setAttribute('style',replace(el.getAttribute('style')));
 for(const el of body.querySelectorAll('[data-yidu-image]')){const url=map.get(el.getAttribute('data-yidu-image'));if(url){el.src=url;el.alt=el.getAttribute('title')||'';}el.removeAttribute('data-yidu-image');}
 const speak=e=>{if(e.type==='keydown'&&!['Enter',' '].includes(e.key))return;const link=e.target.closest?.('[data-yidu-audio]');if(link){e.preventDefault();onSpeak?.(link.getAttribute('data-yidu-audio'));}};body.addEventListener('click',speak);body.addEventListener('keydown',speak);
 outer.append(body);shadow.append(style,outer);meaning.replaceChildren(host);if(options.dark)adaptNight(host,meaning);return true;
}
// Preserve layout and semantic hues while correcting hard-coded light-page colours.
function adaptNight(host,meaning){
 const rgb=value=>{const n=value.match(/[\d.]+/g)?.map(Number);return n?.length>=3?n.slice(0,3):[32,38,44];};
 const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05),mix=(a,b,t)=>a.map((v,i)=>Math.round(v*(1-t)+b[i]*t)),css=c=>'rgb('+c.join(',')+')';
 const pseudo=document.createElement('style');pseudo.textContent='*::before,*::after{color:inherit!important;text-shadow:none!important}';host.shadowRoot.append(pseudo);
 const surface=rgb(getComputedStyle(meaning.closest('.word-popover')||meaning).backgroundColor),base=lum(surface)<.3?surface:[32,38,44],ink=[235,238,240],backgrounds=new WeakMap();
 for(const el of [host.shadowRoot.querySelector('.dictionary-html'),...host.shadowRoot.querySelector('.dictionary-html').querySelectorAll('*')].slice(0,8000)){
  const style=getComputedStyle(el),parent=backgrounds.get(el.parentElement)||base;let bg=parent;const raw=style.backgroundColor,n=raw.match(/[\d.]+/g)?.map(Number);
  if(n&&n.length>=3&&(n.length===3||n[3]>.02)){bg=mix(base,rgb(raw),.12);el.style.setProperty('background-color',css(bg),'important');}
  backgrounds.set(el,bg);let color=rgb(style.color);if(contrast(color,bg)<4.5){const from=color;for(let t=.1;t<=1.01;t+=.1){color=mix(from,ink,t);if(contrast(color,bg)>=4.5)break;}el.style.setProperty('color',css(color),'important');}
  if(style.backgroundImage.includes('gradient('))el.style.setProperty('background-image','none','important');el.style.setProperty('text-shadow','none','important');for(const side of ['top','right','bottom','left'])if(parseFloat(style.getPropertyValue('border-'+side+'-width'))>0)el.style.setProperty('border-'+side+'-color',css(mix(base,rgb(style.getPropertyValue('border-'+side+'-color')),.45)),'important');
 }
}
window.YiduDictionaryRich={prepare,render,clear,local};
