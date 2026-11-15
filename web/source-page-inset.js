/* A document-space buffer scrolls away underneath the native translucent toolbar.
 * Runs only at page commit/finish and viewport layout changes, never per scroll. */
((headerPx,viewWidth,layers)=>{
 const body=document.body,root=document.documentElement;if(!body||viewWidth<=0)return;
 const height=Math.round(headerPx*innerWidth/viewWidth*100)/100;
 // Keep the backdrop in the website's own rendering surface; another WebView
 // cannot sample this content with CSS backdrop-filter.
 let edge=document.getElementById('transread-source-edge');
 if(!edge){
  edge=document.createElement('div');edge.id='transread-source-edge';edge.setAttribute('aria-hidden','true');
  Object.assign(edge.style,{position:'fixed',top:'0',left:'0',right:'0',zIndex:'2147483647',pointerEvents:'none',background:'transparent'});
  for(const layer of layers){
   const pane=document.createElement('span'),radius=layer.blur*innerWidth/viewWidth*devicePixelRatio;
   const mask=`linear-gradient(to bottom,#000 0%,#000 ${layer.solid*100}%,transparent ${layer.clear*100}%,transparent 100%)`;
   Object.assign(pane.style,{position:'absolute',inset:'0',pointerEvents:'none',background:'transparent',backdropFilter:`blur(${radius}px)`,webkitBackdropFilter:`blur(${radius}px)`,maskImage:mask,webkitMaskImage:mask});edge.appendChild(pane);
  }
  root.appendChild(edge);
 }
 edge.style.height=(height+16*innerWidth/viewWidth*devicePixelRatio)+'px';
 // Update radii after viewport/orientation changes without installing a loop.
 [...edge.children].forEach((pane,i)=>{const blur=`blur(${layers[i].blur*innerWidth/viewWidth*devicePixelRatio}px)`;pane.style.backdropFilter=blur;pane.style.webkitBackdropFilter=blur;});
 const previous=Number(body.dataset.transreadInsetHeight)||0;
 if(body.dataset.transreadInsetBase===undefined)body.dataset.transreadInsetBase=String(parseFloat(getComputedStyle(body).paddingTop)||0);
 if(Math.abs(height-previous)<.01)return;
 const y=scrollY;
 body.style.setProperty('padding-top',(Number(body.dataset.transreadInsetBase)+height)+'px','important');
 root.style.setProperty('scroll-padding-top',height+'px');
 body.dataset.transreadInsetHeight=String(height);
 if(y>0)scrollTo(scrollX,Math.max(0,y+height-previous));
})(%HEADER_PX%,%VIEW_WIDTH%,%EDGE_LAYERS%);
