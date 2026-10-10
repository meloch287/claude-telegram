import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {currentMiniappUrl} from '../src/miniapp-url.js';

test('Mini App follows a replaced tunnel URL without restarting the bot',()=>{
 const dir=mkdtempSync(join(tmpdir(),'miniapp-url-'));const file=join(dir,'url');const fallback='https://origin.example';
 try{
  assert.equal(currentMiniappUrl(fallback,file),fallback);
  writeFileSync(file,'https://first.trycloudflare.com\n');
  assert.equal(currentMiniappUrl(fallback,file),'https://first.trycloudflare.com');
  writeFileSync(file,'https://second.trycloudflare.com/');
  assert.equal(currentMiniappUrl(fallback,file),'https://second.trycloudflare.com');
  for(const invalid of ['','http://plain.example','javascript:alert(1)','https://user:pass@host.example','https://host.example/path','https://host.example/?token=abc']){
   writeFileSync(file,invalid);assert.equal(currentMiniappUrl(fallback,file),fallback);
  }
  assert.equal(currentMiniappUrl(fallback,''),fallback);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
