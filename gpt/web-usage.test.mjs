import test from 'node:test';
import assert from 'node:assert/strict';
import {usageSnapshot} from './web-usage.mjs';
const base={hosts:[{id:'own-host',status:'connected'}],gpt:{stale:false,buckets:[{id:'codex',plan:'pro',primary:{usedPercent:23,windowDurationMins:300,resetsAt:1800000000000}}]},claude:{stale:false,windows:[{title:'5 часов',used:41,resetsAt:1800000000000}]},quota:{subscription:{used:3,limit:10,percent:30,resetsAt:1800000000000}},claudeQuota:{daily:{used:100,limit:1000},weekly:{used:200,limit:null}}};
test('shared account and personal quota are distinct without owner identity',()=>{
 const result=usageSnapshot(base);const providers=result.machines[0].providers;
 assert.equal(providers[0].usage.windows[0].usedPercent,23);
 assert.equal(providers[1].usage.windows[0].usedPercent,30);
 assert.equal(providers[2].usage.windows[0].usedPercent,41);
 assert.equal(providers[3].usage.windows[0].usedPercent,10);
 assert.ok(providers.every(p=>p.usage.accountEmail===null));
});
test('missing usage stays unavailable and stale numbers are marked',()=>{
 const result=usageSnapshot({...base,gpt:{buckets:[]},claude:{stale:true,windows:[{title:'5 часов',used:41}]}});
 assert.equal(result.machines[0].providers[0].usage.status,'error');
 assert.match(result.machines[0].providers[2].usage.planLabel,/устарели/);
});
test('filters cannot expose another host; zero personal limit blocks without division by zero',()=>{
 assert.equal(usageSnapshot(base,{machineIds:['other-host']}).machines.length,0);
 const result=usageSnapshot({...base,quota:{subscription:{used:0,limit:0,percent:0}}},{providerId:'codex'});
 assert.equal(result.machines[0].providers.length,2);
 assert.equal(result.machines[0].providers[1].usage.windows[0].usedPercent,100);
});
