/* Local press state only. Native actions still use the two fixed links. */
(()=>{
 let press=null,blocked=false;
 const button=target=>target.closest?.('.source-button');
 function release(cancel=false){if(press)delete press.el.dataset.pressed;press=null;blocked=cancel;}
 document.addEventListener('pointerdown',e=>{
  if(e.isPrimary===false){release(true);return;}
  release();const el=button(e.target);if(!el||e.button>0)return;
  press={el,id:e.pointerId,x:e.clientX,y:e.clientY};el.dataset.pressed='true';
 },{passive:true});
 document.addEventListener('pointermove',e=>{if(press?.id===e.pointerId&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>10)release(true);},{passive:true});
 document.addEventListener('pointerup',e=>{if(press?.id===e.pointerId)release(Math.hypot(e.clientX-press.x,e.clientY-press.y)>10);},{passive:true});
 document.addEventListener('pointercancel',()=>release(true),{passive:true});
 document.addEventListener('click',e=>{if(button(e.target)&&blocked&&e.detail>0)e.preventDefault();},true);
 document.addEventListener('keydown',e=>{
  const el=button(e.target);if(!el||e.repeat||!['Enter',' '].includes(e.key))return;
  if(e.key===' ')e.preventDefault();release();press={el,key:e.key};el.dataset.pressed='true';
 });
 document.addEventListener('keyup',e=>{if(press?.key!==e.key)return;const el=press.el;release();if(e.key===' '){e.preventDefault();el.click();}});
 window.addEventListener('blur',()=>release(true));window.addEventListener('pagehide',()=>release(true));
})();
