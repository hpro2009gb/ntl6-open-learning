const UNKNOWN = 'UNKNOWN';
const ACTIONS = Object.freeze(['DIAGNOSE','RETEACH','REPAIR','RECHECK','MAINTAIN','ADVANCE']);
const REPAIR_MECHANISMS = new Set(['PROCEDURE_ERROR','STRATEGY','MISREAD_QUESTION','CALCULATION_ERROR','LANGUAGE_CONFUSION','CARELESS_ERROR','TIME']);
const RETEACH_MECHANISMS = new Set(['CONCEPT_GAP','PREREQUISITE_GAP']);

function required(value, name) {
  if (value === undefined || value === null || value === '') throw new Error(`MISSING_REQUIRED:${name}`);
  return value;
}

function unique(values) {
  return [...new Set(values.filter((v) => v !== undefined && v !== null && v !== ''))];
}

function chooseNeedAction({ state, diagnosis, priority }) {
  if (['CONFLICT','QUALITY_DISPUTE','AMBIGUOUS_MECHANISMS'].includes(diagnosis?.status) || priority?.flags?.unresolved_conflict) {
    return { action: 'DIAGNOSE', reason: 'Resolve material uncertainty before teaching or progression.' };
  }

  if (diagnosis?.status === 'REPEATED_PATTERN') {
    if (RETEACH_MECHANISMS.has(diagnosis.hypothesis)) {
      return { action: 'RETEACH', reason: `Repeated supported ${diagnosis.hypothesis} indicates understanding/prerequisite repair is needed.` };
    }
    if (REPAIR_MECHANISMS.has(diagnosis.hypothesis)) {
      return { action: 'REPAIR', reason: `Repeated supported ${diagnosis.hypothesis} indicates a bounded skill/process repair need.` };
    }
    return { action: 'DIAGNOSE', reason: 'Repeated pattern exists but mechanism is not safely actionable.' };
  }

  if (diagnosis?.status === 'SIGNAL') {
    return { action: 'RECHECK', reason: 'A single supported signal should be independently checked before escalation.' };
  }

  if (priority?.flags?.verification_due || priority?.flags?.retention_due) {
    return { action: 'RECHECK', reason: 'Fresh evidence is due before changing the learning state.' };
  }

  if (priority?.flags?.advance_readiness) {
    return { action: 'ADVANCE', reason: 'Confirmed demonstration and transfer with approved advance scope support progression.' };
  }

  if (state?.demonstration?.status === 'UNKNOWN' || state?.demonstration?.status === 'ASSISTED_ONLY') {
    return { action: 'DIAGNOSE', reason: 'Independent learner evidence is insufficient to choose a stronger teaching action.' };
  }

  if (state?.demonstration?.status === 'INDEPENDENT_CONFIRMED' && state?.transfer?.status === 'NOT_CHECKED') {
    return { action: 'RECHECK', reason: 'Independent performance is confirmed but meaningful transfer still needs checking.' };
  }

  return { action: 'MAINTAIN', reason: 'Current evidence supports light maintenance rather than escalation.' };
}

function scheduleAction(needAction, workload) {
  const band = workload?.capacity_band ?? 'REST';
  const remaining = Number.isFinite(workload?.remaining_minutes) ? workload.remaining_minutes : 0;
  if (band === 'REST' || remaining <= 0) return 'PAUSE';
  if (band === 'MICRO' && ['RETEACH','ADVANCE'].includes(needAction)) return 'PAUSE';
  return needAction;
}

function doseFor(workload, scheduledAction) {
  const band = workload?.capacity_band ?? 'REST';
  const remaining = Number.isFinite(workload?.remaining_minutes) ? Math.max(0, workload.remaining_minutes) : 0;
  if (scheduledAction === 'PAUSE' || band === 'REST') return { class: 'REST', minutes: 0 };
  if (band === 'MICRO') return { class: 'MICRO', minutes: Math.min(10, remaining) };
  if (band === 'DEEP') return { class: 'DEEP', minutes: Math.min(45, remaining) };
  return { class: 'NORMAL', minutes: Math.min(20, remaining) };
}

function expectedChange(action) {
  const map = {
    DIAGNOSE: 'Reduce uncertainty by obtaining evidence that distinguishes the current supported hypotheses or conflict.',
    RETEACH: 'Look for improved independent explanation or representative work after the concept/prerequisite is taught again.',
    REPAIR: 'Look for fewer repeats of the supported skill/process error on fresh representative work.',
    RECHECK: 'Obtain fresh independent evidence without answer-specific help.',
    MAINTAIN: 'Preserve current independent performance with low-volume spaced evidence.',
    ADVANCE: 'Observe performance in the next parent-approved scope while retaining prior-scope evidence.'
  };
  return map[action];
}

function recheckCondition(action) {
  const map = {
    DIAGNOSE: 'Review after the smallest discriminating opportunity has been completed and graded reliably.',
    RETEACH: 'Review on a fresh independent representative item after reteaching, not on the taught example.',
    REPAIR: 'Review on a fresh item that exercises the repaired process without answer-specific help.',
    RECHECK: 'Review immediately after the fresh independent recheck evidence is captured.',
    MAINTAIN: 'Review at the next spaced maintenance checkpoint or if a new concern appears.',
    ADVANCE: 'Review after bounded work in the approved next scope and a fresh prior-scope maintenance check.'
  };
  return map[action];
}

function contraryEvidenceIds(diagnosis) {
  const ids = [];
  for (const conflict of diagnosis?.source_conflict?.conflicts ?? []) {
    for (const assertion of conflict.assertions ?? []) ids.push(...(assertion.evidence_ids ?? []));
  }
  return unique(ids);
}

export function buildStrategyDecision(input) {
  const decisionId = required(input.decisionId, 'decisionId');
  const learnerId = required(input.learnerId, 'learnerId');
  const concept = required(input.concept, 'concept');
  required(concept.concept_id, 'concept.concept_id');
  const state = required(input.state, 'state');
  const diagnosis = required(input.diagnosis, 'diagnosis');
  const priority = required(input.priority, 'priority');
  const workload = required(input.workload, 'workload');
  const policyVersion = required(input.policyVersion, 'policyVersion');
  const authorityScopeRef = required(input.authorityScopeRef, 'authorityScopeRef');
  const createdAt = required(input.createdAt, 'createdAt');

  const need = chooseNeedAction({ state, diagnosis, priority });
  if (!ACTIONS.includes(need.action)) throw new Error(`INVALID_NEED_ACTION:${need.action}`);
  const scheduledAction = scheduleAction(need.action, workload);
  const dose = doseFor(workload, scheduledAction);

  const evidenceIds = unique([
    ...(state.decision_basis?.evidence_ids ?? []),
    ...(diagnosis.diagnosis_evidence_ids ?? []),
    ...contraryEvidenceIds(diagnosis)
  ]);
  const eligibilityIds = unique(state.decision_basis?.eligibility_ids ?? []);
  const hypotheses = unique([
    ...(diagnosis.candidate_hypotheses ?? []),
    ...(diagnosis.hypothesis && diagnosis.hypothesis !== UNKNOWN ? [diagnosis.hypothesis] : [])
  ]);
  const unknowns = unique([
    ...(diagnosis.status === 'CONFLICT' ? ['Material source conflict remains unresolved.'] : []),
    ...(diagnosis.status === 'QUALITY_DISPUTE' ? ['Evidence quality dispute remains unresolved.'] : []),
    ...(diagnosis.status === 'AMBIGUOUS_MECHANISMS' ? ['Multiple mechanisms remain plausible.'] : []),
    ...((state.decision_basis?.limitations ?? []).filter((x) => /unknown|not been checked|unresolved/i.test(x)))
  ]);

  const workloadReason = scheduledAction === 'PAUSE'
    ? `Workload capacity ${workload.capacity_band} with ${workload.remaining_minutes ?? 0} min remaining does not permit the current need action today.`
    : `Workload capacity ${workload.capacity_band} allows the need action within a bounded ${dose.class} dose.`;

  return {
    contract_version: 'STRATEGY_DECISION/1.0',
    decision_id: decisionId,
    learner_id: learnerId,
    concept_id: concept.concept_id,
    concept_scope: concept.scope ?? UNKNOWN,
    snapshot_id: required(state.decision_basis?.snapshot_id, 'state.decision_basis.snapshot_id'),
    evidence_ids: evidenceIds,
    eligibility_ids: eligibilityIds,
    policy_version: policyVersion,
    hypotheses,
    unknowns,
    contrary_evidence_ids: contraryEvidenceIds(diagnosis),
    need_action: need.action,
    scheduled_action: scheduledAction,
    dose,
    authority_scope_ref: authorityScopeRef,
    why: `${need.reason} ${workloadReason} Priority reasons: ${(priority.reasons ?? []).join(', ') || 'none recorded'}.`,
    expected_change: expectedChange(need.action),
    recheck_condition: recheckCondition(need.action),
    lifecycle: 'PLANNED',
    created_at: createdAt
  };
}
