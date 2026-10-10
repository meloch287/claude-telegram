import {webkit} from 'playwright-core';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../src/miniapp/public/',import.meta.url);
const user={id:445821298,name:'Пользователь с длинным именем',allowed:true,owner:false,tokensToday:15600,tokenLimit:null,dialogs:3,dialogLimit:5,quota:{subscription:{used:3.2,limit:10,percent:32},exceeded:false},claude:{daily:{used:100000,limit:1000000},weekly:{used:1500000,limit:5000000}}};
const usage={stale:false,windows:[{title:'5 часов',used:18,resetsAt:Date.now()+3600000},{title:'Неделя',used:37,resetsAt:Date.now()+86400000}]};
const accounting={subscription:{stale:false,buckets:[{id:'codex',plan:'pro',primary:{usedPercent:12,remainingPercent:88,windowDurationMins:300}}]},today:{units:100,cachePercent:80,models:[]},week:{units:1000},rates:[],days:[]};
await mkdir('output',{recursive:true});const browser=await webkit.launch();
try{for(const width of [320,390,768,1280])for(const theme of ['light','dark']){
 const ctx=await browser.newContext({viewport:{width,height:844},colorScheme:theme});
 await ctx.addInitScript(({theme})=>{window.Telegram={WebApp:{initData:'fixture',initDataUnsafe:{user:{id:1057399602}},colorScheme:theme,ready(){},expand(){},onEvent(){},isVersionAtLeast(){return false}}};},{theme});
 const posts=[];
 await ctx.route('https://admin.test/**',async route=>{const url=new URL(route.request().url());let path=url.pathname;
 if(path==='/telegram-web-app.js')return route.fulfill({body:'',contentType:'text/javascript'});
 if(path.startsWith('/api/')){
  let json=path.endsWith('admin/users')?{users:[user]}:path.endsWith('admin/accounting')?accounting:path.endsWith('claude-admin')?{usage,users:[]}:{};
  if(path.endsWith('admin/user')){posts.push(route.request().postDataJSON());json={ok:true};}
  return route.fulfill({json});
 }
 const body=await readFile(new URL(path.slice(1),root));return route.fulfill({body,contentType:path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'text/javascript'});
 });
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://admin.test/claude-admin.html?engine=claude#launch-data');
 await page.waitForURL('**/chats.html?**');assert.ok(page.url().endsWith('#launch-data'));
 await page.locator('#claude-accounting .account-card').waitFor();
 assert.match(await page.locator('#accounting').innerText(),/88%/);assert.match(await page.locator('#claude-accounting').innerText(),/82%/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-boot'));
 await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))});
 await page.screenshot({path:`output/unified-${width}-${theme}.png`,fullPage:true});
 await page.locator('.user-row').click();await page.locator('#limits-claude').click();
 await page.locator('#claude-daily').fill('2000000');await page.locator('#user-save').click();
 await page.waitForFunction(()=>!document.querySelector('#user-detail').open);
 assert.equal(posts[0].claude.daily,2000000);
 await page.locator('.user-row').click();await page.locator('#limits-gpt').click();
 assert.equal(await page.locator('#user-percent').inputValue(),'10');
 assert.equal(await page.locator('#user-detail').evaluate(n=>n.scrollWidth>n.clientWidth+1),false);
 await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))});
 await page.screenshot({path:`output/unified-user-${width}-${theme}.png`});
 assert.deepEqual(errors,[]);console.log(width,theme,'OK');await ctx.close();
}}finally{await browser.close()}
