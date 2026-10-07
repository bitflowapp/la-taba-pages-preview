import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRiderMotion} from '../js/map/rider_motion.js';

test('presentation absorbs metre jitter but keeps the real measurement and freshness',()=>{
  let time=Date.now();
  const motion=createRiderMotion({now:()=>time,minTravelMeters:3,maxDurationMs:900});
  const fix=(lat,timestamp=time)=>({lat,lng:-68.05,source:'gps',timestamp,accuracy:20});
  const initial=fix(-38.946);
  motion.pushFix(initial);
  time+=2000;
  const jitter=fix(-38.94599);
  assert.equal(motion.pushFix(jitter).mode,'jitter');
  assert.equal(motion.isMoving(),false);
  assert.deepEqual(motion.visualPositionAt(),{lat:initial.lat,lng:initial.lng});
  assert.equal(motion.measuredPosition().lat,jitter.lat);
  time+=2000;
  const moved=fix(-38.9455);
  const update=motion.pushFix(moved);
  assert.equal(update.mode,'travel');assert.ok(update.durationMs<=900);
  assert.equal(motion.isMoving(),true);
  time+=1000;assert.equal(motion.isMoving(),false);assert.equal(motion.visualPositionAt().lat,moved.lat);
});

test('presentation never replays a delayed fix or a background route, even with smoothing enabled',()=>{
  let time=Date.now();const motion=createRiderMotion({now:()=>time,minTravelMeters:3,maxDurationMs:900});
  const fix=lat=>({lat,lng:-68.05,source:'gps',timestamp:time,accuracy:20});
  motion.pushFix(fix(-38.946));time+=2000;motion.pushFix(fix(-38.9457));
  motion.resume();time+=4000;
  assert.equal(motion.pushFix(fix(-38.9454)).mode,'instant');assert.equal(motion.isMoving(),false);
  assert.equal(motion.pushFix({...fix(-38.946),timestamp:time-6000}).accepted,false);
  assert.equal(motion.measuredPosition().lat,-38.9454);
});
