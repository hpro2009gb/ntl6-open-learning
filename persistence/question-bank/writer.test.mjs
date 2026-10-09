import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireFileLock } from '../ledger/store.mjs';
import { appendQuestionCandidate, appendQuestionLifecycleEvent, readQuestionLifecycleEvents } from './writer.mjs';

function temp() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ntl6-qbank-'));
  return {file:path.join(dir,'lifecycle.jsonl'),lock:path.join(dir,'writer.lock'),candidates:path.join(dir,'candidates.jsonl'),candidateLock:path.join(dir,'candidate.lock')};
}
function ev(id,previous_state,new_state) {
  return {contract_version:'QUESTION_LIFECYCLE_EVENT/1.0',event_id:id,item_id:'i-1',previous_state,new_state,actor:'SYSTEM',
    validation_refs:[],reason:'test',occurred_at:'2026-09-18T12:00:00Z',item_fingerprint:'fp-1',family_signature:'fam-1'};
}

test('question lifecycle enforces legal transition and actual prior state', () => {
  const t=temp();
  assert.equal(appendQuestionLifecycleEvent(ev('e1','NONE','GENERATED_CANDIDATE'),{filePath:t.file,lockPath:t.lock}).status,'APPENDED');
  assert.equal(appendQuestionLifecycleEvent(ev('e2','GENERATED_CANDIDATE','VALIDATED'),{filePath:t.file,lockPath:t.lock}).status,'APPENDED');
  assert.equal(appendQuestionLifecycleEvent(ev('e3','GENERATED_CANDIDATE','VALIDATED'),{filePath:t.file,lockPath:t.lock}).status,'CONFLICT');
  assert.equal(appendQuestionLifecycleEvent(ev('e4','VALIDATED','PROMOTED'),{filePath:t.file,lockPath:t.lock}).status,'APPENDED');
  assert.equal(readQuestionLifecycleEvents(t.file).length,3);
});

test('question candidate pool is idempotent by item id', () => {
  const t=temp();
  const candidate={item_id:'i-1',concept_id:'c-1',prompt:'1+1=?'};
  assert.equal(appendQuestionCandidate(candidate,{filePath:t.candidates,lockPath:t.candidateLock}).status,'APPENDED');
  assert.equal(appendQuestionCandidate(candidate,{filePath:t.candidates,lockPath:t.candidateLock}).status,'NO_OP_EXISTING');
  assert.equal(appendQuestionCandidate({...candidate,prompt:'2+2=?'},{filePath:t.candidates,lockPath:t.candidateLock}).status,'CONFLICT');
});

test('question lifecycle second writer is rejected', () => {
  const t=temp();
  const release=acquireFileLock(t.lock);
  try { assert.throws(() => appendQuestionLifecycleEvent(ev('e1','NONE','GENERATED_CANDIDATE'),{filePath:t.file,lockPath:t.lock}),(error)=>error?.code==='WRITER_LOCKED'); }
  finally { release(); }
});
