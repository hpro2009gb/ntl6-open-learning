const NOT_APPLICABLE = 'NOT_APPLICABLE';
const UNKNOWN = 'UNKNOWN';
const DELIVERY = new Set(['STARTED','COMPLETED','INTERRUPTED','NOT_DELIVERED']);
const TEACHERS = new Set(['PARENT','AGENT','OTHER']);
const AXES = Object.freeze(['ACCURACY','INDEPENDENCE','TRANSFER','RETENTION','FLUENCY','BURDEN']);
const AXIS_RESULTS = new Set(['IMPROVED','NO_OBSERVED_CHANGE','WORSE','INCONCLUSIVE','NOT_ASSESSED']);

function required(value, name) {
  if (value === undefined || value === null || value === '') throw new Error(`MISSING_REQUIRED:${name}`);
  return value;
}

function unique(values) {
  return [...new Set((values ?? []).filter((v) => v !== undefined && v !== null && v !== ''))];
}

function plannedDose(decision) {
  const dose = decision?.dose;
  if (!dose) return UNKNOWN;
  return `${dose.class}:${dose.minutes}m`;
}

function validateDeliveryTiming(status, startedAt, completedAt) {
  if (status === 'NOT_DELIVERED') return { started_at: NOT_APPLICABLE, completed_at: NOT_APPLICABLE };
  const started = required(startedAt, 'startedAt');
  if (status === 'COMPLETED') return { started_at: started, completed_at: required(completedAt, 'completedAt') };
  return { started_at: started, completed_at: completedAt ?? NOT_APPLICABLE };
}

export function createDeliveredIntervention(input) {
  const interventionId = required(input.interventionId, 'interventionId');
  const decision = required(input.decision, 'decision');
  const status = required(input.deliveryStatus, 'deliveryStatus');
  if (!DELIVERY.has(status)) throw new Error(`INVALID_DELIVERY_STATUS:${status}`);
  const teacher = required(input.teacher, 'teacher');
  if (!TEACHERS.has(teacher)) throw new Error(`INVALID_TEACHER:${teacher}`);

  const timing = validateDeliveryTiming(status, input.startedAt, input.completedAt);
  const notDelivered = status === 'NOT_DELIVERED';
  const actualMethod = notDelivered ? 'NOT_DELIVERED' : required(input.actualMethod, 'actualMethod');
  const actualDose = notDelivered ? '0m' : required(input.actualDose, 'actualDose');

  return {
    contract_version: 'DELIVERED_INTERVENTION/1.0',
    intervention_id: interventionId,
    decision_id: required(decision.decision_id, 'decision.decision_id'),
    learner_id: required(decision.learner_id, 'decision.learner_id'),
    concept_id: required(decision.concept_id, 'decision.concept_id'),
    mechanism_hypothesis: unique(decision.hypotheses ?? []).join(' | ') || UNKNOWN,
    planned_method: required(decision.scheduled_action, 'decision.scheduled_action'),
    planned_dose: plannedDose(decision),
    actual_method: actualMethod,
    actual_dose: actualDose,
    delivery_status: status,
    teacher,
    started_at: timing.started_at,
    completed_at: timing.completed_at,
    modifications: unique(input.modifications ?? []),
    concurrent_exposures: unique(input.concurrentExposures ?? []),
    generated_evidence_ids: unique(input.generatedEvidenceIds ?? [])
  };
}

function normalizedAxisResults(expectedAxes, comparisons) {
  const all = Object.fromEntries(AXES.map((axis) => [axis, 'NOT_ASSESSED']));
  for (const axis of expectedAxes) {
    if (!AXES.includes(axis)) throw new Error(`INVALID_EXPECTED_AXIS:${axis}`);
    const value = comparisons?.[axis] ?? 'INCONCLUSIVE';
    if (!AXIS_RESULTS.has(value)) throw new Error(`INVALID_AXIS_RESULT:${axis}:${value}`);
    all[axis] = value;
  }
  return all;
}

function overallStatus(deliveryStatus, expectedAxes, axisResults) {
  if (deliveryStatus === 'NOT_DELIVERED') return 'NOT_DELIVERED';
  if (deliveryStatus === 'STARTED' || deliveryStatus === 'INTERRUPTED') return 'INCONCLUSIVE';
  if (!expectedAxes.length) return 'INCONCLUSIVE';

  const values = expectedAxes.map((axis) => axisResults[axis]);
  if (values.some((v) => ['INCONCLUSIVE','NOT_ASSESSED'].includes(v))) return 'INCONCLUSIVE';
  const improved = values.filter((v) => v === 'IMPROVED').length;
  const worse = values.filter((v) => v === 'WORSE').length;
  if (improved && worse) return 'INCONCLUSIVE';
  if (improved && !worse) return 'IMPROVED_ON_TARGET';
  if (worse && !improved) return 'WORSE_ON_TARGET';
  if (values.every((v) => v === 'NO_OBSERVED_CHANGE')) return 'NO_OBSERVED_CHANGE';
  return 'INCONCLUSIVE';
}

function fuse({ priorCount, priorMethod, intervention, outcomeStatus }) {
  const sameMethod = !priorMethod || priorMethod === intervention.actual_method;
  let count = sameMethod ? priorCount : 0;
  if (intervention.delivery_status === 'COMPLETED') {
    if (outcomeStatus === 'IMPROVED_ON_TARGET') count = 0;
    else if (['NO_OBSERVED_CHANGE','WORSE_ON_TARGET'].includes(outcomeStatus)) count += 1;
  }

  if (count > 2) {
    return { same_method_delivered_no_improvement_count: count, automatic_repeat_allowed: false, next_required_action: 'HUMAN_DECISION' };
  }
  if (count === 2) {
    return { same_method_delivered_no_improvement_count: count, automatic_repeat_allowed: false, next_required_action: 'DIAGNOSE' };
  }
  return { same_method_delivered_no_improvement_count: count, automatic_repeat_allowed: true, next_required_action: 'NONE' };
}

function conditionalInterpretation(status, intervention) {
  const prefix = intervention.delivery_status === 'COMPLETED'
    ? 'After the recorded completed intervention, '
    : 'For this recorded intervention, ';
  const suffix = ' This is an observational before/after statement under the recorded conditions and does not establish that the intervention caused the change.';
  const map = {
    IMPROVED_ON_TARGET: `${prefix}improvement was observed on the expected target axis or axes.${suffix}`,
    NO_OBSERVED_CHANGE: `${prefix}no change was observed on the expected target axis or axes.${suffix}`,
    WORSE_ON_TARGET: `${prefix}worse performance was observed on the expected target axis or axes.${suffix}`,
    INCONCLUSIVE: `${prefix}the available comparison is inconclusive, so no efficacy conclusion is supported.${suffix}`,
    NOT_DELIVERED: 'The planned intervention was not delivered, so no strategy-efficacy inference is made.'
  };
  return map[status];
}

export function reviewStrategyOutcome(input) {
  const outcomeId = required(input.outcomeId, 'outcomeId');
  const decision = required(input.decision, 'decision');
  const intervention = required(input.intervention, 'intervention');
  if (intervention.decision_id !== decision.decision_id) throw new Error('DECISION_INTERVENTION_MISMATCH');
  const expectedAxes = unique(input.expectedAxes ?? []);
  const axisResults = normalizedAxisResults(expectedAxes, input.axisComparisons ?? {});
  const status = overallStatus(intervention.delivery_status, expectedAxes, axisResults);
  const comparisonBasis = required(input.comparisonBasis, 'comparisonBasis');
  const priorCount = Number.isInteger(input.priorSameMethodNoImprovementCount) && input.priorSameMethodNoImprovementCount >= 0
    ? input.priorSameMethodNoImprovementCount
    : 0;

  const knownContributors = unique([
    ...(input.knownContributors ?? []),
    ...(intervention.concurrent_exposures ?? [])
  ]);
  const limitations = unique([
    ...(input.limitations ?? []),
    ...(intervention.modifications?.length ? ['Delivered method/dose included modifications from the plan; interpretation is limited to the actual recorded delivery.'] : []),
    ...(intervention.concurrent_exposures?.length ? ['Concurrent exposures were recorded; before/after change cannot be attributed uniquely to this intervention.'] : []),
    ...(intervention.delivery_status === 'NOT_DELIVERED' ? ['Intervention was not delivered; efficacy cannot be evaluated.'] : []),
    ...(intervention.delivery_status === 'INTERRUPTED' || intervention.delivery_status === 'STARTED' ? ['Intervention was not completed; efficacy review is inconclusive.'] : []),
    ...(expectedAxes.some((axis) => ['INCONCLUSIVE','NOT_ASSESSED'].includes(axisResults[axis])) ? ['At least one expected outcome axis is unresolved or not assessed.'] : [])
  ]);

  return {
    contract_version: 'STRATEGY_OUTCOME/1.0',
    outcome_id: outcomeId,
    decision_id: required(decision.decision_id, 'decision.decision_id'),
    intervention_id: required(intervention.intervention_id, 'intervention.intervention_id'),
    learner_id: required(decision.learner_id, 'decision.learner_id'),
    concept_id: required(decision.concept_id, 'decision.concept_id'),
    policy_version: required(input.policyVersion, 'policyVersion'),
    reviewed_at: required(input.reviewedAt, 'reviewedAt'),
    status,
    expected_axes: expectedAxes,
    axis_results: axisResults,
    comparison_basis: comparisonBasis,
    known_contributors: knownContributors,
    limitations,
    interpretation: conditionalInterpretation(status, intervention),
    third_repeat_fuse: fuse({
      priorCount,
      priorMethod: input.priorMethod,
      intervention,
      outcomeStatus: status
    })
  };
}
