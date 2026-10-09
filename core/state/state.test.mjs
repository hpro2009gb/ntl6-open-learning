import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deriveEligibility } from '../evidence/index.mjs';
import { buildConceptState } from './index.mjs';

function fixture(name) {
  return JSON.parse(fs.readFileSync(new URL(`../../data/fixtures/${name}`, import.meta.url), 'utf8'));
}

function clone(value) {
  return structuredClone(value);
}

const concept = {
  concept_id: 'MATH.PERCENT.REVERSE',
  concept_version: '1.0',
  subject: 'MATH',
  scope: 'Solve one-step reverse percentage problems',
  rubric_ref: 'rubric://math/percent-reverse',
  prerequisite_ids: ['MATH.PERCENT.MEANING']
};

const baseOptions = {
  snapshotId: 'snap-t4',
  asOf: '2026-09-12T10:00:00+07:00',
  policyVersion: 'ntl6-policy-1.0'
};

function record(evidence, overrides = {}) {
  const eligibility = deriveEligibility(evidence, {
    evaluatedAt: '2026-09-12T09:00:00+07:00',
    policyVersion: 'ntl6-policy-1.0',
    duplicate: false,
    ...overrides
  });
  return { evidence, eligibility };
}

function state(records, options = {}) {
  return buildConceptState({ learnerId: 'learner-synthetic-A', concept, records, ...baseOptions, ...options });
}

function independentVariant({ id, session, opportunity, itemFamily, transferType, result = 'CORRECT', error = 'UNKNOWN', observedAt = '2026-09-10T10:00:00+07:00' }) {
  const evidence = clone(fixture('01-valid-independent.json').evidence);
  evidence.evidence_id = id;
  evidence.session_id = session;
  evidence.opportunity_id = opportunity;
  evidence.source_identity.origin_id = `origin-${id}`;
  evidence.source_identity.dedup_key = `dedup-${id}`;
  evidence.target.item_id = `item-${id}`;
  evidence.target.item_family = itemFamily;
  evidence.result.response_ref = `synthetic://response/${id}`;
  evidence.result.criterion_result = result;
  evidence.interpretation.transfer_type = transferType;
  evidence.interpretation.error_hypothesis = error;
  evidence.interpretation.status = 'VERIFIED';
  evidence.interpretation.evidence_span = `synthetic-span-${id}`;
  evidence.observed_at = observedAt;
  return evidence;
}

test('no evidence yields unknown demonstration without inventing forgetting', () => {
  const s = state([]);
  assert.equal(s.demonstration.status, 'UNKNOWN');
  assert.equal(s.transfer.status, 'NOT_CHECKED');
  assert.equal(s.retention.status, 'NOT_CHECKED');
  assert.equal(s.concern.status, 'NONE_OBSERVED');
});

test('correct work after target hint yields ASSISTED_ONLY, not independent', () => {
  const e = independentVariant({ id:'assist-1', session:'s-a1', opportunity:'o-a1', itemFamily:'percent-reverse-word', transferType:'NONE' });
  e.help.level = 'TARGET_HINT';
  e.help.source = 'AGENT';
  e.help.timing = 'BEFORE_FINAL_ANSWER';
  const s = state([record(e)]);
  assert.equal(s.demonstration.status, 'ASSISTED_ONLY');
});

test('one eligible correct independent opportunity yields INDEPENDENT_OBSERVED', () => {
  const e = independentVariant({ id:'ind-1', session:'s-i1', opportunity:'o-i1', itemFamily:'percent-reverse-word', transferType:'FRESH_VARIANT_CONTEXT_A' });
  const s = state([record(e)]);
  assert.equal(s.demonstration.status, 'INDEPENDENT_OBSERVED');
  assert.equal(s.transfer.status, 'OBSERVED');
});

test('two sessions and two meaningful variants confirm independence and transfer in scope', () => {
  const e1 = independentVariant({ id:'ind-2a', session:'s-i2a', opportunity:'o-i2a', itemFamily:'percent-reverse-word', transferType:'MEANINGFUL_CONTEXT_STORY' });
  const e2 = independentVariant({ id:'ind-2b', session:'s-i2b', opportunity:'o-i2b', itemFamily:'percent-reverse-table', transferType:'MEANINGFUL_REPRESENTATION_TABLE' });
  const s = state([record(e1), record(e2)]);
  assert.equal(s.demonstration.status, 'INDEPENDENT_CONFIRMED');
  assert.equal(s.transfer.status, 'CONFIRMED_IN_SCOPE');
  assert.equal(s.demonstration.covered_variants.length, 2);
});

test('same template across two sessions does not satisfy meaningful-variant confirmation', () => {
  const e1 = independentVariant({ id:'same-1', session:'s-s1', opportunity:'o-s1', itemFamily:'percent-reverse-word', transferType:'NONE' });
  const e2 = independentVariant({ id:'same-2', session:'s-s2', opportunity:'o-s2', itemFamily:'percent-reverse-word', transferType:'NONE' });
  const s = state([record(e1), record(e2)]);
  assert.equal(s.demonstration.status, 'INDEPENDENT_OBSERVED');
  assert.equal(s.transfer.status, 'NOT_CHECKED');
});

test('eligible delayed correct evidence yields OBSERVED_AT_DELAY', () => {
  const e = independentVariant({ id:'ret-1', session:'s-r1', opportunity:'o-r1', itemFamily:'percent-reverse-delay', transferType:'DELAYED_7D_RECHECK', observedAt:'2026-09-11T10:00:00+07:00' });
  const s = state([record(e)]);
  assert.equal(s.retention.status, 'OBSERVED_AT_DELAY');
  assert.match(s.retention.delay_description, /DELAYED_7D_RECHECK/);
});

test('retention CHECK_PENDING is explicit and time alone never creates concern', () => {
  const s = state([], { retentionCheckPending: true, asOf:'2027-01-01T00:00:00+07:00' });
  assert.equal(s.retention.status, 'CHECK_PENDING');
  assert.equal(s.concern.status, 'NONE_OBSERVED');
});

test('one verified new error opens SIGNAL without erasing confirmed historical success', () => {
  const ok1 = independentVariant({ id:'hist-1', session:'s-h1', opportunity:'o-h1', itemFamily:'percent-reverse-word', transferType:'MEANINGFUL_CONTEXT_STORY' });
  const ok2 = independentVariant({ id:'hist-2', session:'s-h2', opportunity:'o-h2', itemFamily:'percent-reverse-table', transferType:'MEANINGFUL_REPRESENTATION_TABLE' });
  const err = independentVariant({ id:'err-1', session:'s-e1', opportunity:'o-e1', itemFamily:'percent-reverse-new', transferType:'FRESH_VARIANT_CONTEXT_B', result:'INCORRECT', error:'STRATEGY' });
  const s = state([record(ok1), record(ok2), record(err)]);
  assert.equal(s.demonstration.status, 'INDEPENDENT_CONFIRMED');
  assert.equal(s.concern.status, 'SIGNAL');
  assert.equal(s.concern.mechanism, 'STRATEGY');
});

test('same verified error mechanism across two sessions yields REPEATED_PATTERN', () => {
  const e1 = independentVariant({ id:'rep-1', session:'s-p1', opportunity:'o-p1', itemFamily:'percent-reverse-a', transferType:'FRESH_VARIANT_A', result:'INCORRECT', error:'STRATEGY' });
  const e2 = independentVariant({ id:'rep-2', session:'s-p2', opportunity:'o-p2', itemFamily:'percent-reverse-b', transferType:'FRESH_VARIANT_B', result:'INCORRECT', error:'STRATEGY' });
  const s = state([record(e1), record(e2)]);
  assert.equal(s.concern.status, 'REPEATED_PATTERN');
  assert.equal(s.concern.mechanism, 'STRATEGY');
});

test('material conflict blocks confirmation but preserves observed success', () => {
  const e1 = independentVariant({ id:'conf-1', session:'s-c1', opportunity:'o-c1', itemFamily:'percent-reverse-word', transferType:'MEANINGFUL_CONTEXT_STORY' });
  const e2 = independentVariant({ id:'conf-2', session:'s-c2', opportunity:'o-c2', itemFamily:'percent-reverse-table', transferType:'MEANINGFUL_REPRESENTATION_TABLE' });
  const s = state([record(e1), record(e2)], { conflictIds:['conflict-synth-1'] });
  assert.equal(s.demonstration.status, 'INDEPENDENT_OBSERVED');
  assert.equal(s.transfer.status, 'OBSERVED');
  assert.equal(s.concern.status, 'CONFLICT');
  assert.deepEqual(s.concern.conflict_ids, ['conflict-synth-1']);
});

test('bad or unresolved grading cannot open learner concern', () => {
  const e = independentVariant({ id:'bad-grade', session:'s-bg', opportunity:'o-bg', itemFamily:'percent-reverse-word', transferType:'FRESH_VARIANT_X', result:'INCORRECT', error:'CONCEPT_GAP' });
  e.result.grading_verification_status = 'UNRESOLVED';
  const s = state([record(e)]);
  assert.equal(s.concern.status, 'NONE_OBSERVED');
});

test('same accepted records rebuild byte-stable state regardless of input order', () => {
  const e1 = independentVariant({ id:'ord-1', session:'s-o1', opportunity:'o-o1', itemFamily:'percent-reverse-word', transferType:'MEANINGFUL_CONTEXT_STORY', observedAt:'2026-09-10T10:00:00+07:00' });
  const e2 = independentVariant({ id:'ord-2', session:'s-o2', opportunity:'o-o2', itemFamily:'percent-reverse-table', transferType:'MEANINGFUL_REPRESENTATION_TABLE', observedAt:'2026-09-11T10:00:00+07:00' });
  const forward = state([record(e1), record(e2)], { snapshotId:'stable-replay' });
  const reverse = state([record(e2), record(e1)], { snapshotId:'stable-replay' });
  assert.deepEqual(forward, reverse);
});

test('state never exposes numeric mastery fields', () => {
  const e = independentVariant({ id:'nomastery', session:'s-nm', opportunity:'o-nm', itemFamily:'percent-reverse-word', transferType:'FRESH_VARIANT_Y' });
  const s = state([record(e)]);
  assert.equal(Object.hasOwn(s, 'mastery_score'), false);
  assert.equal(Object.hasOwn(s, 'mastery_percentage'), false);
});
