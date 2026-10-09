const UNKNOWN = 'UNKNOWN';

export const ERROR_MECHANISMS = Object.freeze([
  'CONCEPT_GAP',
  'PREREQUISITE_GAP',
  'PROCEDURE_ERROR',
  'STRATEGY',
  'MISREAD_QUESTION',
  'CALCULATION_ERROR',
  'LANGUAGE_CONFUSION',
  'CARELESS_ERROR',
  'TIME'
]);

function required(value, name) {
  if (value === undefined || value === null || value === '') throw new Error(`MISSING_REQUIRED:${name}`);
  return value;
}

function unique(values) {
  return [...new Set(values)];
}

function matchesConcept(evidence, concept) {
  return evidence?.target?.concept_id === concept.concept_id &&
    evidence?.target?.concept_version === concept.concept_version;
}

function trustworthyForDiagnosis(record) {
  const e = record?.evidence;
  const q = record?.eligibility;
  if (!e || !q || q.evidence_id !== e.evidence_id) return false;
  return e.data_status?.status === 'ACTIVE' &&
    q.checks?.provenance_traceable === 'PASS' &&
    q.checks?.target_mapping_valid === 'PASS' &&
    q.checks?.item_rubric_trustworthy === 'PASS' &&
    q.checks?.grading_sufficient === 'PASS' &&
    q.checks?.duplicate_excluded === 'PASS' &&
    q.checks?.active_status === 'PASS';
}

function supportedError(record) {
  if (!trustworthyForDiagnosis(record)) return false;
  const e = record.evidence;
  return e.result?.criterion_result === 'INCORRECT' &&
    e.interpretation?.status === 'VERIFIED' &&
    ERROR_MECHANISMS.includes(e.interpretation?.error_hypothesis);
}

function contextOnly(record) {
  return record?.eligibility?.rights?.CONTEXT_OK === 'GRANTED' && !trustworthyForDiagnosis(record);
}

function disputeRecords(records) {
  return records.filter((record) => {
    const e = record?.evidence;
    const q = record?.eligibility;
    if (!e || !q) return false;
    const status = e.data_status?.status;
    if (['SUPERSEDED', 'RETRACTED'].includes(status)) return false;
    if (status === 'HELD') return true;
    if (status !== 'ACTIVE') return false;
    return q.checks?.item_rubric_trustworthy === 'FAIL' ||
      q.checks?.grading_sufficient === 'FAIL';
  });
}

function diagnosisFromErrors(records) {
  const errors = records.filter(supportedError);
  const byMechanism = new Map();
  for (const record of errors) {
    const mechanism = record.evidence.interpretation.error_hypothesis;
    if (!byMechanism.has(mechanism)) byMechanism.set(mechanism, []);
    byMechanism.get(mechanism).push(record);
  }

  const hypotheses = [...byMechanism.keys()].sort();
  if (!hypotheses.length) {
    return { status: 'NO_SUPPORTED_PATTERN', hypothesis: UNKNOWN, candidate_hypotheses: [], evidence_ids: [] };
  }

  if (hypotheses.length > 1) {
    return {
      status: 'AMBIGUOUS_MECHANISMS',
      hypothesis: UNKNOWN,
      candidate_hypotheses: hypotheses,
      evidence_ids: unique(errors.map((r) => r.evidence.evidence_id))
    };
  }

  const hypothesis = hypotheses[0];
  const rs = byMechanism.get(hypothesis);
  const sessions = unique(rs.map((r) => r.evidence.session_id));
  return {
    status: sessions.length >= 2 ? 'REPEATED_PATTERN' : 'SIGNAL',
    hypothesis,
    candidate_hypotheses: [hypothesis],
    evidence_ids: unique(rs.map((r) => r.evidence.evidence_id))
  };
}

function sourceComparabilityKey(record) {
  const e = record.evidence;
  const values = [
    e.target?.scope,
    e.target?.rubric_version,
    e.target?.relative_difficulty,
    e.conditions?.response_modality,
    e.conditions?.time_limit,
    e.help?.level,
    e.attempt?.retry_relation,
    e.attempt?.answer_exposure,
    e.conditions?.fatigue,
    e.conditions?.interruption
  ];
  if (values.some((v) => !v || v === UNKNOWN)) return UNKNOWN;
  return values.join('|');
}

function sourceOutcome(record) {
  const result = record.evidence.result?.criterion_result;
  if (result === 'CORRECT') return 'SUCCESS';
  if (result === 'INCORRECT') return 'FAILURE';
  return 'UNRESOLVED';
}

function buildSourceConflict(records) {
  const accepted = records.filter(trustworthyForDiagnosis);
  const groups = new Map();
  for (const record of accepted) {
    const key = sourceComparabilityKey(record);
    if (key === UNKNOWN) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  const comparisons = [];
  const conflicts = [];
  for (const [key, rs] of groups.entries()) {
    const bySource = new Map();
    for (const record of rs) {
      const source = record.evidence.provenance?.source_kind ?? 'OTHER';
      if (!bySource.has(source)) bySource.set(source, []);
      bySource.get(source).push(record);
    }
    if (bySource.size < 2) continue;

    const assertions = [...bySource.entries()].map(([source, sourceRecords]) => {
      const outcomes = sourceRecords.map(sourceOutcome).filter((v) => v !== 'UNRESOLVED');
      let assertion = 'MIXED_OR_UNRESOLVED';
      if (outcomes.length && outcomes.every((v) => v === 'SUCCESS')) assertion = 'SUCCESS_ONLY';
      if (outcomes.length && outcomes.every((v) => v === 'FAILURE')) assertion = 'FAILURE_ONLY';
      return {
        source_kind: source,
        assertion,
        evidence_ids: sourceRecords.map((r) => r.evidence.evidence_id)
      };
    });

    const kinds = unique(assertions.map((a) => a.assertion).filter((a) => a !== 'MIXED_OR_UNRESOLVED'));
    const conflict = kinds.includes('SUCCESS_ONLY') && kinds.includes('FAILURE_ONLY');
    const comparison = { comparability_key: key, assertions, conflict };
    comparisons.push(comparison);
    if (conflict) conflicts.push(comparison);
  }

  const acceptedSources = unique(accepted.map((r) => r.evidence.provenance?.source_kind ?? 'OTHER'));
  const nonComparableSources = unique(records
    .filter(trustworthyForDiagnosis)
    .filter((r) => sourceComparabilityKey(r) === UNKNOWN)
    .map((r) => r.evidence.provenance?.source_kind ?? 'OTHER'));
  const multipleSourcesWithoutComparableGroup = acceptedSources.length >= 2 && comparisons.length === 0;

  return {
    status: conflicts.length ? 'CONFLICT' : (comparisons.length ? 'NO_CONFLICT_OBSERVED' : (multipleSourcesWithoutComparableGroup || nonComparableSources.length ? 'NON_COMPARABLE' : 'INSUFFICIENT_MULTI_SOURCE_DATA')),
    conflicts,
    comparisons,
    non_comparable_sources: multipleSourcesWithoutComparableGroup ? acceptedSources : nonComparableSources,
    winner: 'NONE_SELECTED'
  };
}

function makeDiscriminatingOpportunity({ concept, diagnosis, sourceConflict }) {
  const sourceConflictNeeded = sourceConflict.status === 'CONFLICT';
  const mechanismNeeded = diagnosis.status === 'AMBIGUOUS_MECHANISMS';
  if (!sourceConflictNeeded && !mechanismNeeded) {
    return { needed: false, reason: 'NO_DISCRIMINATION_REQUIRED', candidate_hypotheses: [], requested_conditions: {} };
  }

  return {
    needed: true,
    reason: sourceConflictNeeded ? 'RESOLVE_SAME_SCOPE_SOURCE_CONFLICT' : 'DISTINGUISH_SUPPORTED_MECHANISMS',
    concept_id: concept.concept_id,
    concept_version: concept.concept_version,
    candidate_hypotheses: diagnosis.candidate_hypotheses,
    requested_conditions: {
      fresh_opportunity: true,
      first_attempt: 'YES',
      answer_exposure: 'NONE_OBSERVED',
      help_level: 'NONE_OBSERVED_IF_FEASIBLE',
      observed_at: 'KNOWN',
      rubric: 'MATCH_CLAIM_SCOPE',
      response_modality: 'MATCH_CONFLICTING_SCOPE_WHEN_RESOLVING_SOURCE_CONFLICT'
    },
    requested_observations: ['learner_response', 'help_timing', 'evidence_span', 'item_or_rubric_reference']
  };
}

export function buildDiagnosisReadModel(input) {
  const diagnosisId = required(input.diagnosisId, 'diagnosisId');
  const learnerId = required(input.learnerId, 'learnerId');
  const concept = required(input.concept, 'concept');
  required(concept.concept_id, 'concept.concept_id');
  required(concept.concept_version, 'concept.concept_version');
  const asOf = required(input.asOf, 'asOf');
  const policyVersion = required(input.policyVersion, 'policyVersion');

  const mapped = (input.records ?? []).filter((r) => matchesConcept(r.evidence, concept));
  const diagnosis = diagnosisFromErrors(mapped);
  const sourceConflict = buildSourceConflict(mapped);
  const disputes = disputeRecords(mapped);
  const contextSignals = mapped.filter(contextOnly).map((r) => ({
    evidence_id: r.evidence.evidence_id,
    source_kind: r.evidence.provenance?.source_kind ?? 'OTHER',
    note: 'Context signal only; not used for strong learner diagnosis.'
  }));

  let status = diagnosis.status;
  if (sourceConflict.status === 'CONFLICT') status = 'CONFLICT';
  else if (status === 'NO_SUPPORTED_PATTERN' && disputes.length) status = 'QUALITY_DISPUTE';

  const limitations = unique([
    ...(disputes.length ? ['Some mapped evidence is HELD or has unresolved item/rubric/grading quality; it is excluded from strong learner diagnosis.'] : []),
    ...(contextSignals.length ? ['Some evidence is context-only and cannot support a strong diagnosis.'] : []),
    ...(sourceConflict.status === 'NON_COMPARABLE' ? ['Available source evidence lacks enough matched conditions for a valid source conflict comparison.'] : []),
    'Diagnosis is a supported hypothesis about observed work, not a learner personality trait or causal proof.'
  ]);

  const discrimination = makeDiscriminatingOpportunity({ concept, diagnosis, sourceConflict });

  return {
    contract_version: 'DIAGNOSIS_READ_MODEL/1.0',
    diagnosis_id: diagnosisId,
    learner_id: learnerId,
    concept: {
      concept_id: concept.concept_id,
      concept_version: concept.concept_version,
      subject: concept.subject ?? UNKNOWN,
      scope: concept.scope ?? UNKNOWN
    },
    as_of: asOf,
    policy_version: policyVersion,
    status,
    hypothesis: status === 'CONFLICT' || status === 'QUALITY_DISPUTE' ? UNKNOWN : diagnosis.hypothesis,
    candidate_hypotheses: diagnosis.candidate_hypotheses,
    diagnosis_evidence_ids: diagnosis.evidence_ids,
    source_conflict: sourceConflict,
    dispute: {
      status: disputes.length ? 'HELD_OR_QUALITY_UNRESOLVED' : 'NONE_OBSERVED',
      evidence_ids: disputes.map((r) => r.evidence.evidence_id),
      hold_required_for_strong_conclusion: disputes.length > 0
    },
    context_signals: contextSignals,
    discriminating_opportunity: discrimination,
    limitations
  };
}
