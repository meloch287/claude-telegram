import test from 'node:test';
import {request} from 'node:http';
import assert from 'node:assert/strict';
import {createWebAuth, WEB_COOKIE} from './web-auth.mjs';
import {createWebGateway} from './web-gateway.mjs';
test('usage requires the correct tenant session and checks access again after collection',async()=>{
 let access=true,calls=0;const allowed=()=>access;
 const auth=createWebAuth({domain:'example.test',allowed});
 auth.ensure(1);auth.ensure(2);
 const host='u1.example.test',token=auth.issue(1).split('#')[1],cookie=WEB_COOKIE+'='+auth.redeem(token,host);
 const gateway=createWebGateway({auth,allowed,runtime:{ensure:async()=> 'http://127.0.0.1:1'},usage:async(uid,target,filter)=>{calls++;assert.equal(uid,1);if(filter.providerId==='revoke')access=false;return{machines:[]}}});
 await new Promise(r=>gateway.server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${gateway.server.address().port}/api/v1/plugins/bb--provider-usage/rpc/getUsage`;
 const send=(headers={},body={})=>new Promise((resolve,reject)=>{const req=request(url,{method:'POST',headers:{host,origin:'https://'+host,'content-type':'application/json',...headers}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(text)}));});req.on('error',reject);req.end(JSON.stringify(body));});
 try{
  assert.equal((await send()).status,401);
  assert.equal((await send({cookie,host:'u2.example.test',origin:'https://u2.example.test'})).status,401);
  assert.equal((await send({cookie,origin:'https://evil.example'})).status,403);
  assert.equal(calls,0);
  assert.equal((await send({cookie},{machineIds:'all'})).status,400);
  const ok=await send({cookie},{uid:2,machineIds:null});assert.equal(ok.status,200);assert.deepEqual(await ok.json(),{ok:true,result:{machines:[]}});
  assert.equal((await send({cookie},{providerId:'revoke'})).status,403);
 }finally{gateway.server.closeAllConnections();await new Promise(r=>gateway.server.close(r));}
});
