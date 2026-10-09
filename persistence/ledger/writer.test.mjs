import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireFileLock, readJsonl } from './store.mjs';
import { appendLedgerRecord } from './writer.mjs';

function temp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntl6-ledger-'));
  return { file:path.join(dir,'evidence.jsonl'), lock:path.join(dir,'writer.lock') };
}

function input(payload = { hello:'world' }) {
  return {
    recordType:'EVIDENCE_OPPORTUNITY',schemaRef:'EVIDENCE_OPPORTUNITY/1.0',
    idempotencyKey:'op-1',dedupKey:'dedup-1',occurredAt:'2026-09-18T12:00:00+07:00',payload
  };
}

test('append -> same semantic no-op -> changed semantic conflict', () => {
  const t=temp();
  const a=appendLedgerRecord(input(),{filePath:t.file,lockPath:t.lock,appendedAt:'2026-09-18T12:01:00Z'});
  assert.equal(a.status,'APPENDED');
  const b=appendLedgerRecord(input(),{filePath:t.file,lockPath:t.lock,appendedAt:'2026-09-18T12:02:00Z'});
  assert.equal(b.status,'NO_OP_EXISTING');
  const c=appendLedgerRecord(input({hello:'changed'}),{filePath:t.file,lockPath:t.lock});
  assert.equal(c.status,'CONFLICT');
  assert.equal(readJsonl(t.file).length,1);
});

test('invalid canonical append is rejected before file creation', () => {
  const t=temp();
  const r=appendLedgerRecord({...input(),schemaRef:'WRONG/1.0'},{filePath:t.file,lockPath:t.lock});
  assert.equal(r.status,'REJECTED');
  assert.equal(fs.existsSync(t.file),false);
});

test('second writer is rejected while lock is held', () => {
  const t=temp();
  const release=acquireFileLock(t.lock);
  try {
    assert.throws(() => appendLedgerRecord(input(),{filePath:t.file,lockPath:t.lock}), (error) => error?.code === 'WRITER_LOCKED');
  } finally { release(); }
});
