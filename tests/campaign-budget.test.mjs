import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignBudget } from '../js/campaigns/campaign-budget.js';

function driver(step){let callback=null,timer=null,delay=null,calls=0;
  const win={requestAnimationFrame(fn){callback=fn;calls++;return calls;},cancelAnimationFrame(){callback=null;},
    setTimeout(fn,ms){timer=fn;delay=ms;return 1;},clearTimeout(){timer=null;}};
  return {win,run(){for(let time=0;callback&&time<10000;time+=step){const next=callback;callback=null;next(time);}},
    expire(){const next=timer;timer=null;next?.();},pending:()=>timer!==null,delay:()=>delay,calls:()=>calls};}
test('healthy compositor uses one bounded probe and keeps animation',()=>{
  const d=driver(16.7);let limited=0;const budget=createCampaignBudget(d.win,()=>true,()=>limited++);
  budget.check();d.run();budget.check();d.expire();assert.equal(limited,0);assert.equal(d.calls(),11);assert.equal(d.pending(),false);
});
test('sustained slow frames return to static composition once',()=>{
  const d=driver(80);let limited=0;const budget=createCampaignBudget(d.win,()=>true,()=>limited++);
  budget.check();d.run();budget.check();d.expire();assert.equal(limited,1);assert.equal(d.calls(),11);assert.equal(d.pending(),false);
});
test('inactive campaigns and teardown never leave a sampling loop',()=>{
  const d=driver(80);let live=false;const budget=createCampaignBudget(d.win,()=>live,()=>assert.fail());
  budget.check();assert.equal(d.calls(),0);assert.equal(d.pending(),false);live=true;budget.check();budget.destroy();d.run();d.expire();assert.equal(d.calls(),1);assert.equal(d.pending(),false);
});
test('a renderer that stops delivering frames gets a bounded static fallback',()=>{
  const d=driver(16.7);let limited=0;const budget=createCampaignBudget(d.win,()=>true,()=>limited++);
  budget.check();assert.equal(d.delay(),1200);assert.equal(d.pending(),true);
  d.expire();budget.check();d.run();d.expire();assert.equal(limited,1);assert.equal(d.calls(),1);assert.equal(d.pending(),false);
});
test('backgrounding before the deadline cancels the probe without disabling later healthy motion',()=>{
  const d=driver(16.7);let live=true,limited=0;const budget=createCampaignBudget(d.win,()=>live,()=>limited++);
  budget.check();live=false;d.expire();assert.equal(limited,0);assert.equal(d.pending(),false);
  live=true;budget.check();d.run();assert.equal(limited,0);assert.equal(d.calls(),12);assert.equal(d.pending(),false);
});
test('the fallback says why: slow frames measured or a renderer that stopped delivering them',()=>{
  const slow=driver(80);const reasons=[];createCampaignBudget(slow.win,()=>true,(reason)=>reasons.push(reason)).check();slow.run();
  const stalled=driver(16.7);createCampaignBudget(stalled.win,()=>true,(reason)=>reasons.push(reason)).check();stalled.expire();
  assert.deepEqual(reasons,['slow_frames','frame_stall']);
});
