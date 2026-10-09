import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStrategyDecision } from './index.mjs';

function base(overrides = {}) {
  const state = {
    state_id: 'state-A',
    demonstration: { status: 'INDEPENDENT_CONFIRMED' },
    transfer: { status: 'CONFIRMED_IN_SCOPE' },
    retention: { status: 'NOT_CHECKED' },
    concern: { status: 'NONE_OBSERVED' },
    decision_basis: {
      snapshot_id: 'snap-1',
      evidence_ids: ['e1','e2'],
      eligibility_ids: ['q1','q2'],
      limitations: []
    }
  };
  const diagnosis = {
    diagnosis_id: 'diag-A',
    status: 'NO_SUPPORTED_PATTERN',
    hypothesis: 'UNKNOWN',
    candidate_hypotheses: [],
    diagnosis_evidence_ids: [],
    source_conflict: { conflicts: [] }
  };
  const priority = {
    concept_id: 'A',
    reasons: ['NO_SPECIAL_PRIORITY_SIGNAL'],
    flags: {
      unresolved_conflict: false,
      repeated_supported_weakness: false,
      verification_due: false,
      retention_due: false,
      advance_readiness: false
    }
  };
  const workload = {
    capacity_band: 'NORMAL',
    remaining_minutes: 25
  };
  return {
    decisionId: 'decision-1',
    learnerId: 'learner-synthetic-A',
    concept: { concept_id: 'A', scope: 'scope-a' },
    state,
    diagnosis,
    priority,
    workload,
    policyVersion: 'ntl6-policy-1.0',
    authorityScopeRef: 'approved-package:pkg-1',
    createdAt: '2026-09-18T00:00:00+07:00',
    ...overrides
  };
}

function decide(mutator = () => {}) {
  const input = base();
  mutator(input);
  return buildStrategyDecision(input);
}

test('material conflict chooses DIAGNOSE as need action', () => {
  const out = decide((i) => {
    i.diagnosis.status = 'CONFLICT';
    i.diagnosis.source_conflict = { conflicts: [{ assertions: [
      { evidence_ids: ['e3'] }, { evidence_ids: ['e4'] }
    ] }] };
    i.priority.flags.unresolved_conflict = true;
  });
  assert.equal(out.need_action, 'DIAGNOSE');
  assert.equal(out.scheduled_action, 'DIAGNOSE');
  assert.deepEqual(new Set(out.contrary_evidence_ids), new Set(['e3','e4']));
});

test('repeated concept gap chooses RETEACH', () => {
  const out = decide((i) => {
    i.diagnosis.status = 'REPEATED_PATTERN';
    i.diagnosis.hypothesis = 'CONCEPT_GAP';
    i.diagnosis.candidate_hypotheses = ['CONCEPT_GAP'];
  });
  assert.equal(out.need_action, 'RETEACH');
  assert.equal(out.scheduled_action, 'RETEACH');
});

test('repeated strategy mechanism chooses REPAIR', () => {
  const out = decide((i) => {
    i.diagnosis.status = 'REPEATED_PATTERN';
    i.diagnosis.hypothesis = 'STRATEGY';
    i.diagnosis.candidate_hypotheses = ['STRATEGY'];
  });
  assert.equal(out.need_action, 'REPAIR');
});

test('single supported signal chooses RECHECK instead of immediate repair', () => {
  const out = decide((i) => {
    i.diagnosis.status = 'SIGNAL';
    i.diagnosis.hypothesis = 'MISREAD_QUESTION';
    i.diagnosis.candidate_hypotheses = ['MISREAD_QUESTION'];
  });
  assert.equal(out.need_action, 'RECHECK');
});

test('stable confirmed concept defaults to MAINTAIN when no advance approval exists', () => {
  const out = decide();
  assert.equal(out.need_action, 'MAINTAIN');
});

test('advance readiness chooses ADVANCE only when priority explicitly grants it', () => {
  const out = decide((i) => { i.priority.flags.advance_readiness = true; i.priority.reasons = ['ADVANCE_READINESS']; });
  assert.equal(out.need_action, 'ADVANCE');
});

test('REST capacity pauses scheduled action but preserves need action', () => {
  const out = decide((i) => {
    i.diagnosis.status = 'REPEATED_PATTERN';
    i.diagnosis.hypothesis = 'CONCEPT_GAP';
    i.workload = { capacity_band: 'REST', remaining_minutes: 0 };
  });
  assert.equal(out.need_action, 'RETEACH');
  assert.equal(out.scheduled_action, 'PAUSE');
  assert.deepEqual(out.dose, { class: 'REST', minutes: 0 });
});

test('MICRO capacity pauses RETEACH but may schedule RECHECK', () => {
  const reteach = decide((i) => {
    i.diagnosis.status = 'REPEATED_PATTERN';
    i.diagnosis.hypothesis = 'PREREQUISITE_GAP';
    i.workload = { capacity_band: 'MICRO', remaining_minutes: 8 };
  });
  assert.equal(reteach.need_action, 'RETEACH');
  assert.equal(reteach.scheduled_action, 'PAUSE');

  const recheck = decide((i) => {
    i.diagnosis.status = 'SIGNAL';
    i.workload = { capacity_band: 'MICRO', remaining_minutes: 8 };
  });
  assert.equal(recheck.need_action, 'RECHECK');
  assert.equal(recheck.scheduled_action, 'RECHECK');
  assert.deepEqual(recheck.dose, { class: 'MICRO', minutes: 8 });
});

test('MICRO capacity also pauses ADVANCE while preserving need', () => {
  const out = decide((i) => {
    i.priority.flags.advance_readiness = true;
    i.workload = { capacity_band: 'MICRO', remaining_minutes: 6 };
  });
  assert.equal(out.need_action, 'ADVANCE');
  assert.equal(out.scheduled_action, 'PAUSE');
});

test('verification or retention due selects RECHECK without saying forgotten', () => {
  const out = decide((i) => {
    i.priority.flags.retention_due = true;
    i.priority.reasons = ['RETENTION_CHECK_DUE'];
  });
  assert.equal(out.need_action, 'RECHECK');
  assert.doesNotMatch(out.why, /forgotten|forgetting|decay/i);
});

test('unknown or assisted-only state chooses DIAGNOSE rather than guessing action', () => {
  const out = decide((i) => {
    i.state.demonstration.status = 'ASSISTED_ONLY';
    i.state.transfer.status = 'NOT_CHECKED';
  });
  assert.equal(out.need_action, 'DIAGNOSE');
});

test('decision preserves T2 contract-required fields and no intervention/outcome/calendar fields', () => {
  const out = decide();
  for (const key of ['decision_id','learner_id','concept_id','concept_scope','snapshot_id','evidence_ids','eligibility_ids','policy_version','hypotheses','unknowns','contrary_evidence_ids','need_action','scheduled_action','dose','authority_scope_ref','why','expected_change','recheck_condition','lifecycle','created_at']) {
    assert.ok(Object.hasOwn(out, key), `required field: ${key}`);
  }
  const forbidden = new Set(['delivered_intervention','outcome','calendar_slot','delivered_at']);
  for (const key of Object.keys(out)) assert.equal(forbidden.has(key), false, `forbidden field: ${key}`);
  assert.equal(out.lifecycle, 'PLANNED');
});
