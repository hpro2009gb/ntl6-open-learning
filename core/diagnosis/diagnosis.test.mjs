import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnosisReadModel } from './index.mjs';

const concept = {
  concept_id: 'MATH.MOTION.MEETING',
  concept_version: '1.0',
  subject: 'MATH',
  scope: 'meeting-motion'
};

function record({
  id,
  session,
  date = '2026-09-10T10:00:00+07:00',
  source = 'AGENT_CHAT',
  result = 'INCORRECT',
  mechanism = 'STRATEGY',
  interpretationStatus = 'VERIFIED',
  dataStatus = 'ACTIVE',
  provenance = 'PASS',
  mapping = 'PASS',
  rubric = 'PASS',
  grading = 'PASS',
  duplicate = 'PASS',
  active = 'PASS',
  contextRight = 'GRANTED',
  scope = 'meeting-motion',
  rubricVersion = 'rubric-v1',
  difficulty = 'MEDIUM',
  modality = 'WRITTEN',
  timeLimit = 'NONE',
  help = 'NONE_OBSERVED',
  retry = 'FRESH',
  exposure = 'NONE_OBSERVED',
  fatigue = 'NORMAL',
  interruption = 'NONE'
}) {
  return {
    evidence: {
      evidence_id: id,
      session_id: session,
      learner_id: 'learner-synthetic-A',
      observed_at: date,
      provenance: { source_kind: source },
      target: {
        concept_id: concept.concept_id,
        concept_version: concept.concept_version,
        scope,
        rubric_version: rubricVersion,
        relative_difficulty: difficulty
      },
      result: { criterion_result: result },
      help: { level: help },
      attempt: { retry_relation: retry, answer_exposure: exposure },
      conditions: { response_modality: modality, time_limit: timeLimit, fatigue, interruption },
      interpretation: { status: interpretationStatus, error_hypothesis: mechanism },
      data_status: { status: dataStatus }
    },
    eligibility: {
      eligibility_id: `elig-${id}`,
      evidence_id: id,
      checks: {
        provenance_traceable: provenance,
        target_mapping_valid: mapping,
        item_rubric_trustworthy: rubric,
        grading_sufficient: grading,
        duplicate_excluded: duplicate,
        active_status: active
      },
      rights: {
        CONTEXT_OK: contextRight,
        ASSISTED_PROGRESS_OK: grading === 'PASS' && mapping === 'PASS' && duplicate === 'PASS' && active === 'PASS' ? 'GRANTED' : 'DENIED',
        INDEPENDENCE_OK: 'DENIED',
        TRANSFER_OK: 'DENIED',
        RETENTION_OK: 'DENIED'
      }
    }
  };
}

function diagnose(records) {
  return buildDiagnosisReadModel({
    diagnosisId: 'diag-test',
    learnerId: 'learner-synthetic-A',
    concept,
    asOf: '2026-09-18T00:00:00+07:00',
    policyVersion: 'ntl6-policy-1.0',
    records
  });
}

test('one trustworthy verified mechanism yields SIGNAL', () => {
  const out = diagnose([record({ id: 'e1', session: 's1', mechanism: 'STRATEGY' })]);
  assert.equal(out.status, 'SIGNAL');
  assert.equal(out.hypothesis, 'STRATEGY');
  assert.deepEqual(out.diagnosis_evidence_ids, ['e1']);
  assert.equal(out.discriminating_opportunity.needed, false);
});

test('same trustworthy mechanism across two sessions yields REPEATED_PATTERN', () => {
  const out = diagnose([
    record({ id: 'e1', session: 's1', mechanism: 'CONCEPT_GAP' }),
    record({ id: 'e2', session: 's2', date: '2026-09-11T10:00:00+07:00', mechanism: 'CONCEPT_GAP' })
  ]);
  assert.equal(out.status, 'REPEATED_PATTERN');
  assert.equal(out.hypothesis, 'CONCEPT_GAP');
});

test('different supported mechanisms remain ambiguous and request discrimination', () => {
  const out = diagnose([
    record({ id: 'e1', session: 's1', mechanism: 'MISREAD_QUESTION' }),
    record({ id: 'e2', session: 's2', date: '2026-09-11T10:00:00+07:00', mechanism: 'STRATEGY' })
  ]);
  assert.equal(out.status, 'AMBIGUOUS_MECHANISMS');
  assert.equal(out.hypothesis, 'UNKNOWN');
  assert.deepEqual(new Set(out.candidate_hypotheses), new Set(['MISREAD_QUESTION', 'STRATEGY']));
  assert.equal(out.discriminating_opportunity.needed, true);
  assert.equal(out.discriminating_opportunity.reason, 'DISTINGUISH_SUPPORTED_MECHANISMS');
});

test('HELD or bad grading evidence fails closed and does not blame learner', () => {
  const held = record({ id: 'e1', session: 's1', dataStatus: 'HELD', grading: 'UNKNOWN', mechanism: 'CONCEPT_GAP' });
  const bad = record({ id: 'e2', session: 's2', grading: 'FAIL', mechanism: 'CONCEPT_GAP' });
  const out = diagnose([held, bad]);
  assert.equal(out.status, 'QUALITY_DISPUTE');
  assert.equal(out.hypothesis, 'UNKNOWN');
  assert.equal(out.dispute.hold_required_for_strong_conclusion, true);
  assert.deepEqual(new Set(out.dispute.evidence_ids), new Set(['e1', 'e2']));
});

test('superseded bad-quality history is auditable but not a live dispute', () => {
  const old = record({ id: 'old', session: 's-old', dataStatus: 'SUPERSEDED', grading: 'FAIL', mechanism: 'CONCEPT_GAP' });
  const fixed = record({ id: 'fixed', session: 's-fixed', result: 'CORRECT', mechanism: 'UNKNOWN' });
  const out = diagnose([old, fixed]);
  assert.equal(out.status, 'NO_SUPPORTED_PATTERN');
  assert.equal(out.dispute.status, 'NONE_OBSERVED');
});

test('same-scope same-condition cross-source contradiction preserves CONFLICT and selects no winner', () => {
  const out = diagnose([
    record({ id: 'a1', session: 'sa', source: 'AGENT_CHAT', result: 'INCORRECT', mechanism: 'STRATEGY' }),
    record({ id: 's1', session: 'ss', source: 'SCHOOL', result: 'CORRECT', mechanism: 'UNKNOWN' })
  ]);
  assert.equal(out.status, 'CONFLICT');
  assert.equal(out.source_conflict.status, 'CONFLICT');
  assert.equal(out.source_conflict.winner, 'NONE_SELECTED');
  assert.equal(out.discriminating_opportunity.needed, true);
  assert.equal(out.discriminating_opportunity.reason, 'RESOLVE_SAME_SCOPE_SOURCE_CONFLICT');
});

test('different conditions across sources are NON_COMPARABLE, not a conflict', () => {
  const out = diagnose([
    record({ id: 'a1', session: 'sa', source: 'AGENT_CHAT', result: 'INCORRECT', difficulty: 'HARD' }),
    record({ id: 's1', session: 'ss', source: 'SCHOOL', result: 'CORRECT', difficulty: 'EASY', mechanism: 'UNKNOWN' })
  ]);
  assert.notEqual(out.status, 'CONFLICT');
  assert.equal(out.source_conflict.status, 'NON_COMPARABLE');
  assert.equal(out.source_conflict.winner, 'NONE_SELECTED');
});

test('external context-only evidence is preserved as context and cannot create strong diagnosis', () => {
  const external = record({
    id: 'u1',
    session: 'u1',
    source: 'UNICLASS',
    mechanism: 'CONCEPT_GAP',
    mapping: 'UNKNOWN',
    rubric: 'UNKNOWN',
    help: 'UNKNOWN',
    retry: 'UNKNOWN',
    exposure: 'UNKNOWN'
  });
  const out = diagnose([external]);
  assert.equal(out.status, 'NO_SUPPORTED_PATTERN');
  assert.equal(out.hypothesis, 'UNKNOWN');
  assert.equal(out.context_signals.length, 1);
  assert.equal(out.context_signals[0].source_kind, 'UNICLASS');
});

test('unverified error hypothesis cannot become SIGNAL', () => {
  const out = diagnose([record({ id: 'e1', session: 's1', interpretationStatus: 'PROPOSED', mechanism: 'CONCEPT_GAP' })]);
  assert.equal(out.status, 'NO_SUPPORTED_PATTERN');
  assert.equal(out.hypothesis, 'UNKNOWN');
});

test('diagnosis output contains no priority score, workload schedule, or strategy action', () => {
  const out = diagnose([record({ id: 'e1', session: 's1', mechanism: 'STRATEGY' })]);
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, /priority_score|workload|scheduled_action|need_action/);
  for (const action of ['DIAGNOSE','RETEACH','REPAIR','RECHECK','MAINTAIN','ADVANCE','PAUSE']) {
    assert.doesNotMatch(text, new RegExp(`\\b${action}\\b`));
  }
});
