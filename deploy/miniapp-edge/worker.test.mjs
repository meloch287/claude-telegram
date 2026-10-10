import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relay } from './worker.mjs';

test('HTTP cannot relay private requests without TLS', async () => {
 const response=await relay(new Request('http://miniapp.example/modes.html'),()=>{throw Error('must not run')});
 assert.equal(response.status,308);
 assert.equal(response.headers.get('location'),'https://miniapp.example/modes.html');
});

test('only the fixed origin is reachable; Telegram authentication stays in a header', async () => {
 const request = new Request('https://miniapp.example//other.example/api/state?q=a', {headers:{'x-telegram-init-data':'signed-test-data','x-bot-engine':'gpt','authorization':'must-not-forward'}});
 const response = await relay(request, async (url, options) => {
  assert.equal(new URL(url).host,'aiapp.200-165-236-8.sslip.io');
  assert.equal(options.headers.get('x-telegram-init-data'),'signed-test-data');
  assert.equal(options.headers.get('x-bot-engine'),'gpt');
  assert.equal(options.headers.has('authorization'),false);
  assert.equal(url.includes('signed-test-data'),false);
  return new Response('{"ok":true}',{headers:{'content-type':'application/json'}});
 });
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(await response.text(),'{"ok":true}');
});
test('signed POST settings and errors pass through without bypassing origin access checks', async () => {
 const request=new Request('https://miniapp.example/api/preferences',{method:'POST',body:'{"model":"test"}',headers:{'content-type':'application/json'}});
 const response=await relay(request,async (url,options)=>{
  assert.equal(options.method,'POST');
  assert.equal(await new Response(options.body).text(),'{"model":"test"}');
  return new Response('Forbidden',{status:403});
 });
 assert.equal(response.status,403);
});
test('redirects stay on the reachable public entrance',async()=>{
 const response=await relay(new Request('https://miniapp.example/'),async()=>new Response(null,{status:302,headers:{location:'https://aiapp.200-165-236-8.sslip.io/modes.html?section=home'}}));
 assert.equal(response.headers.get('location'),'https://miniapp.example/modes.html?section=home');
});
test('unsupported methods and origin failure fail safely',async()=>{
 const rejected=await relay(new Request('https://miniapp.example/',{method:'PROPFIND'}),()=>{throw Error('must not run')});
 assert.equal(rejected.status,405);
 const unavailable=await relay(new Request('https://miniapp.example/'),async()=>{throw Error('private origin failure')});
 assert.equal(unavailable.status,503);
 assert.equal((await unavailable.text()).includes('private origin failure'),false);
});

test('world saves retain PUT body and DELETE query',async()=>{
 for(const method of ['PUT','DELETE']) {
  const request=new Request('https://miniapp.example/api/world-save?key=world1',{method,...(method==='PUT'?{body:'{"key":"world1","data":"test"}'}:{})});
  const response=await relay(request,async(url,options)=>{
   assert.equal(new URL(url).search,'?key=world1');assert.equal(options.method,method);
   if(method==='PUT')assert.equal(await new Response(options.body).text(),'{"key":"world1","data":"test"}');
   return new Response('{"ok":true}');
  });assert.equal(response.status,200);
 }
});
