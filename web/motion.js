'use strict';
/* Shared interaction motion. No timers or animation frames run while the UI is idle. */
window.ReaderMotion=(()=>{
 const active=new WeakMap(),running=new Set(),inlineSources=new WeakMap(),springCache=new Map(),backgroundLocks=new Map();
 const timing={press:80,rebound:300,sheetIn:360,sheetOut:170,popIn:400,popOut:150,morph:160,tabIn:190,tabOut:70,bookIn:240,bookOut:90,capsule:320,dock:280,sheetRebound:300};
 let reduce=()=>false,onDismiss=()=>{},onGesture=()=>{},trigger=null,overlay=null,sceneId=0,sceneExit=null,pressed=null,sheetDrag=null,momentum=null,sheetClickBlock=null,modalClickBlock=null;
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 const reduced=()=>!!reduce()||!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 const available=el=>!!el?.animate&&!reduced();
 function applyInert(el,value){if(!el)return;el.inert=!!value;el.toggleAttribute('inert',!!value);}
 function setInert(el,value){if(!el)return;if(backgroundLocks.has(el)){backgroundLocks.set(el,!!value);applyInert(el,true);}else applyInert(el,value);}
 function lockBackground(){for(const el of document.querySelectorAll('#app,#dock-root,#page-actions,#sentence-action,#notes-chrome,#pdf-chrome')){if(!backgroundLocks.has(el))backgroundLocks.set(el,el.hasAttribute('inert'));applyInert(el,true);}}
 function unlockBackground(){const locks=[...backgroundLocks];backgroundLocks.clear();for(const [el,wasInert] of locks)applyInert(el,wasInert);}
 function modalInput(e){
  if(e.type==='pointerdown')modalClickBlock=null;
  const block=modalClickBlock;
  if(e.type==='click'&&e.detail>0&&block&&performance.now()-block.time<1500&&(e.pointerId===block.id||Math.hypot((e.clientX||0)-block.x,(e.clientY||0)-block.y)<12||e.sourceCapabilities?.firesTouchEvents)){e.preventDefault();e.stopImmediatePropagation();return;}
  const record=overlay;if(!record?.modal)return;const inside=record.root.contains(e.target);
  if(inside&&record.kind==='image'&&record.closing&&e.type==='pointerdown'){record.ignoreTap=e.pointerId;imageRun(record,false);return;}
  if(inside&&!record.closing){if(record.kind==='image'&&e.type==='pointerup')modalClickBlock={id:e.pointerId,x:e.clientX,y:e.clientY,time:performance.now()};return;}
  if(inside&&record.kind==='sheet'&&record.closing&&e.type==='pointerdown'&&record.panel.contains(e.target))return;
  if(e.type==='pointerup')modalClickBlock={id:e.pointerId,x:e.clientX,y:e.clientY,time:performance.now()};
  e.preventDefault();e.stopImmediatePropagation();
 }
 for(const type of ['pointerdown','pointermove','pointerup','click','contextmenu','wheel'])document.addEventListener(type,modalInput,{capture:true,passive:false});
 function configure(options){reduce=options.reduced||reduce;onDismiss=options.onDismiss||onDismiss;onGesture=options.onGesture||onGesture;}
 function rect(el){if(!el?.isConnected)return null;const r=el.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height}:null;}
 function origin(el){return {el,box:rect(el)};}
 function mark(el){trigger=el?.isConnected?origin(el):null;}
 function take(){const value=trigger;trigger=null;return value?.el?.isConnected?value:null;}
 function cancel(el){const animation=active.get(el);if(!animation)return;active.delete(el);running.delete(animation);animation.cancel();}
 function animate(el,frames,{duration=timing.popIn,easing='linear',delay=0}={}){
  if(!available(el))return null;cancel(el);
  let animation;try{animation=el.animate(frames,{duration,easing,delay,fill:'both'});}catch{return null;}
  active.set(el,animation);running.add(animation);
  const done=animation.finished.then(()=>true,()=>false).finally(()=>{running.delete(animation);if(active.get(el)===animation){active.delete(el);animation.cancel();}});
  return {animation,done};
 }
 function spring(from,to,velocity=0,stiffness=340,damping=29,duration=520,steps=64){
  const key=[from,to,velocity,stiffness,damping,duration,steps].join(':');
  if(springCache.has(key)){const saved=springCache.get(key);springCache.delete(key);springCache.set(key,saved);return saved.map(p=>({...p}));}
  const dt=duration/1000/steps,frames=[{value:from,offset:0}];let x=from,v=clamp(velocity,-8,8);
  for(let i=1;i<=steps;i++){v+=(-stiffness*(x-to)-damping*v)*dt;x+=v*dt;if(i%2===0)frames.push({value:i===steps?to:x,offset:i/steps});}
  springCache.set(key,frames.map(p=>({...p})));if(springCache.size>64)springCache.delete(springCache.keys().next().value);
  return frames;
 }
 function rebound(el,from=1,to=1,velocity=0){return animate(el,spring(from,to,velocity,600,38,timing.rebound).map(p=>({transform:`scale(${p.value})`,offset:p.offset})),{duration:timing.rebound});}
 function currentScale(el){const t=getComputedStyle(el).transform,values=t?.match(/^matrix\(([^)]+)\)/)?.[1].split(',').map(Number);return values?Math.hypot(values[0],values[1]):1;}
 function releasePress(){if(!pressed)return;const p=pressed;pressed=null;delete p.el.dataset.pressing;for(const target of p.targets){if(!target.el.isConnected)continue;const scale=currentScale(target.el);target.el.style.transform=target.original;rebound(target.el,scale,1);}}
 function press(e){if(e.button>0||e.isPrimary===false)return;releasePress();const el=e.target.closest?.('button');if(!el||el.disabled||!available(el))return;const targets=[...el.children].map(child=>({el:child,original:child.style.transform}));pressed={el,id:e.pointerId,x:e.clientX,y:e.clientY,targets};el.dataset.pressing='true';for(const target of targets){const from=getComputedStyle(target.el).transform;target.el.style.transform='scale(.955)';animate(target.el,[{transform:from==='none'?'scale(1)':from},{transform:'scale(.955)'}],{duration:timing.press,easing:'cubic-bezier(.2,.8,.2,1)'});}}
 document.addEventListener('pointerdown',press,{passive:true});
 document.addEventListener('pointerdown',()=>document.documentElement.classList.add('pointer-modality'),{capture:true,passive:true});
 document.addEventListener('keydown',()=>document.documentElement.classList.remove('pointer-modality'),{capture:true});
 document.addEventListener('pointermove',e=>{if(pressed&&pressed.id===e.pointerId&&Math.hypot(e.clientX-pressed.x,e.clientY-pressed.y)>10)releasePress();},{passive:true});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])document.addEventListener(event,e=>{if(pressed?.id===e.pointerId)releasePress();},{passive:true});
 document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('button')&&!e.repeat)press({target:e.target,button:0,pointerId:-1,clientX:0,clientY:0});});
 document.addEventListener('keyup',e=>{if(e.key==='Enter'||e.key===' ')releasePress();});
 function geometry(panel,source){const p=panel.getBoundingClientRect(),b=rect(source?.el)||source?.box;return b&&p.width>0&&p.height>0?{x:b.x-(p.left+p.width/2),y:b.y-(p.top+p.height/2),scale:clamp(Math.min(b.width/p.width,b.height/p.height),.12,.72)}:{x:0,y:80,scale:.94};}
 const transform=(g,p)=>`translate3d(${g.x*(1-p)}px,${g.y*(1-p)}px,0) scale(${g.scale+(1-g.scale)*p})`;
 function reveal(el,source=null){if(!el)return;const g=geometry(el,source),base=getComputedStyle(el).transform==='none'?'':getComputedStyle(el).transform;inlineSources.set(el,{g,base});return animate(el,spring(0,1,0,500,30,timing.popIn,80).map(p=>({transform:base+` translate3d(${clamp(g.x,-36,36)*(1-p.value)}px,${clamp(g.y,-48,48)*(1-p.value)}px,0)`,opacity:clamp(p.value*2,0,1),offset:p.offset})),{duration:timing.popIn});}
 function cards(root){if(!root||reduced())return;let count=0;const frames=spring(0,1,0,500,30,360,72).map(p=>({transform:`translate3d(0,${10*(1-p.value)}px,0)`,opacity:clamp(.65+p.value*.35,0,1),offset:p.offset}));for(const el of root.querySelectorAll('article,.stats,.settings-group,.book-card,.book-add')){const r=el.getBoundingClientRect();if(r.bottom<=0||r.top>=innerHeight||count>=12)continue;animate(el,frames,{duration:360});count++;}}
 function removeInline(el){if(!el||el.dataset.motionLeaving)return;el.dataset.motionLeaving='true';setInert(el,true);el.removeAttribute('id');const saved=inlineSources.get(el),g=saved?.g||{x:0,y:24,scale:.94},base=saved?.base||'',result=animate(el,[{transform:getComputedStyle(el).transform==='none'?'translate3d(0,0,0) scale(1)':getComputedStyle(el).transform,opacity:1},{transform:base+' '+transform(g,0),opacity:0}],{duration:timing.popOut});if(result)result.done.then(()=>el.remove());else el.remove();}
 function currentOverlay(){return overlay;}
 function clear(root){stopMomentum();const record=overlay;if(record){imageStop(record);record.sheetInput?.destroy();cancel(record.panel);cancel(record.backdrop);cancel(record.image);cancel(record.caption);if(record.hiddenSource)record.hiddenSource.el.style.visibility=record.hiddenSource.visibility;if(sheetDrag?.record===record)sheetDrag=null;}overlay=record?.parent||null;root.replaceChildren();setInert(root,false);if(overlay){const saved=record.parentState;thawParent(saved?.frozen);applyInert(overlay.panel,!!saved?.inert);if(saved?.hidden==null)overlay.panel.removeAttribute('aria-hidden');else overlay.panel.setAttribute('aria-hidden',saved.hidden);overlay.sheetInput?.refresh();}else unlockBackground();record?.onClear?.();}

 const radiusKeys=Array.from({length:4},(_,i)=>['r'+i+'x','r'+i+'y']).flat(),imageKeys=['x','y','sx','sy',...radiusKeys];
 function imageRadii(el){const css=getComputedStyle(el),w=el.offsetWidth,h=el.offsetHeight,out={};['TopLeft','TopRight','BottomRight','BottomLeft'].forEach((corner,i)=>{const parts=css['border'+corner+'Radius'].split(/\s+/),px=(v,size)=>Math.max(0,parseFloat(v)||0)*(v?.includes('%')?size/100:1);out['r'+i+'x']=px(parts[0],w);out['r'+i+'y']=px(parts[1]||parts[0],h);});return out;}
 function imageGeometry(image,source){const body=image.parentElement.getBoundingClientRect(),original=source?.el?.querySelector?.('img')||source?.el,b=rect(original)||source?.box,w=image.offsetWidth||image.getBoundingClientRect().width,h=image.offsetHeight||image.getBoundingClientRect().height,g=b&&w>0&&h>0?{x:b.x-(body.left+body.width/2),y:b.y-(body.top+body.height/2),sx:b.width/w,sy:b.height/h}:{x:0,y:20,sx:.94,sy:.94},r=original?.isConnected?imageRadii(original):imageRadii(image);for(const key of radiusKeys)g[key]=r[key]*(original?.isConnected&&b?key.endsWith('x')?b.width/Math.max(1,original.offsetWidth):b.height/Math.max(1,original.offsetHeight):1);return g;}
 function imageTarget(record){return {x:0,y:0,sx:1,sy:1,...record.imageRadii};}
 const imageTransform=g=>`translate3d(${g.x}px,${g.y}px,0) scale(${g.sx},${g.sy})`;
 function imagePose(value){const matrix=value?.match(/^matrix(3d)?\(([^)]+)\)/);if(matrix){const v=matrix[2].split(',').map(Number);return {x:v[matrix[1]?12:4]||0,y:v[matrix[1]?13:5]||0,sx:Math.hypot(v[0],v[1]),sy:Math.hypot(v[matrix[1]?4:2],v[matrix[1]?5:3])};}const t=value?.match(/translate3d\(\s*([-\d.]+)px,\s*([-\d.]+)px/),scale=value?.match(/scale\(\s*([-\d.]+)(?:,\s*([-\d.]+))?/);return {x:Number(t?.[1])||0,y:Number(t?.[2])||0,sx:Number(scale?.[1])||1,sy:Number(scale?.[2]||scale?.[1])||1};}
 function imageSpring(from,to,duration){return spring(0,1,0,620,36,duration,72).map(p=>({transform:imageTransform({x:from.x+(to.x-from.x)*p.value,y:from.y+(to.y-from.y)*p.value,sx:Math.max(.01,from.sx+(to.sx-from.sx)*p.value),sy:Math.max(.01,from.sy+(to.sy-from.sy)*p.value)}),offset:p.offset}));}

 // A single finite clock owns image geometry, blur radius and modal completion.
 function imageStop(record){if(record?.imageFrame)cancelAnimationFrame(record.imageFrame);if(record){record.imageFrame=0;record.imageResolve?.(false);record.imageResolve=null;}}
 function imagePaint(record,pose,blur){record.pose=pose;record.blur=clamp(blur,0,18);if(!record.gesture)record.image.style.transform=imageTransform(pose);record.image.style.borderRadius=[0,1,2,3].map(i=>Math.max(0,pose['r'+i+'x']||0)/pose.sx+'px').join(' ')+' / '+[0,1,2,3].map(i=>Math.max(0,pose['r'+i+'y']||0)/pose.sy+'px').join(' ');if(record.backdrop){record.backdrop.style.opacity='1';record.backdrop.style.backdropFilter=`blur(${record.blur}px)`;record.backdrop.style.webkitBackdropFilter=`blur(${record.blur}px)`;record.backdrop.style.setProperty('--image-tint-alpha',String(.12*record.blur/18));}if(record.caption)record.caption.style.opacity=String(record.blur/18);}
 function imageRun(record,closing){if(overlay!==record)return Promise.resolve(false);if(record.closing===closing&&record.imageFrame)return record.promise;imageStop(record);record.closeToken++;const token=record.closeToken,from=record.pose||imagePose(getComputedStyle(record.image).transform),to=closing?imageGeometry(record.image,record.source):imageTarget(record),vel={...(record.velocity||{})},blurFrom=record.blur||0,blurVelocity=record.blurVelocity||0,blurTo=closing?0:18,started=performance.now(),duration=reduced()?0:closing?320:380;record.closing=closing;record.gesture=false;
  record.promise=new Promise(resolve=>{record.imageResolve=resolve;let previous={...from},last=started;
   const tick=now=>{if(overlay!==record||record.closeToken!==token){resolve(false);return;}const t=duration?clamp((now-started)/duration,0,1):1,seconds=(now-started)/1000,pose={},omega=25,damping=18;
    for(const key of imageKeys){const a=from[key]-to[key],b=((vel[key]||0)+damping*a)/omega;pose[key]=t===0?from[key]:t===1?to[key]:to[key]+Math.exp(-damping*seconds)*(a*Math.cos(omega*seconds)+b*Math.sin(omega*seconds));if(key==='sx'||key==='sy'){pose[key]=Math.max(.01,pose[key]);if(!closing&&from[key]<1)pose[key]=Math.min(1.018,pose[key]);}}
    const blurDuration=closing?170:200,bt=duration?clamp((now-started)/blurDuration,0,1):1,delta=blurTo-blurFrom,slope=delta?clamp(blurVelocity*blurDuration/1000/delta,-.5,2.8):0,ease=bt*bt*(3-2*bt)+slope*bt*(1-bt)*(1-bt),blur=bt===1?blurTo:clamp(blurFrom+delta*ease,0,18);record.blurVelocity=t===0?blurVelocity:(blur-(record.blur||0))/Math.max(.001,(now-last)/1000);record.velocity={};for(const key of imageKeys)record.velocity[key]=t===0?(vel[key]||0):(pose[key]-previous[key])/Math.max(.001,(now-last)/1000);previous=pose;last=now;imagePaint(record,pose,blur);record.imageProgress=t;
    if(t<1)record.imageFrame=requestAnimationFrame(tick);else{record.imageFrame=0;record.imageResolve=null;record.velocity={x:0,y:0,sx:0,sy:0};if(closing){const source=record.source?.el;clear(record.root);source?.isConnected&&source.focus?.({preventScroll:true});}resolve(true);}
   };tick(started);
  });return record.promise;
 }
 function imageGrab(){const r=overlay;if(r?.kind!=='image')return null;const pose={...r.pose,...imagePose(getComputedStyle(r.image).transform)};imageStop(r);r.pose=pose;r.gesture=true;r.closing=false;r.closeToken++;r.velocity={x:0,y:0,sx:0,sy:0};const from=r.blur||0,start=performance.now();function tick(now){if(overlay!==r||!r.gesture)return;const t=clamp((now-start)/180,0,1);imagePaint(r,r.pose,from+(18-from)*t*t*(3-2*t));if(t<1)r.imageFrame=requestAnimationFrame(tick);else r.imageFrame=0;}r.imageFrame=requestAnimationFrame(tick);return pose;}
 function imageGesturePose(pose){if(overlay?.kind==='image'){const r=overlay;imagePaint(r,{...r.pose,...pose},r.blur);}}
 function imageReset(){const r=overlay;if(r?.kind!=='image')return;imageStop(r);r.gesture=false;r.closing=false;r.closeToken++;imagePaint(r,imageTarget(r),18);}
 function interruptSheetClose(record){const from=getComputedStyle(record.panel).transform,color=record.backdrop&&getComputedStyle(record.backdrop).backgroundColor;record.closeToken++;record.closing=false;record.promise=null;cancel(record.panel);cancel(record.backdrop);record.panel.style.transform=from==='none'?'translate3d(0,0,0)':from;if(record.backdrop){record.backdrop.style.backgroundColor=color;animate(record.backdrop,[{backgroundColor:color},{backgroundColor:record.backdrop.matches('.preview-backdrop,.stack-backdrop')?'rgba(20,26,22,0)':'rgba(20,26,22,.25)'}],{duration:180});}}
 function offsetY(value){const matrix=value?.match(/^matrix(3d)?\(([^)]+)\)/);if(matrix){const values=matrix[2].split(',').map(Number);return values[matrix[1]?13:5]||0;}return Number(value?.match(/^translate3d\([^,]+,\s*([-\d.]+)px/)?.[1])||0;}
 function sheetTravel(panel,from=getComputedStyle(panel).transform){return Math.max(0,innerHeight-panel.getBoundingClientRect().top+offsetY(from)+16);}
 function freezeParent(record){
  if(record?.kind!=='sheet'||!record.backdrop)return null;
  const b=record.backdrop,p=record.panel,r=b.getBoundingClientRect(),box=p.getBoundingClientRect(),style=getComputedStyle(b),saved=[];
  const pin=(el,props)=>{for(const [key,value] of Object.entries(props)){saved.push({el,key,value:el.style.getPropertyValue(key),priority:el.style.getPropertyPriority(key)});el.style.setProperty(key,value,'important');}};
  pin(b,{position:'fixed',top:r.top+'px',left:r.left+'px',right:'auto',bottom:'auto',width:r.width+'px',height:r.height+'px','padding-top':style.paddingTop,'padding-right':style.paddingRight,'padding-bottom':style.paddingBottom,'padding-left':style.paddingLeft,'--modal-viewport-height':r.height+'px','--modal-viewport-width':r.width+'px'});
  pin(p,{height:box.height+'px','max-height':box.height+'px',width:box.width+'px','max-width':box.width+'px'});return saved;
 }
 function thawParent(saved){for(const item of saved||[]){if(item.value)item.el.style.setProperty(item.key,item.value,item.priority);else item.el.style.removeProperty(item.key);}}
 function present(root,panel,source,{kind='sheet',previous=null,same=false,fromHeight=0,keepParent=false,onClear=null}={}){
  const backdrop=kind==='image'?panel.querySelector('.image-viewer-dim'):panel.closest('.backdrop'),internal=previous&&(!source?.el||previous.panel.contains(source.el));
  const parent=keepParent?overlay:null,parentState=parent?{inert:parent.panel.inert,hidden:parent.panel.getAttribute('aria-hidden')}:null;if(parent){if(parent.closing)interruptSheetClose(parent);parent.sheetInput?.cancel();cancel(parent.panel);parent.panel.style.removeProperty('transform');applyInert(parent.panel,true);parent.panel.setAttribute('aria-hidden','true');parentState.frozen=freezeParent(parent);let ancestor=parent,shaded=false;while(ancestor){if(ancestor.backdrop&&!ancestor.backdrop.matches('.preview-backdrop,.stack-backdrop'))shaded=true;ancestor=ancestor.parent;}if(shaded)backdrop?.classList.add('stack-backdrop');}
  const record={root,panel,backdrop,kind,parent,parentState,onClear,source:internal?previous.source:source,closing:false,promise:null,closeToken:0,modal:kind==='image'||kind==='sheet'};overlay=record;setInert(root,false);if(record.modal)lockBackground();
  panel.style.animation='none';if(backdrop)backdrop.style.animation='none';
  panel.tabIndex=-1;if(kind==='sheet')record.sheetInput=sheetInput(record);
  if(!same){
   if(kind==='image'){record.image=panel.querySelector('.image-viewer-body img');record.caption=panel.querySelector('.image-viewer-head');record.imageRadii=imageRadii(record.image);const original=record.source?.el?.querySelector?.('img');if(original){record.hiddenSource={el:original,visibility:original.style.visibility};original.style.visibility='hidden';}record.pose=imageGeometry(record.image,record.source);record.imageOrigin={...record.pose};record.blur=0;record.velocity={x:0,y:0,sx:0,sy:0};imageRun(record,false);}
   else if(kind==='sheet'){panel.style.removeProperty('transform');const travel=sheetTravel(panel);animate(panel,spring(0,1,0,700,40,timing.sheetIn,72).map(p=>({transform:p.offset===1?'translate3d(0,0,0)':`translate3d(0,${(p.value>1?10*Math.tanh(travel*(1-p.value)/10):travel*(1-p.value))}px,0)`,opacity:1,offset:p.offset})),{duration:timing.sheetIn});}
   else {const g=geometry(panel,record.source);record.geometry=g;animate(panel,spring(0,1,0,500,30,timing.popIn,80).map(p=>({transform:`translate3d(${clamp(g.x,-36,36)*(1-p.value)}px,${clamp(g.y,-64,64)*(1-p.value)}px,0)`,opacity:clamp(p.value*2,0,1),offset:p.offset})),{duration:timing.popIn});}
   if(kind!=='image'&&backdrop&&!previous&&!backdrop.matches('.preview-backdrop,.stack-backdrop'))animate(backdrop,[{backgroundColor:'rgba(20,26,22,0)'},{backgroundColor:'rgba(20,26,22,.25)'}],{duration:kind==='sheet'?timing.sheetIn:timing.popIn});
  }
  if(same&&fromHeight>0){const height=panel.getBoundingClientRect().height;if(Math.abs(height-fromHeight)>1)animate(panel,[{height:fromHeight+'px'},{height:height+'px'}],{duration:timing.morph,easing:'cubic-bezier(.2,.8,.2,1)'});}
  if(kind==='sheet'||kind==='image')panel.focus({preventScroll:true});
  return record;
 }
 function dismiss(root,{immediate=false}={}){
  const record=overlay;if(!record||record.root!==root){root.replaceChildren();return Promise.resolve();}
  if(immediate||!available(record.image||record.panel)){const source=record.source?.el;clear(root);if(!immediate){if(source?.isConnected)source.focus?.({preventScroll:true});else overlay?.panel.focus({preventScroll:true});}return Promise.resolve();}
  if(record.kind==='image'&&record.image)return imageRun(record,true);
  if(record.kind==='sheet'&&record.panel.contains(document.activeElement)&&document.activeElement?.matches('input,textarea'))document.activeElement.blur();
  if(record.closing)return record.promise;record.closing=true;const closeToken=++record.closeToken;

  const from=getComputedStyle(record.panel).transform,isSheet=record.kind==='sheet',pulled=isSheet&&Number.isFinite(record.releaseVelocity),duration=isSheet?(pulled?clamp((sheetTravel(record.panel,from)-offsetY(from))/Math.max(2.5,record.releaseVelocity),90,timing.sheetOut):timing.sheetOut):timing.popOut;
  const target=isSheet?`translate3d(0,${sheetTravel(record.panel,from)}px,0)`:transform(geometry(record.panel,record.source),0);
  const alpha=Number(getComputedStyle(record.panel).opacity);const exit=animate(record.panel,[{transform:!from||from==='none'?'translate3d(0,0,0) scale(1)':from,opacity:Number.isFinite(alpha)?alpha:1},{transform:target,opacity:isSheet?1:0}],{duration,easing:pulled?'cubic-bezier(.15,.6,.25,1)':'cubic-bezier(.4,0,.8,.2)'});
  if(record.backdrop)animate(record.backdrop,[{backgroundColor:getComputedStyle(record.backdrop).backgroundColor},{backgroundColor:'rgba(20,26,22,0)'}],{duration});
  record.promise=(exit?.done||Promise.resolve()).then(completed=>{if(overlay!==record||record.closeToken!==closeToken||completed===false)return;const source=record.source?.el;clear(root);if(source?.isConnected)source.focus?.({preventScroll:true});else overlay?.panel.focus({preventScroll:true});});
  return record.promise;
 }
 function sheetOwner(){return overlay;}
 function stopMomentum(){if(momentum)cancelAnimationFrame(momentum.frame);momentum=null;}
 function sheetHasSelection(panel){const selection=window.getSelection();return !!(selection?.toString().trim()&&panel.contains(selection.anchorNode));}
 function scrollChain(target,panel){const list=[];for(let el=target;el&&panel.contains(el);el=el.parentElement){const max=el.scrollHeight-el.clientHeight,overflow=getComputedStyle(el).overflowY;if(max>1&&(/auto|scroll/.test(overflow)||el===panel&&!/hidden|clip/.test(overflow)))list.push({el,max});if(el===panel)break;}return list;}
 function scrollByChain(list,amount){let remaining=amount;for(const {el,max} of list){const before=Math.max(0,el.scrollTop),after=clamp(before+remaining,0,max);el.scrollTop=after;remaining-=after-before;if(Math.abs(remaining)<.01)break;}return amount-remaining;}
 function coast(record,list,velocity){stopMomentum();if(reduced()||Math.abs(velocity)<.08)return;const state={record,list,velocity:clamp(velocity,-3.5,3.5),time:performance.now(),frame:0};momentum=state;
  const step=now=>{if(momentum!==state||sheetOwner()!==record||record.closing||document.hidden||reduced()){stopMomentum();return;}const dt=clamp(now-state.time,1,32);state.time=now;const moved=scrollByChain(list,state.velocity*dt);state.velocity*=Math.exp(-dt/180);if(Math.abs(moved)<.1||Math.abs(state.velocity)<.03){stopMomentum();return;}state.frame=requestAnimationFrame(step);};state.frame=requestAnimationFrame(step);
 }
 // Every sheet reads with the same native overflow scrolling as the article.
 // A passive observer hands excess top-boundary movement to the card;
 // native scrollTop and reading-fling physics are never synthesized.
 function sheetInput(record){
  const panel=record.panel,body=()=>panel.querySelector('.secondary-body,.sheet-body,.translation-form-body,.theme-stage,.guide-content,.translation-tools-body,.translation-language-list,.toc-scroll')||panel;let touch=null,native=false,watching=false,destroyed=false;
  const touchPoint=(e,end=false)=>Array.from(end?e.changedTouches:e.touches||[]).find(t=>t.identifier===touch?.id);
  function watch(){const needed=!destroyed&&(!native&&((body()?.scrollTop||0)<=.5||!!touch)||!!touch?.owned&&!touch.nativeOwned);if(needed===watching)return;watching=needed;if(needed)panel.addEventListener('touchmove',move,{capture:true,passive:false});else panel.removeEventListener('touchmove',move,true);}
  function claim(target){beginSheet({target,button:0,isPrimary:true,pointerType:'touch',pointerId:record.sheetPointer,clientX:touch.x,clientY:touch.y,sampleTime:touch.nativeOwned?touch.lastTime:touch.time,nativePull:true});touch.owned=!!sheetDrag;}
  function cancel(){if(sheetDrag?.record===record&&sheetDrag.touchOwned)finishSheet({pointerId:sheetDrag.id,type:'gestureabort',nativePull:true});touch=null;native=false;watch();}
  function start(e){
   if(sheetOwner()!==record)return;if(e.touches.length!==1){cancel();return;}cancel();if(e.target.closest?.('.sheet-handle,input[type=color],input[type=file],select')||sheetHasSelection(panel))return;
   const t=e.touches[0],displaced=!record.entering&&Math.abs(offsetY(getComputedStyle(panel).transform))>.1;
   const scrollers=scrollChain(e.target,panel);native=scrollers.some(s=>s.el.scrollTop>.5)&&!displaced;
   touch={id:t.identifier,x:t.clientX,y:t.clientY,lastX:t.clientX,lastY:t.clientY,time:performance.now(),lastTime:performance.now(),scrollers,target:e.target,editable:!e.target.matches?.('input[type=range]')&&!!e.target.closest?.('input,textarea,[contenteditable=true]'),owned:false};if(displaced)claim(e.target);watch();
  }
  // Native reading remains passive. At its top boundary, only the excess
  // downward movement drives the card. Reversing yields to native reading
  // while the card returns, without changing overflow or locking its scroller.
  function observe(e){
   if(!touch||sheetOwner()!==record||record.closing||!native)return;if(e.touches.length!==1){cancel();return;}const t=touchPoint(e);if(!t)return;
   if(!touch.owned&&t.clientY>touch.lastY&&touch.scrollers.length&&touch.scrollers.every(s=>s.el.scrollTop<=.5)){
    touch.x=touch.lastX;touch.y=touch.lastY;touch.nativeOwned=true;claim(touch.target);
   }
   if(touch.owned&&touch.nativeOwned){moveSheet({pointerId:record.sheetPointer,clientX:t.clientX,clientY:t.clientY,nativePull:true,preventDefault(){}});if(sheetDrag&&t.clientY<touch.lastY){finishSheet({pointerId:record.sheetPointer,type:'gestureabort',nativePull:true});touch.owned=false;touch.nativeOwned=false;}}
   touch.lastX=t.clientX;touch.lastY=t.clientY;touch.lastTime=performance.now();
  }
  function move(e){
   if(!touch||sheetOwner()!==record||record.closing||touch.nativeOwned)return;
   if(e.touches.length!==1){cancel();return;}const t=touchPoint(e);if(!t){cancel();return;}
   if(!touch.owned){
    const dx=t.clientX-touch.x,dy=t.clientY-touch.y;if(touch.editable){if(Math.hypot(dx,dy)<12)return;if(performance.now()-touch.time>450||sheetHasSelection(panel)||Math.abs(dx)>Math.abs(dy)){touch=null;native=true;watch();return;}}
    // An upward/sideways beginning belongs entirely to native scrolling.
    // A noncancelable event means the browser already owns this stroke.
    if(dy<=0||Math.abs(dx)>dy*1.2||!e.cancelable){native=true;watch();return;}
    claim(touch.target);
   }
   if(!touch?.owned)return;if(e.cancelable)e.preventDefault();moveSheet({pointerId:record.sheetPointer,clientX:t.clientX,clientY:t.clientY,nativePull:true,preventDefault(){}});
  }
  function end(e){if(touch){const t=touchPoint(e,true);if(!t)return;if(touch.owned)finishSheet({pointerId:record.sheetPointer,type:e.type==='touchend'?'pointerup':'gestureabort',clientX:t.clientX,clientY:t.clientY,nativePull:true});}touch=null;native=false;watch();}
  function scroll(e){if(e.target===body())watch();}
  panel.addEventListener('touchstart',start,{capture:true,passive:true});panel.addEventListener('touchmove',observe,{capture:true,passive:true});panel.addEventListener('touchend',end,{capture:true,passive:true});panel.addEventListener('touchcancel',end,{capture:true,passive:true});panel.addEventListener('scroll',scroll,{capture:true,passive:true});watch();
  return {cancel,refresh:watch,destroy(){destroyed=true;touch=null;native=false;watch();panel.removeEventListener('touchstart',start,true);panel.removeEventListener('touchmove',observe,true);panel.removeEventListener('touchend',end,true);panel.removeEventListener('touchcancel',end,true);panel.removeEventListener('scroll',scroll,true);}};
 }
 // Suppress the native range's eager pointer-down jump. Vertical touch remains
 // native pan-y; horizontal input and taps reuse the ordinary input/change path.
 // A non-native hit surface prevents Chromium/WebView's range touchstart
 // default from changing the value before direction lock. The real input
 // remains focusable and supplies keyboard/accessibility semantics.
 function rangeInput(target){return target?.matches?.('input[type=range]')?target:target?.closest?.('.range-touch')?.querySelector('input[type=range]');}
 function prepareRanges(root){for(const el of [...(root.matches?.('input[type=range]')?[root]:[]),...root.querySelectorAll?.('input[type=range]')||[]]){if(el.parentElement?.classList.contains('range-touch'))continue;const hit=document.createElement('div');hit.className='range-touch';el.before(hit);hit.append(el);}}
 new MutationObserver(list=>{for(const mutation of list)for(const node of mutation.addedNodes)if(node.nodeType===1)prepareRanges(node);}).observe(document.documentElement,{childList:true,subtree:true});prepareRanges(document);
 let rangeTouch=null;
 function rangeValue(d,x,tap=false){
  const el=d.el,r=el.getBoundingClientRect(),min=Number(el.min)||0,max=el.max===''?100:Number(el.max),step=el.step==='any'?0:Number(el.step)||1,pad=el.closest('.glass-range')?12:8,width=Math.max(1,r.width-pad*2),rtl=getComputedStyle(el).direction==='rtl',fraction=tap?(x-r.left-pad)/width:(x-d.x)/width;
  let value=tap?min+(max-min)*(rtl?1-fraction:fraction):Number(d.value)+(max-min)*fraction*(rtl?-1:1);if(step)value=min+Math.round((value-min)/step)*step;
  const before=el.value;el.value=String(clamp(value,min,max));if(el.value!==before){d.changed=true;el.dispatchEvent(new Event('input',{bubbles:true}));}
 }
 function rangeEnd(e){const d=rangeTouch;if(!d||e.pointerId!==d.id)return;rangeTouch=null;if(e.type==='pointerup'&&d.axis!=='y'&&d.el.isConnected){if(d.axis==='x')rangeValue(d,e.clientX);else rangeValue(d,e.clientX,true);if(d.changed)d.el.dispatchEvent(new Event('change',{bubbles:true}));}if(d.el.hasPointerCapture?.(d.id))d.el.releasePointerCapture(d.id);}
 document.addEventListener('pointerdown',e=>{const el=rangeInput(e.target);if(!el||el.disabled||e.button>0)return;if(e.isPrimary===false){rangeTouch=null;return;}rangeTouch={el,id:e.pointerId,x:e.clientX,y:e.clientY,value:el.value,axis:null,changed:false};e.preventDefault();el.focus({preventScroll:true});},{capture:true,passive:false});
 document.addEventListener('pointermove',e=>{const d=rangeTouch;if(!d||e.pointerId!==d.id||!d.el.isConnected)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(!d.axis){if(Math.hypot(dx,dy)<10)return;if(Math.abs(dx)>Math.abs(dy)*1.2){d.axis='x';onGesture(e.pointerId);try{d.el.setPointerCapture(d.id);}catch{}}else if(Math.abs(dy)>Math.abs(dx)*1.2)d.axis='y';else return;}if(d.axis==='x'){e.preventDefault();rangeValue(d,e.clientX);}},{capture:true,passive:false});
 for(const type of ['pointerup','pointercancel'])document.addEventListener(type,rangeEnd,{capture:true,passive:true});
 window.addEventListener('pagehide',()=>{rangeTouch=null;});
 function refreshGuide(panel){if(overlay?.panel===panel)overlay.sheetInput?.refresh();}
 function beginSheet(e){
  const record=sheetOwner();
  if(e.pointerType==='touch'&&e.isPrimary===false){if(sheetDrag)finishSheet({pointerId:sheetDrag.id,type:'gestureabort'});return;}
  sheetClickBlock=null;if(sheetDrag)finishSheet({pointerId:sheetDrag.id,type:'gestureabort'});
  if(e.button>0||e.isPrimary===false||!record||record.kind!=='sheet'||!record.panel.contains(e.target))return;
  const wasClosing=record.closing;if(wasClosing)interruptSheetClose(record);
  stopMomentum();const guide=record.panel.classList.contains('guide-sheet'),handle=!!e.target.closest?.('.sheet-handle');if(!handle&&((!e.nativePull&&(e.target.closest?.('.range-touch,input[type=range],input[type=color],select')||e.pointerType!=='touch'&&e.target.closest?.('input,textarea,[contenteditable=true]')))||!guide&&sheetHasSelection(record.panel)))return;
  // Guide text is instructional, not an editor. A stale selection must not
  // leave its custom scroll owner disabled for the entire touch stream.
  if(guide&&sheetHasSelection(record.panel))window.getSelection()?.removeAllRanges();
  const panel=record.panel,start=offsetY(getComputedStyle(panel).transform),time=Number.isFinite(e.sampleTime)?e.sampleTime:performance.now();
  if(!handle&&!e.nativePull&&e.pointerType==='touch'){
   // Entrance motion has no inline pull displacement. Settle it so reading
   // can start immediately; an interrupted close/rebound keeps its position.
   if(!panel.style.transform)cancel(panel);
   record.sheetPointer=e.pointerId;return;
  }
  const active=handle||wasClosing||Math.abs(start)>.1;sheetDrag={record:record,id:e.pointerId,x:e.clientX,y:e.clientY,lastY:e.clientY,time,start,delta:0,distance:start,velocity:0,scrollVelocity:0,scrollDistance:0,samples:[{time,distance:start,scroll:0}],guide,touchOwned:!!e.nativePull,handle,active,scrollers:e.nativePull||handle?[]:scrollChain(e.target,panel),target:panel};
  if(active){if(e.nativePull){onGesture(e.pointerId);sheetClickBlock={id:e.pointerId,panel,until:time+600};releasePress();}cancel(panel);panel.style.transform=`translate3d(0,${start}px,0)`;try{panel.setPointerCapture?.(e.pointerId);}catch{}}
 }
 function moveSheet(e){
  const d=sheetDrag;if(!d||d.id!==e.pointerId||sheetOwner()!==d.record||d.touchOwned&&!e.nativePull)return;const now=performance.now(),dx=e.clientX-d.x,dy=e.clientY-d.y;
  if(!d.active){
   if(d.guide){
    // This card has no horizontal gesture. Keep the candidate through finger
    // drift so a quick stroke can still turn into vertical scrolling.
    if(Math.abs(dy)<=10)return;
   }else{if(sheetHasSelection(d.record.panel)){sheetDrag=null;return;}if(Math.hypot(dx,dy)<=10)return;if(Math.abs(dx)>Math.abs(dy)*1.2){sheetDrag=null;return;}if(Math.abs(dy)<Math.abs(dx)*1.2)return;}
   d.active=true;d.start=d.distance=offsetY(getComputedStyle(d.record.panel).transform);cancel(d.record.panel);try{d.record.panel.setPointerCapture?.(e.pointerId);}catch{}
  }
  e.preventDefault();onGesture(e.pointerId);sheetClickBlock={id:d.id,panel:d.record.panel,until:now+600};releasePress();const before=d.distance;let delta=e.clientY-d.lastY,scrolled=0;d.delta=dy;
  if(d.handle)d.distance=Math.max(-24,d.start+dy/(dy<0?3:1));
  else {if(delta<0&&d.distance>0){const used=Math.min(d.distance,-delta);d.distance-=used;delta+=used;}if(delta!==0){scrolled=scrollByChain(d.scrollers,-delta);delta+=scrolled;if(delta>0)d.distance+=delta;}}
  const direction=Math.sign(scrolled||d.distance-before);if(direction&&d.direction&&direction!==d.direction)d.samples=[{time:d.time,distance:before,scroll:d.scrollDistance}];if(direction)d.direction=direction;
  d.scrollDistance+=scrolled;d.samples.push({time:now,distance:d.distance,scroll:d.scrollDistance});while(d.samples.length>2&&d.samples[1].time<now-80)d.samples.shift();const first=d.samples[0],span=Math.max(8,now-first.time);
  d.velocity=(d.distance-first.distance)/span;d.scrollVelocity=(d.scrollDistance-first.scroll)/span;if(direction)d.lastMotionTime=now;d.lastY=e.clientY;d.time=now;d.record.panel.style.transform=`translate3d(0,${d.distance}px,0)`;
 }
 function finishSheet(e){
  const d=sheetDrag;if(!d||d.id!==e.pointerId||d.touchOwned&&!e.nativePull&&e.type!=='gestureabort')return;if(e.type==='pointerup'&&Number.isFinite(e.clientY)&&e.clientY!==d.lastY)moveSheet({pointerId:e.pointerId,clientX:e.clientX,clientY:e.clientY,nativePull:e.nativePull,preventDefault(){}});sheetDrag=null;if(sheetOwner()!==d.record||!d.active)return;
  const panel=d.record.panel,cancelled=e.type!=='pointerup',fresh=performance.now()-(d.lastMotionTime??d.time)<100,velocity=fresh?d.velocity:0,pull=Math.max(0,d.distance-Math.max(0,d.start)),room=Math.max(0,innerHeight-d.y),limit=Math.min(120,Math.max(64,panel.getBoundingClientRect().height*.2),Math.max(16,room*.45));
  // Android WebView can cancel a touch stream when scroll ownership changes.
  // Once a clear downward pull has crossed the dismissal threshold, finish it
  // as a release instead of snapping the sheet back under the user's finger.
  const dismiss=(!cancelled||e.type==='pointercancel')&&pull>limit||!cancelled&&fresh&&pull>24&&velocity>.6;
  if(dismiss){d.record.releaseVelocity=Math.max(0,velocity);onDismiss();return;}
  if(Math.abs(d.distance)<.1){panel.style.removeProperty('transform');if(!d.touchOwned&&d.scrollers.length&&!cancelled&&fresh)coast(d.record,d.scrollers,d.scrollVelocity);return;}
  const result=animate(panel,spring(d.distance,0,velocity*10,600,38,timing.sheetRebound).map(p=>({transform:`translate3d(0,${p.value}px,0)`,offset:p.offset})),{duration:timing.sheetRebound});
  if(result)result.done.then(completed=>{if(completed)panel.style.removeProperty('transform');});else panel.style.removeProperty('transform');
 }
 document.addEventListener('pointerdown',beginSheet,{passive:true});document.addEventListener('pointermove',moveSheet,{passive:false});
 document.addEventListener('pointerup',finishSheet,{passive:true});document.addEventListener('pointercancel',finishSheet,{passive:true});
 document.addEventListener('click',e=>{const block=sheetClickBlock;if(block&&performance.now()<=block.until&&e.detail>0&&(e.pointerId===block.id||block.panel.contains(e.target))){e.preventDefault();e.stopImmediatePropagation();sheetClickBlock=null;}},true);
 document.addEventListener('wheel',e=>{if(overlay?.panel.contains(e.target))stopMomentum();},{passive:true});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&overlay){e.preventDefault();onDismiss();}});
 function scene(update,{direction=1,source=null,kind='tab',reverse=false,interactive=false}={}){
  const id=++sceneId,root=document.querySelector('#app'),old=root?.firstElementChild;
  if(sceneExit){running.delete(sceneExit.animation);sceneExit.animation.cancel();sceneExit=null;}
  const enter=()=>{if(id!==sceneId)return;update();const el=root.firstElementChild;if(!el)return;setInert(el,false);
   const b=rect(source?.el)||source?.box;if(b)el.style.transformOrigin=`${b.x}px ${b.y}px`;
   const start=kind==='book'?'scale(.94)':`translate3d(${direction*26}px,0,0)`;
   const result=animate(el,[{transform:start,opacity:.25},{transform:kind==='book'?'scale(1)':'translate3d(0,0,0)',opacity:1}],{duration:kind==='book'?timing.bookIn:timing.tabIn,easing:'cubic-bezier(.18,.85,.25,1)'});
   result?.done.then(()=>el.style.removeProperty('transform-origin'));
  };
  if(!available(old)){enter();return Promise.resolve();}
  setInert(old,!interactive);const b=rect(source?.el)||source?.box;if(b)old.style.transformOrigin=`${b.x}px ${b.y}px`;
  const end=kind==='book'&&reverse?'scale(.94)':`translate3d(${-direction*(kind==='chapter'?Math.min(innerWidth*.35,160):18)}px,0,0)`;
  sceneExit=animate(old,[{transform:getComputedStyle(old).transform==='none'?'translate3d(0,0,0)':getComputedStyle(old).transform,opacity:1},{transform:end,opacity:0}],{duration:kind==='book'?timing.bookOut:timing.tabOut,easing:'cubic-bezier(.4,0,1,1)'});
  if(kind==='chapter')old.style.removeProperty('transform');
  return (sceneExit?.done||Promise.resolve()).then(()=>{if(id!==sceneId)return;sceneExit=null;enter();});
 }
 function cancelScene(){if(!sceneExit)return false;sceneId++;running.delete(sceneExit.animation);sceneExit.animation.cancel();sceneExit=null;const el=document.querySelector('#app')?.firstElementChild;if(el){setInert(el,false);cancel(el);el.style.removeProperty('transform-origin');}return true;}
 function stopCapsule(nav){const el=nav.querySelector('.dock-selection');if(!el)return;const raw=getComputedStyle(el).transform,values=raw.match(/^matrix\(([^)]+)\)/)?.[1].split(',').map(Number),cell=(nav.getBoundingClientRect().width-(nav.matches('.main-dock')?12:10))/Math.max(1,[...nav.children].filter(el=>el.tagName==='BUTTON').length);if(values&&cell>0)nav.style.setProperty('--dock-index',clamp(values[4]/cell,0,3));cancel(el);}
 function capsule(nav,from,to,velocity=0,stretch=1){
  const el=nav.querySelector('.dock-selection');if(!el||from===to&&stretch===1)return;
  const frames=spring(from,to,velocity,520,36,timing.capsule).map(p=>{const tail=1-p.offset;return {transform:`translate3d(${p.value*100}%,0,0) scale(${1+(stretch-1)*tail},${1-(stretch-1)*.4*tail})`,offset:p.offset};});
  animate(el,frames,{duration:timing.capsule});
 }
 const chromeRecords=new WeakMap();
 function chrome(el,hidden,{edge='bottom',mount=false}={}){
  if(!el)return;const prior=chromeRecords.get(el),raw=getComputedStyle(el).transform,match=raw.match(/^matrix(3d)?\(([^)]+)\)/),values=match?.[2].split(',').map(Number);let from=values?(values[match[1]?13:5]||0):0;
  const rect=el.getBoundingClientRect(),distance=edge==='top'?-(rect.bottom-from+16):innerHeight-(rect.top-from)+16,to=hidden?distance:0;
  if(prior?.hidden===hidden&&Math.abs(prior.to-to)<.5&&!mount)return prior.done;
  let velocity=0;if(prior?.animation){const time=Number(prior.animation.currentTime)||0,t=clamp(time/prior.duration,0,1),frames=prior.frames;let i=1;while(i<frames.length-1&&frames[i].offset<t)i++;const left=frames[i-1],right=frames[i];if(t<1)velocity=(right.value-left.value)/Math.max(.001,(right.offset-left.offset)*prior.duration/1000);}
  cancel(el);if(mount&&!hidden)from=distance;el.classList.toggle('chrome-hidden',hidden);el.style.transform=`translate3d(0,${to}px,0)`;el.style.visibility='visible';
  const duration=hidden?250:340,record={hidden,to,duration,frames:[],animation:null};chromeRecords.set(el,record);
  const finish=()=>{if(chromeRecords.get(el)!==record)return;record.animation=null;el.style.removeProperty('visibility');};
  if(reduced()||document.hidden||(!prior&&hidden&&!mount)||Math.abs(from-to)<.2){finish();return;}
  const frames=spring(0,1,Math.abs(to-from)>.01?velocity/(to-from):0,hidden?650:520,hidden?42:34,duration,80).map(p=>({offset:p.offset,value:from+(to-from)*p.value}));record.frames=frames;
  const motion=animate(el,frames.map(p=>({offset:p.offset,transform:`translate3d(0,${p.value}px,0)`})),{duration});if(motion){record.animation=motion.animation;record.done=motion.done.then(finish);return record.done;}else finish();
 }
 function mountedDock(el){chrome(el,false,{mount:true});}

 let modalViewportWidth=innerWidth;
 function fitModalViewport(){const v=window.visualViewport,style=document.documentElement.style;for(const [key,value] of Object.entries({height:v?.height||innerHeight,width:v?.width||innerWidth,top:v?.offsetTop||0,left:v?.offsetLeft||0}))style.setProperty('--modal-viewport-'+key,value+'px');const width=v?.width||innerWidth;if(Math.abs(width-modalViewportWidth)>2){const chain=[];for(let r=overlay;r?.parent;r=r.parent)if(r.parentState?.frozen){thawParent(r.parentState.frozen);chain.push(r);}for(const r of chain.reverse())r.parentState.frozen=freezeParent(r.parent);}modalViewportWidth=width;}
 fitModalViewport();window.addEventListener('resize',fitModalViewport,{passive:true});window.visualViewport?.addEventListener('resize',fitModalViewport,{passive:true});window.visualViewport?.addEventListener('scroll',fitModalViewport,{passive:true});
 function resetGestures(){rangeTouch=null;stopMomentum();sheetOwner()?.sheetInput?.cancel();if(sheetDrag)finishSheet({pointerId:sheetDrag.id,type:'gestureabort'});sheetClickBlock=null;releasePress();}
 function refresh(){if(!reduced())return;if(overlay?.kind==='image'&&overlay.imageFrame){const r=overlay;imageStop(r);imageRun(r,r.closing);}stopMomentum();releasePress();for(const animation of running)animation.finish();}
 document.addEventListener('visibilitychange',()=>{if(document.hidden){rangeTouch=null;stopMomentum();sheetOwner()?.sheetInput?.cancel();if(sheetDrag)finishSheet({pointerId:sheetDrag.id,type:'gestureabort'});sheetClickBlock=null;releasePress();for(const animation of running)animation.finish();}});
 window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change',refresh);
 return {rangeInput,imageResume(){const r=overlay;if(r?.kind==='image'){imageStop(r);return imageRun(r,false);}},imageGrab,imageGesturePose,imageReset,configure,setInert,reduced,origin,mark,take,rect,reveal,cards,removeInline,animate,spring,cancel,releasePress,currentOverlay,present,dismiss,scene,cancelScene,capsule,stopCapsule,mountedDock,chrome,refresh,refreshGuide,resetGestures};
})();
