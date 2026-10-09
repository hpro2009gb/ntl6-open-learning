import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runManualPack } from './run.mjs';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (m) => m.slice(1))), '..', '..');
const demoPack = path.join(repoRoot, 'examples', 'manual-pack');

test('demo pack runs end-to-end and produces usable parent view within shared capacity', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ntl6-manual-'));
  try {
    const result = runManualPack(demoPack, { outputRoot: tmp, runId: 'demo-test' });
    assert.ok(fs.existsSync(result.parent_view));
    assert.ok(fs.existsSync(result.analysis));
    assert.ok(fs.existsSync(result.normalized_evidence));

    const analysis = JSON.parse(fs.readFileSync(result.analysis, 'utf8'));
    assert.equal(analysis.concepts.length, 1);
    assert.equal(analysis.concepts[0].state.demonstration.status, 'INDEPENDENT_CONFIRMED');
    assert.equal(analysis.concepts[0].state.transfer.status, 'CONFIRMED_IN_SCOPE');
    assert.equal(analysis.concepts[0].decision.need_action, 'ADVANCE');
    assert.equal(analysis.concepts[0].decision.scheduled_action, 'ADVANCE');
    assert.ok(result.planned_minutes <= result.initial_remaining_minutes);

    const html = fs.readFileSync(result.parent_view, 'utf8');
    for (const id of ['HOM_NAY', 'TIEN_DO', 'CHIEN_LUOC_TUAN']) assert.match(html, new RegExp(`id="${id}"`));
    assert.doesNotMatch(html, /mastery_percentage|mastery_score/i);

    const lines = fs.readFileSync(result.normalized_evidence, 'utf8').trim().split(/\r?\n/);
    assert.equal(lines.length, 2);
    for (const line of lines) {
      const record = JSON.parse(line);
      assert.equal(record.eligibility.checks.item_rubric_trustworthy, 'PASS');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('missing parent-approved rubric authority fails closed instead of inventing strong evidence', () => {
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(demoPack, 'manifest.json'), 'utf8'));
  sourceManifest.pack_id = 'demo-no-authority';
  sourceManifest.concepts[0].rubric_authority.status = 'UNKNOWN';

  const packTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ntl6-pack-'));
  const outTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ntl6-out-'));
  try {
    fs.writeFileSync(path.join(packTmp, 'manifest.json'), JSON.stringify(sourceManifest, null, 2));
    fs.copyFileSync(path.join(demoPack, 'evidence.jsonl'), path.join(packTmp, 'evidence.jsonl'));
    const result = runManualPack(packTmp, { outputRoot: outTmp, runId: 'no-authority-test' });
    const analysis = JSON.parse(fs.readFileSync(result.analysis, 'utf8'));
    assert.equal(analysis.authority_summary[0].authority_status, 'UNKNOWN');
    assert.equal(analysis.concepts[0].state.demonstration.status, 'UNKNOWN');
    assert.equal(analysis.concepts[0].decision.need_action, 'DIAGNOSE');
    const firstRecord = JSON.parse(fs.readFileSync(result.normalized_evidence, 'utf8').trim().split(/\r?\n/)[0]);
    assert.equal(firstRecord.eligibility.checks.item_rubric_trustworthy, 'UNKNOWN');
    assert.equal(firstRecord.eligibility.rights.INDEPENDENCE_OK, 'DENIED');
  } finally {
    fs.rmSync(packTmp, { recursive: true, force: true });
    fs.rmSync(outTmp, { recursive: true, force: true });
  }
});
