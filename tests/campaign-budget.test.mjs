import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignBudget } from '../js/campaigns/campaign-budget.js';

function driver(step){let callback=null,calls=0;const win={requestAnimationFrame(fn){callback=fn;calls++;return calls;},cancelAnimationFrame(){callback=null;}};
  return {win,run(){for(let time=0;callback&&time<10000;time+=step){const next=callback;callback=null;next(time);}},calls:()=>calls};}
test('healthy compositor uses one bounded probe and keeps animation',()=>{
  const d=driver(16.7);let limited=0;const budget=createCampaignBudget(d.win,()=>true,()=>limited++);
  budget.check();d.run();budget.check();assert.equal(limited,0);assert.equal(d.calls(),11);
});
test('sustained slow frames return to static composition once',()=>{
  const d=driver(80);let limited=0;const budget=createCampaignBudget(d.win,()=>true,()=>limited++);
  budget.check();d.run();budget.check();assert.equal(limited,1);assert.equal(d.calls(),11);
});
test('inactive campaigns and teardown never leave a sampling loop',()=>{
  const d=driver(80);let live=false;const budget=createCampaignBudget(d.win,()=>live,()=>assert.fail());
  budget.check();assert.equal(d.calls(),0);live=true;budget.check();budget.destroy();d.run();assert.equal(d.calls(),1);
});
