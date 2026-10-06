// One bounded compositor-budget probe per controller/session, only while a
// campaign is live. No nodes or layout reads; a slow renderer gets the existing
// complete static composition instead of repeated animation jank.
export function createCampaignBudget(windowRef, isLive, limit) {
  let id=null, deadline=null, decided=false, destroyed=false, previous=null, samples=[];
  const cancel=()=>{
    if(id!==null)windowRef.cancelAnimationFrame?.(id);
    if(deadline!==null)windowRef.clearTimeout?.(deadline);
    id=null;deadline=null;
  };
  const finish=(slow,reason)=>{decided=true;cancel();if(slow)limit(reason);};
  const frame=now=>{
    id=null;
    if(destroyed||!isLive()){cancel();previous=null;samples=[];return;}
    if(previous!==null)samples.push(now-previous);
    previous=now;
    if(samples.length>=10){
      const measured=samples.slice(2);
      const average=measured.reduce((a,b)=>a+b,0)/measured.length;
      finish(average>45&&measured.filter(ms=>ms>50).length>=4,'slow_frames');
      return;
    }
    id=windowRef.requestAnimationFrame(frame);
  };
  return {
    check(){
      if(decided||destroyed||id!==null||!isLive()||!windowRef.requestAnimationFrame)return;
      id=windowRef.requestAnimationFrame(frame);
      // Some software renderers stop delivering frames while JS still runs.
      // One wall-clock deadline bounds that probe too; it is never a loop.
      if(!decided&&deadline===null&&windowRef.setTimeout)deadline=windowRef.setTimeout(()=>{
        deadline=null;
        if(destroyed||decided)return;
        if(!isLive()){cancel();previous=null;samples=[];return;}
        // The renderer delivered no frames for 1,2 s: it is starved, not slow.
        finish(true,'frame_stall');
      },1200);
    },
    destroy(){destroyed=true;cancel();},
  };
}
