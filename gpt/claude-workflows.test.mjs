import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {syncDir} from '../dist/workflow-sync-child.js';
test('managed workflows: install, keep user edits and deletions, update untouched copies', () => {
 const dir = join(mkdtempSync(join(tmpdir(), 'wf-')), 'workflows');
 try {
  const v1 = [{name: 'review', body: 'v1 review'}, {name: 'plan', body: 'v1 plan'}, {name: 'audit', body: 'v1 audit'}, {name: '../evil', body: 'x'}];
  assert.deepEqual(syncDir(dir, v1), {installed: ['review', 'plan', 'audit'], updated: [], kept: []});
  assert.equal(existsSync(join(dir, '../evil.js')), false, 'имя с путём отбрасывается');
  writeFileSync(join(dir, 'plan.js'), 'мой план');   // человек поправил сам
  unlinkSync(join(dir, 'audit.js'));                 // и удалил ненужное
  const v2 = [{name: 'review', body: 'v2 review'}, {name: 'plan', body: 'v2 plan'}, {name: 'audit', body: 'v2 audit'}, {name: 'karta', body: 'v1 karta'}];
  assert.deepEqual(syncDir(dir, v2), {installed: ['karta'], updated: ['review'], kept: ['plan', 'audit']});
  assert.equal(readFileSync(join(dir, 'review.js'), 'utf8'), 'v2 review');
  assert.equal(readFileSync(join(dir, 'plan.js'), 'utf8'), 'мой план');
  assert.equal(existsSync(join(dir, 'audit.js')), false);
  assert.deepEqual(syncDir(dir, v2), {installed: [], updated: [], kept: ['plan', 'audit']}, 'повторный запуск ничего не трогает');
 } finally { rmSync(join(dir, '..'), {recursive: true, force: true}); }
});
