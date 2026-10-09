import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrendReadModel } from './index.mjs';

const concept = {
  concept_id: 'MATH.PERCENT.REVERSE',
  concept_version: '1.0',
  subject: 'MATH',
  scope: 'reverse-percent'
};

function record({
  id,
  session,
  date,
  result = 'CORRECT',
  help = 'NONE_OBSERVED',
  independence = true,
  transfer = false,
  retention = false,
  status = 'ACTIVE',
  duplicate = false,
  scope = 'reverse-percent',
  rubric = 'rubric-v1',
  difficulty = 'MEDIUM',
  modality = 'WRITTEN',
  timeLimit = 'NONE'
}) {
  return {
    evidence: {
      evidence_id: id,
      session_id: session,
      learner_id: 'learner-synthetic-A',
      observed_at: date,
      target: {
        concept_id: concept.concept_id,
        concept_version: concept.concept_version,
        scope,
        rubric_version: rubric,
        relative_difficulty: difficulty
      },
      result: { criterion_result: result },
      help: { level: help },
      conditions: { response_modality: modality, time_limit: timeLimit },
      data_status: { status }
    },
    eligibility: {
      eligibility_id: `elig-${id}`,
      evidence_id: id,
      checks: {
        duplicate_excluded: duplicate ? 'FAIL' : 'PASS',
        target_mapping_valid: 'PASS',
        item_rubric_trustworthy: 'PASS',
        grading_sufficient: 'PASS'
      },
      rights: {
        CONTEXT_OK: 'GRANTED',
        ASSISTED_PROGRESS_OK: 'GRANTED',
        INDEPENDENCE_OK: independence ? 'GRANTED' : 'DENIED',
        TRANSFER_OK: transfer ? 'GRANTED' : 'DENIED',
        RETENTION_OK: retention ? 'GRANTED' : 'DENIED'
      }
    }
  };
}

function trend(records, conceptState = null) {
  return buildTrendReadModel({
    trendId: 'trend-test',
    learnerId: 'learner-synthetic-A',
    concept,
    asOf: '2026-09-18T00:00:00+07:00',
    policyVersion: 'ntl6-policy-1.0',
    records,
    conceptState
  });
}

test('flat correctness plus decreasing help is visible as support progress, not score progress', () => {
  const out = trend([
    record({ id: 'e1', session: 's1', date: '2026-09-10T10:00:00+07:00', help: 'TARGET_HINT', independence: false }),
    record({ id: 'e2', session: 's2', date: '2026-09-11T10:00:00+07:00', help: 'GENERAL_PROMPT', independence: false }),
    record({ id: 'e3', session: 's3', date: '2026-09-12T10:00:00+07:00', help: 'NONE_OBSERVED', independence: true })
  ]);
  assert.equal(out.axes.correctness.status, 'STABLE');
  assert.equal(out.axes.support.status, 'DECREASING_SUPPORT');
  assert.equal(out.axes.independence.status, 'MORE_INDEPENDENT_EVIDENCE');
});

test('higher correctness with worsening help exposes mixed signal instead of progress claim', () => {
  const out = trend([
    record({ id: 'e1', session: 's1', date: '2026-09-10T10:00:00+07:00', result: 'INCORRECT', help: 'GENERAL_PROMPT', independence: false }),
    record({ id: 'e2', session: 's2', date: '2026-09-11T10:00:00+07:00', result: 'CORRECT', help: 'TARGET_HINT', independence: false })
  ]);
  assert.equal(out.axes.correctness.status, 'IMPROVING');
  assert.equal(out.axes.support.status, 'INCREASING_SUPPORT');
});

test('one recent error after two stable successes is an anomaly cue, not diagnosis', () => {
  const out = trend([
    record({ id: 'e1', session: 's1', date: '2026-09-10T10:00:00+07:00' }),
    record({ id: 'e2', session: 's2', date: '2026-09-11T10:00:00+07:00' }),
    record({ id: 'e3', session: 's3', date: '2026-09-12T10:00:00+07:00', result: 'INCORRECT', independence: false })
  ], { demonstration: { status: 'INDEPENDENT_CONFIRMED' }, retention: { status: 'NOT_CHECKED' } });
  assert.equal(out.cues.anomaly.status, 'RECENT_SINGLE_DEVIATION_AFTER_STABLE_SUCCESS');
  assert.match(out.cues.anomaly.note, /no cause/i);
  assert.doesNotMatch(JSON.stringify(out), /CONCEPT_GAP|PREREQUISITE_GAP|STRATEGY\"/);
});

test('incomparable conditions do not create strong correctness or support trends', () => {
  const out = trend([
    record({ id: 'e1', session: 's1', date: '2026-09-10T10:00:00+07:00', difficulty: 'EASY' }),
    record({ id: 'e2', session: 's2', date: '2026-09-11T10:00:00+07:00', difficulty: 'HARD', result: 'INCORRECT', help: 'TARGET_HINT', independence: false })
  ]);
  assert.equal(out.axes.correctness.status, 'INSUFFICIENT_COMPARABLE_DATA');
  assert.equal(out.axes.support.status, 'INSUFFICIENT_COMPARABLE_DATA');
});

test('same comparability group remains comparable even when another condition is interleaved', () => {
  const out = trend([
    record({ id: 'e1', session: 's1', date: '2026-09-10T10:00:00+07:00', difficulty: 'MEDIUM', help: 'TARGET_HINT', independence: false }),
    record({ id: 'x1', session: 'sx', date: '2026-09-11T10:00:00+07:00', difficulty: 'HARD', result: 'INCORRECT', help: 'TARGET_HINT', independence: false }),
    record({ id: 'e2', session: 's2', date: '2026-09-12T10:00:00+07:00', difficulty: 'MEDIUM', help: 'NONE_OBSERVED', independence: true })
  ]);
  assert.equal(out.axes.support.status, 'DECREASING_SUPPORT');
  assert.ok(out.axes.support.basis_sessions.includes('s1'));
  assert.ok(out.axes.support.basis_sessions.includes('s2'));
});

test('unknown observation time is excluded from chronological trend claims', () => {
  const out = trend([
    record({ id: 'e1', session: 's1', date: 'UNKNOWN' }),
    record({ id: 'e2', session: 's2', date: '2026-09-11T10:00:00+07:00' })
  ]);
  assert.equal(out.evidence_basis.unknown_observation_time_count, 1);
  assert.equal(out.axes.correctness.status, 'INSUFFICIENT_COMPARABLE_DATA');
  assert.match(out.limitations.join(' '), /UNKNOWN observation time/i);
});

test('duplicate, held, superseded and retracted records are excluded from strong trend basis', () => {
  const active = record({ id: 'e1', session: 's1', date: '2026-09-10T10:00:00+07:00' });
  const duplicate = record({ id: 'e2', session: 's2', date: '2026-09-11T10:00:00+07:00', duplicate: true });
  const held = record({ id: 'e3', session: 's3', date: '2026-09-12T10:00:00+07:00', status: 'HELD' });
  const superseded = record({ id: 'e4', session: 's4', date: '2026-09-13T10:00:00+07:00', status: 'SUPERSEDED' });
  const retracted = record({ id: 'e5', session: 's5', date: '2026-09-14T10:00:00+07:00', status: 'RETRACTED' });
  const out = trend([active, duplicate, held, superseded, retracted]);
  assert.deepEqual(out.evidence_basis.accepted_evidence_ids, ['e1']);
  assert.deepEqual(new Set(out.evidence_basis.excluded_evidence_ids), new Set(['e2', 'e3', 'e4', 'e5']));
});

test('elapsed time without delayed evidence never becomes forgetting', () => {
  const out = trend([
    record({ id: 'e1', session: 's1', date: '2026-07-01T10:00:00+07:00' })
  ], { demonstration: { status: 'INDEPENDENT_OBSERVED' }, retention: { status: 'NOT_CHECKED' } });
  assert.equal(out.cues.retention.status, 'NOT_CHECKED');
  assert.doesNotMatch(JSON.stringify(out), /FORGOTTEN|FORGETTING|DECAYED/);
});

test('retention cue reports delayed evidence only when retention-eligible evidence exists', () => {
  const out = trend([
    record({ id: 'e1', session: 's1', date: '2026-09-10T10:00:00+07:00', retention: true })
  ], { retention: { status: 'OBSERVED_AT_DELAY' } });
  assert.equal(out.cues.retention.status, 'DELAYED_EVIDENCE_OBSERVED');
});

test('trend output contains no strategy action vocabulary or numeric mastery field', () => {
  const out = trend([record({ id: 'e1', session: 's1', date: '2026-09-10T10:00:00+07:00' })]);
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, /mastery_score|mastery_percentage/);
  for (const action of ['DIAGNOSE','RETEACH','REPAIR','RECHECK','MAINTAIN','ADVANCE','PAUSE']) {
    assert.doesNotMatch(text, new RegExp(`\\b${action}\\b`));
  }
});
