import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireFileLock } from '../ledger/store.mjs';
import { appendExposureEvent, readExposureEvents } from './writer.mjs';

function temp() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ntl6-exp-'));
  return {file:path.join(dir,'events.jsonl'),lock:path.join(dir,'writer.lock')};
}
function event(id='exp-1') {
  return {contract_version:'QUESTION_EXPOSURE/1.0',exposure_id:id,learner_id:'learner-demo',assessment_id:'a-1',
    item_id:'i-1',family_signature:'fam-1',purpose:'FRESH_RECHECK',exposure_type:'ASSIGNED_TO_LEARNER',
    help_level:'NONE_OBSERVED',answer_exposure:'NONE_OBSERVED',occurred_at:'2026-09-18T12:00:00Z',source_ref:'assessment:a-1'};
}

test('exposure writer is append-only idempotent and conflict-safe', () => {
  const t=temp();
  assert.equal(appendExposureEvent(event(),{filePath:t.file,lockPath:t.lock}).status,'APPENDED');
  assert.equal(appendExposureEvent(event(),{filePath:t.file,lockPath:t.lock}).status,'NO_OP_EXISTING');
  assert.equal(appendExposureEvent({...event(),answer_exposure:'WORKED_ANSWER'},{filePath:t.file,lockPath:t.lock}).status,'CONFLICT');
  assert.equal(readExposureEvents(t.file).length,1);
});

test('exposure second writer is rejected', () => {
  const t=temp();
  const release=acquireFileLock(t.lock);
  try { assert.throws(() => appendExposureEvent(event(),{filePath:t.file,lockPath:t.lock}),(error)=>error?.code==='WRITER_LOCKED'); }
  finally { release(); }
});
