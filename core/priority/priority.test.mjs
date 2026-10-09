import test from 'node:test';
import assert from 'node:assert/strict';
import { rankConceptPriorities } from './index.mjs';

function candidate({
  id,
  prereqs = [],
  activeTarget = false,
  demo = 'UNKNOWN',
  transfer = 'NOT_CHECKED',
  retention = 'NOT_CHECKED',
  concern = 'NONE_OBSERVED',
  diagnosis = 'NO_SUPPORTED_PATTERN',
  parentPriority = 'NONE',
  examRelevance = 'LOW',
  verificationDue = false,
  retentionDue = false,
  advanceApproved = false
}) {
  return {
    concept: {
      concept_id: id,
      concept_version: '1.0',
      subject: 'MATH',
      scope: id.toLowerCase(),
      prerequisite_ids: prereqs
    },
    state: {
      state_id: `state-${id}`,
      demonstration: { status: demo },
      transfer: { status: transfer },
      retention: { status: retention },
      concern: { status: concern }
    },
    diagnosis: {
      diagnosis_id: `diag-${id}`,
      status: diagnosis
    },
    trend: { trend_id: `trend-${id}` },
    meta: {
      active_target: activeTarget,
      parent_priority: parentPriority,
      exam_relevance: examRelevance,
      verification_due: verificationDue,
      retention_due: retentionDue,
      advance_scope_approved: advanceApproved
    }
  };
}

function rank(candidates) {
  return rankConceptPriorities({
    prioritySetId: 'priority-test',
    asOf: '2026-09-18T00:00:00+07:00',
    policyVersion: 'ntl6-policy-1.0',
    candidates
  });
}

test('unsufficient prerequisite of active target ranks first as blocker', () => {
  const prereq = candidate({ id: 'A', demo: 'ASSISTED_ONLY', examRelevance: 'LOW' });
  const target = candidate({ id: 'B', prereqs: ['A'], activeTarget: true, diagnosis: 'REPEATED_PATTERN', examRelevance: 'HIGH' });
  const out = rank([target, prereq]);
  assert.equal(out.ranked[0].concept_id, 'A');
  assert.equal(out.ranked[0].priority_class, 'PREREQUISITE_BLOCKER');
  assert.ok(out.ranked[0].reasons.includes('PREREQUISITE_BLOCKER'));
});

test('unresolved material conflict outranks repeated weakness when neither is prerequisite blocker', () => {
  const conflict = candidate({ id: 'A', demo: 'INDEPENDENT_OBSERVED', diagnosis: 'CONFLICT' });
  const repeated = candidate({ id: 'B', demo: 'INDEPENDENT_OBSERVED', diagnosis: 'REPEATED_PATTERN' });
  const out = rank([repeated, conflict]);
  assert.equal(out.ranked[0].concept_id, 'A');
  assert.equal(out.ranked[0].priority_class, 'UNRESOLVED_CONFLICT');
});

test('repeated supported weakness outranks ordinary high exam relevance', () => {
  const repeated = candidate({ id: 'A', demo: 'INDEPENDENT_OBSERVED', diagnosis: 'REPEATED_PATTERN', examRelevance: 'LOW' });
  const relevant = candidate({ id: 'B', demo: 'INDEPENDENT_CONFIRMED', examRelevance: 'HIGH' });
  const out = rank([relevant, repeated]);
  assert.equal(out.ranked[0].concept_id, 'A');
  assert.equal(out.ranked[0].priority_class, 'REPEATED_SUPPORTED_WEAKNESS');
});

test('explicit parent/exam relevance outranks verification need but does not alter learner state', () => {
  const relevant = candidate({ id: 'A', demo: 'UNKNOWN', parentPriority: 'HIGH', examRelevance: 'HIGH' });
  const verify = candidate({ id: 'B', demo: 'INDEPENDENT_OBSERVED', verificationDue: true });
  const originalDemo = relevant.state.demonstration.status;
  const out = rank([verify, relevant]);
  assert.equal(out.ranked[0].concept_id, 'A');
  assert.ok(out.ranked[0].reasons.includes('PARENT_PRIORITY_HIGH'));
  assert.ok(out.ranked[0].reasons.includes('EXAM_RELEVANCE_HIGH'));
  assert.equal(relevant.state.demonstration.status, originalDemo);
});

test('retention due outranks advance readiness', () => {
  const retention = candidate({ id: 'A', demo: 'INDEPENDENT_CONFIRMED', transfer: 'CONFIRMED_IN_SCOPE', retention: 'CHECK_PENDING' });
  const advance = candidate({ id: 'B', demo: 'INDEPENDENT_CONFIRMED', transfer: 'CONFIRMED_IN_SCOPE', advanceApproved: true });
  const out = rank([advance, retention]);
  assert.equal(out.ranked[0].concept_id, 'A');
  assert.equal(out.ranked[0].priority_class, 'RETENTION_DUE');
  assert.equal(out.ranked[1].priority_class, 'ADVANCE_READINESS');
});

test('advance readiness is denied when conflict or repeated concern exists', () => {
  const conflict = candidate({ id: 'A', demo: 'INDEPENDENT_CONFIRMED', transfer: 'CONFIRMED_IN_SCOPE', concern: 'CONFLICT', diagnosis: 'CONFLICT', advanceApproved: true });
  const repeated = candidate({ id: 'B', demo: 'INDEPENDENT_CONFIRMED', transfer: 'CONFIRMED_IN_SCOPE', concern: 'REPEATED_PATTERN', diagnosis: 'REPEATED_PATTERN', advanceApproved: true });
  const out = rank([conflict, repeated]);
  assert.equal(out.ranked.find((x) => x.concept_id === 'A').flags.advance_readiness, false);
  assert.equal(out.ranked.find((x) => x.concept_id === 'B').flags.advance_readiness, false);
});

test('stable final tie-breaker is concept_id ascending', () => {
  const a = candidate({ id: 'A' });
  const b = candidate({ id: 'B' });
  const out = rank([b, a]);
  assert.deepEqual(out.ranked.map((x) => x.concept_id), ['A', 'B']);
});

test('priority output has transparent rank/reasons and no opaque score, workload, dose, schedule, or strategy action fields', () => {
  const out = rank([candidate({ id: 'A', demo: 'INDEPENDENT_OBSERVED' })]);
  const keys = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      walk(child);
    }
  };
  walk(out);
  assert.equal(out.ranked[0].rank, 1);
  assert.ok(Array.isArray(out.ranked[0].reasons));
  for (const forbidden of ['priority_score','weighted_score','mastery_score','mastery_percentage','scheduled_action','need_action','dose','calendar','time_budget']) {
    assert.equal(keys.has(forbidden), false, `forbidden field: ${forbidden}`);
  }
});
