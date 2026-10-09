import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeliveredIntervention, reviewStrategyOutcome } from './index.mjs';

function decision(overrides = {}) {
  return {
    contract_version: 'STRATEGY_DECISION/1.0',
    decision_id: 'd1',
    learner_id: 'learner-synthetic-A',
    concept_id: 'MATH.MOTION.MEETING',
    concept_scope: 'meeting-motion',
    hypotheses: ['STRATEGY'],
    scheduled_action: 'REPAIR',
    dose: { class: 'NORMAL', minutes: 15 },
    ...overrides
  };
}

function delivered(overrides = {}) {
  return createDeliveredIntervention({
    interventionId: 'i1',
    decision: decision(),
    deliveryStatus: 'COMPLETED',
    teacher: 'PARENT',
    actualMethod: 'diagram-plus-explain-why',
    actualDose: 'NORMAL:14m',
    startedAt: '2026-09-18T09:00:00+07:00',
    completedAt: '2026-09-18T09:14:00+07:00',
    modifications: [],
    concurrentExposures: [],
    generatedEvidenceIds: ['e-after-1'],
    ...overrides
  });
}

function review(intervention, overrides = {}) {
  return reviewStrategyOutcome({
    outcomeId: 'o1',
    decision: decision(),
    intervention,
    policyVersion: 'ntl6-policy-1.0',
    reviewedAt: '2026-09-18T20:00:00+07:00',
    expectedAxes: ['INDEPENDENCE'],
    axisComparisons: { INDEPENDENCE: 'IMPROVED' },
    comparisonBasis: 'Fresh independent comparison under matched visible conditions.',
    knownContributors: [],
    priorSameMethodNoImprovementCount: 0,
    ...overrides
  });
}

test('delivered intervention preserves planned vs actual method and dose', () => {
  const out = delivered({
    actualMethod: 'shorter-parent-diagram',
    actualDose: 'MICRO:8m',
    modifications: ['Stopped early after learner fatigue signal.']
  });
  assert.equal(out.planned_method, 'REPAIR');
  assert.equal(out.planned_dose, 'NORMAL:15m');
  assert.equal(out.actual_method, 'shorter-parent-diagram');
  assert.equal(out.actual_dose, 'MICRO:8m');
  assert.equal(out.delivery_status, 'COMPLETED');
  assert.equal(out.teacher, 'PARENT');
  assert.equal(out.modifications.length, 1);
});

test('NOT_DELIVERED creates no efficacy inference and does not increment no-improvement fuse', () => {
  const intervention = createDeliveredIntervention({
    interventionId: 'i1', decision: decision(), deliveryStatus: 'NOT_DELIVERED', teacher: 'PARENT'
  });
  const out = review(intervention, { priorSameMethodNoImprovementCount: 1 });
  assert.equal(intervention.actual_method, 'NOT_DELIVERED');
  assert.equal(out.status, 'NOT_DELIVERED');
  assert.equal(out.third_repeat_fuse.same_method_delivered_no_improvement_count, 1);
  assert.equal(out.third_repeat_fuse.automatic_repeat_allowed, true);
  assert.match(out.interpretation, /no strategy-efficacy inference/i);
});

test('INTERRUPTED intervention is INCONCLUSIVE and does not count as method failure', () => {
  const intervention = delivered({ deliveryStatus: 'INTERRUPTED', completedAt: '2026-09-18T09:06:00+07:00' });
  const out = review(intervention, { priorSameMethodNoImprovementCount: 1 });
  assert.equal(out.status, 'INCONCLUSIVE');
  assert.equal(out.third_repeat_fuse.same_method_delivered_no_improvement_count, 1);
  assert.match(out.limitations.join(' '), /not completed/i);
});

test('completed expected-axis improvement yields IMPROVED_ON_TARGET and resets fuse', () => {
  const out = review(delivered(), { priorSameMethodNoImprovementCount: 1 });
  assert.equal(out.status, 'IMPROVED_ON_TARGET');
  assert.equal(out.axis_results.INDEPENDENCE, 'IMPROVED');
  assert.equal(out.third_repeat_fuse.same_method_delivered_no_improvement_count, 0);
});

test('all assessed expected axes with no observed change yields NO_OBSERVED_CHANGE', () => {
  const out = review(delivered(), {
    expectedAxes: ['ACCURACY','INDEPENDENCE'],
    axisComparisons: { ACCURACY: 'NO_OBSERVED_CHANGE', INDEPENDENCE: 'NO_OBSERVED_CHANGE' }
  });
  assert.equal(out.status, 'NO_OBSERVED_CHANGE');
  assert.equal(out.third_repeat_fuse.same_method_delivered_no_improvement_count, 1);
});

test('worse expected-axis observation yields WORSE_ON_TARGET without causal claim', () => {
  const out = review(delivered(), {
    expectedAxes: ['ACCURACY'],
    axisComparisons: { ACCURACY: 'WORSE' }
  });
  assert.equal(out.status, 'WORSE_ON_TARGET');
  assert.match(out.interpretation, /observed/i);
  assert.match(out.interpretation, /does not establish/i);
});

test('mixed improved and worse expected axes is INCONCLUSIVE', () => {
  const out = review(delivered(), {
    expectedAxes: ['ACCURACY','INDEPENDENCE'],
    axisComparisons: { ACCURACY: 'IMPROVED', INDEPENDENCE: 'WORSE' }
  });
  assert.equal(out.status, 'INCONCLUSIVE');
});

test('missing expected-axis comparison remains INCONCLUSIVE/NOT_ASSESSED-safe', () => {
  const out = review(delivered(), {
    expectedAxes: ['TRANSFER'],
    axisComparisons: {}
  });
  assert.equal(out.status, 'INCONCLUSIVE');
  assert.equal(out.axis_results.TRANSFER, 'INCONCLUSIVE');
  assert.match(out.limitations.join(' '), /unresolved|not assessed/i);
});

test('modifications and concurrent exposures are retained as contributor limitations', () => {
  const intervention = delivered({
    modifications: ['Switched from written to oral explanation.'],
    concurrentExposures: ['School reviewed same concept earlier that day.']
  });
  const out = review(intervention, { knownContributors: ['Child reported unusually high energy.'] });
  assert.ok(out.known_contributors.includes('School reviewed same concept earlier that day.'));
  assert.ok(out.known_contributors.includes('Child reported unusually high energy.'));
  assert.match(out.limitations.join(' '), /modified|modifications|actual recorded delivery/i);
  assert.match(out.limitations.join(' '), /Concurrent exposures/i);
});

test('second consecutive same-method no-change blocks third automatic repeat and requires DIAGNOSE', () => {
  const out = review(delivered(), {
    expectedAxes: ['INDEPENDENCE'],
    axisComparisons: { INDEPENDENCE: 'NO_OBSERVED_CHANGE' },
    priorSameMethodNoImprovementCount: 1,
    priorMethod: 'diagram-plus-explain-why'
  });
  assert.equal(out.third_repeat_fuse.same_method_delivered_no_improvement_count, 2);
  assert.equal(out.third_repeat_fuse.automatic_repeat_allowed, false);
  assert.equal(out.third_repeat_fuse.next_required_action, 'DIAGNOSE');
});

test('third-or-later same-method no-improvement requires HUMAN_DECISION', () => {
  const out = review(delivered(), {
    expectedAxes: ['INDEPENDENCE'],
    axisComparisons: { INDEPENDENCE: 'NO_OBSERVED_CHANGE' },
    priorSameMethodNoImprovementCount: 2,
    priorMethod: 'diagram-plus-explain-why'
  });
  assert.equal(out.third_repeat_fuse.same_method_delivered_no_improvement_count, 3);
  assert.equal(out.third_repeat_fuse.automatic_repeat_allowed, false);
  assert.equal(out.third_repeat_fuse.next_required_action, 'HUMAN_DECISION');
});

test('different actual method resets prior same-method lineage before counting current no-change', () => {
  const intervention = delivered({ actualMethod: 'new-method' });
  const out = review(intervention, {
    expectedAxes: ['INDEPENDENCE'],
    axisComparisons: { INDEPENDENCE: 'NO_OBSERVED_CHANGE' },
    priorSameMethodNoImprovementCount: 2,
    priorMethod: 'old-method'
  });
  assert.equal(out.third_repeat_fuse.same_method_delivered_no_improvement_count, 1);
  assert.equal(out.third_repeat_fuse.automatic_repeat_allowed, true);
});

test('outcome output has no weekly UI, priority mutation, strategy rewrite, or direct causal attribution', () => {
  const out = review(delivered());
  const keys = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) { keys.add(key); walk(child); }
  };
  walk(out);
  for (const forbidden of ['priority_score','scheduled_action','need_action','weekly_view','next_week_plan']) {
    assert.equal(keys.has(forbidden), false, `forbidden field: ${forbidden}`);
  }
  assert.doesNotMatch(out.interpretation, /caused the improvement|caused the decline|because of this intervention/i);
});
