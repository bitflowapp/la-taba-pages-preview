/* Maps embedded in a scrollable order: horizontal/diagonal drags explore,
 * vertical intent scrolls the page anywhere on the canvas, pinch zooms.
 * Never preventDefault for a page gesture. Direction locks once per gesture.
 * The native MapLibre handlers still implement pan/zoom; no synthetic camera. */
export function bindMapTouchIntent(container, map) {
  if (!container?.addEventListener) return () => {};
  const surface=map?.getCanvasContainer?.() || container;
  const previous=surface.style?.touchAction;
  const canvas=map?.getCanvas?.();
  const canvasPrevious=canvas?.style?.touchAction;
  if(surface.style)surface.style.touchAction='pan-y';
  if(canvas?.style)canvas.style.touchAction='pan-y';
  let start=null;
  let intent='';
  let suppressUntil=0;
  const time=()=>Date.now();
  const startGesture=event=>{
    suppressUntil=0;
    if(event.touches.length>1){intent='map';return;}
    const touch=event.touches[0];
    start=touch?{x:touch.clientX,y:touch.clientY}:null;
    intent='';
  };
  const move=event=>{
    if(!start || event.touches.length!==1){if(event.touches.length>1)intent='map';return;}
    const touch=event.touches[0];
    const dx=Math.abs(touch.clientX-start.x),dy=Math.abs(touch.clientY-start.y);
    if(!intent && Math.max(dx,dy)>7)intent=dy>dx*1.2?'page':'map';
    if(!intent || intent==='page'){
      // Prevent the vendor touchmove from cancelling the browser's pan-y.
      // Also hold tiny undecided moves: a slow vertical gesture must not let
      // the vendor claim the drag before its direction becomes clear.
      // Keep the event's native default so Safari/Chromium scroll normally.
      event.stopImmediatePropagation();
    }
  };
  const end=()=>{if(intent)suppressUntil=time()+350;start=null;intent='';};
  const click=event=>{
    if(event.detail!==0 && time()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();suppressUntil=0;}
  };
  container.addEventListener('touchstart',startGesture,{capture:true,passive:true});
  container.addEventListener('touchmove',move,{capture:true,passive:true});
  container.addEventListener('touchend',end,{capture:true,passive:true});
  container.addEventListener('touchcancel',end,{capture:true,passive:true});
  container.addEventListener('click',click,true);
  return()=>{
    container.removeEventListener('touchstart',startGesture,true);
    container.removeEventListener('touchmove',move,true);
    container.removeEventListener('touchend',end,true);
    container.removeEventListener('touchcancel',end,true);
    container.removeEventListener('click',click,true);
    if(surface.style)surface.style.touchAction=previous||'';
    if(canvas?.style)canvas.style.touchAction=canvasPrevious||'';
  };
}
