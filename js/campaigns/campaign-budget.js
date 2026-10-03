// One bounded compositor-budget probe per controller/session, only while a
// campaign is live. No nodes or layout reads; a slow renderer gets the existing
// complete static composition instead of repeated animation jank.
export function createCampaignBudget(windowRef, isLive, limit) {
  let id=null, decided=false, destroyed=false, previous=null, samples=[];
  const cancel=()=>{if(id!==null)windowRef.cancelAnimationFrame?.(id);id=null;};
  const frame=now=>{
    id=null;
    if(destroyed||!isLive()){previous=null;samples=[];return;}
    if(previous!==null)samples.push(now-previous);
    previous=now;
    if(samples.length>=10){
      decided=true;
      const measured=samples.slice(2);
      const average=measured.reduce((a,b)=>a+b,0)/measured.length;
      if(average>45&&measured.filter(ms=>ms>50).length>=4)limit();
      return;
    }
    id=windowRef.requestAnimationFrame(frame);
  };
  return {
    check(){if(!decided&&!destroyed&&id===null&&isLive()&&windowRef.requestAnimationFrame)id=windowRef.requestAnimationFrame(frame);},
    destroy(){destroyed=true;cancel();},
  };
}
