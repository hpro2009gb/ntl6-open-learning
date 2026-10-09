const UNKNOWN = 'UNKNOWN';

function required(value, name) {
  if (value === undefined || value === null || value === '') throw new Error(`MISSING_REQUIRED:${name}`);
  return value;
}

function unique(values) {
  return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
}

function matchesConcept(evidence, concept) {
  return evidence?.target?.concept_id === concept.concept_id &&
    evidence?.target?.concept_version === concept.concept_version;
}

function eligible(record, right) {
  return record?.eligibility?.evidence_id === record?.evidence?.evidence_id &&
    record?.eligibility?.rights?.[right] === 'GRANTED';
}

function isCorrect(record) {
  return record?.evidence?.result?.criterion_result === 'CORRECT';
}

function meaningfulVariant(record) {
  const itemFamily = record.evidence.target?.item_family ?? UNKNOWN;
  const transferType = record.evidence.interpretation?.transfer_type ?? UNKNOWN;
  if (transferType !== UNKNOWN && transferType !== 'NONE') return `${itemFamily}|${transferType}`;
  return itemFamily;
}

function knownDates(records) {
  return unique(records.map((r) => r.evidence.observed_at).filter((v) => v && v !== UNKNOWN));
}

function latestKnownDate(records) {
  const dates = knownDates(records).sort();
  return dates.length ? dates.at(-1) : UNKNOWN;
}

function errorMechanismRecords(records) {
  return records.filter((record) => {
    const e = record.evidence;
    return record.eligibility?.checks?.duplicate_excluded === 'PASS' &&
      record.eligibility?.checks?.target_mapping_valid === 'PASS' &&
      record.eligibility?.checks?.item_rubric_trustworthy === 'PASS' &&
      record.eligibility?.checks?.grading_sufficient === 'PASS' &&
      e?.data_status?.status === 'ACTIVE' &&
      e?.result?.criterion_result === 'INCORRECT' &&
      e?.interpretation?.status === 'VERIFIED' &&
      e?.interpretation?.error_hypothesis &&
      e.interpretation.error_hypothesis !== UNKNOWN;
  });
}

function buildConcern(records, conflictIds) {
  if (conflictIds.length) {
    return { status: 'CONFLICT', mechanism: UNKNOWN, evidence_ids: [], conflict_ids: unique(conflictIds) };
  }

  const errors = errorMechanismRecords(records);
  if (!errors.length) return { status: 'NONE_OBSERVED', mechanism: UNKNOWN, evidence_ids: [], conflict_ids: [] };

  const byMechanism = new Map();
  for (const record of errors) {
    const mechanism = record.evidence.interpretation.error_hypothesis;
    if (!byMechanism.has(mechanism)) byMechanism.set(mechanism, []);
    byMechanism.get(mechanism).push(record);
  }

  const repeated = [...byMechanism.entries()].filter(([, rs]) => unique(rs.map((r) => r.evidence.session_id)).length >= 2);
  if (repeated.length) {
    const mechanism = repeated.length === 1 ? repeated[0][0] : UNKNOWN;
    const ids = repeated.flatMap(([, rs]) => rs.map((r) => r.evidence.evidence_id));
    return { status: 'REPEATED_PATTERN', mechanism, evidence_ids: unique(ids), conflict_ids: [] };
  }

  const mechanisms = [...byMechanism.keys()];
  return {
    status: 'SIGNAL',
    mechanism: mechanisms.length === 1 ? mechanisms[0] : UNKNOWN,
    evidence_ids: unique(errors.map((r) => r.evidence.evidence_id)),
    conflict_ids: []
  };
}

export function buildConceptState(input) {
  const learnerId = required(input.learnerId, 'learnerId');
  const concept = required(input.concept, 'concept');
  required(concept.concept_id, 'concept.concept_id');
  required(concept.concept_version, 'concept.concept_version');
  const snapshotId = required(input.snapshotId, 'snapshotId');
  const asOf = required(input.asOf, 'asOf');
  const policyVersion = required(input.policyVersion, 'policyVersion');
  const conflictIds = unique(input.conflictIds ?? []);

  const records = (input.records ?? []).filter((r) => matchesConcept(r.evidence, concept));
  const independentCorrect = records.filter((r) => eligible(r, 'INDEPENDENCE_OK') && isCorrect(r));
  const assistedCorrect = records.filter((r) => eligible(r, 'ASSISTED_PROGRESS_OK') && isCorrect(r));

  const independentSessions = unique(independentCorrect.map((r) => r.evidence.session_id));
  const independentVariants = unique(independentCorrect.map(meaningfulVariant).filter((v) => v !== UNKNOWN));
  const hasFreshStyle = independentCorrect.some((r) =>
    r.evidence.attempt?.retry_relation === 'FRESH' ||
    ![UNKNOWN, 'NONE'].includes(r.evidence.interpretation?.transfer_type)
  );

  let demonstrationStatus = 'UNKNOWN';
  if (independentCorrect.length) demonstrationStatus = 'INDEPENDENT_OBSERVED';
  else if (assistedCorrect.length) demonstrationStatus = 'ASSISTED_ONLY';

  if (
    independentCorrect.length >= 2 &&
    independentSessions.length >= 2 &&
    independentVariants.length >= 2 &&
    hasFreshStyle &&
    conflictIds.length === 0
  ) {
    demonstrationStatus = 'INDEPENDENT_CONFIRMED';
  }

  const transferCorrect = records.filter((r) => eligible(r, 'TRANSFER_OK') && isCorrect(r));
  const transferSessions = unique(transferCorrect.map((r) => r.evidence.session_id));
  const transferVariants = unique(transferCorrect.map(meaningfulVariant).filter((v) => v !== UNKNOWN));
  let transferStatus = 'NOT_CHECKED';
  if (transferCorrect.length) transferStatus = 'OBSERVED';
  if (transferCorrect.length >= 2 && transferSessions.length >= 2 && transferVariants.length >= 2 && conflictIds.length === 0) {
    transferStatus = 'CONFIRMED_IN_SCOPE';
  }

  const retentionEligible = records.filter((r) => eligible(r, 'RETENTION_OK'));
  const retentionCorrect = retentionEligible.filter(isCorrect);
  const retentionIncorrect = retentionEligible.filter((r) => r.evidence.result?.criterion_result === 'INCORRECT');
  let retentionStatus = input.retentionCheckPending ? 'CHECK_PENDING' : 'NOT_CHECKED';
  if (retentionCorrect.length) retentionStatus = 'OBSERVED_AT_DELAY';
  if (retentionIncorrect.length) retentionStatus = 'CONCERN';

  const concern = buildConcern(records, conflictIds);
  const consideredEvidenceIds = unique(records.map((r) => r.evidence.evidence_id));
  const eligibilityIds = unique(records.map((r) => r.eligibility?.eligibility_id).filter(Boolean));
  const limitations = unique([
    ...(records.length === 0 ? ['No mapped evidence for this concept/version.'] : []),
    ...(demonstrationStatus === 'INDEPENDENT_OBSERVED' ? ['Independent performance observed but not yet confirmed across required sessions/variants.'] : []),
    ...(transferStatus === 'NOT_CHECKED' ? ['Transfer has not been checked with eligible meaningful variants.'] : []),
    ...(retentionStatus === 'NOT_CHECKED' ? ['Retention has not been checked at a known delay.'] : []),
    ...(conflictIds.length ? ['Material conflict remains unresolved; confirmation is bounded until resolved.'] : [])
  ]);

  const nextCheckReason = input.nextCheckReason ?? (
    conflictIds.length ? 'Resolve material conflict with the smallest discriminating opportunity.' :
    demonstrationStatus === 'UNKNOWN' ? 'Collect a representative opportunity in the concept scope.' :
    demonstrationStatus === 'ASSISTED_ONLY' ? 'Collect a fresh opportunity without answer-specific help.' :
    demonstrationStatus === 'INDEPENDENT_OBSERVED' ? 'Collect another independent meaningful variant in a separate session.' :
    transferStatus === 'NOT_CHECKED' ? 'Check a meaningful transfer variant when workload allows.' :
    retentionStatus === 'NOT_CHECKED' ? 'Schedule a delayed recheck when appropriate.' :
    'No immediate state-confirmation check required.'
  );

  return {
    contract_version: 'CONCEPT_STATE/1.0',
    state_id: `state-${snapshotId}-${concept.concept_id}`,
    learner_id: learnerId,
    concept: {
      concept_id: concept.concept_id,
      concept_version: concept.concept_version,
      subject: required(concept.subject, 'concept.subject'),
      scope: required(concept.scope, 'concept.scope'),
      rubric_ref: concept.rubric_ref ?? UNKNOWN,
      prerequisite_ids: unique(concept.prerequisite_ids ?? [])
    },
    demonstration: {
      status: demonstrationStatus,
      evidence_ids: unique(independentCorrect.length ? independentCorrect.map((r) => r.evidence.evidence_id) : assistedCorrect.map((r) => r.evidence.evidence_id)),
      observed_dates: knownDates(independentCorrect.length ? independentCorrect : assistedCorrect),
      covered_variants: independentVariants
    },
    transfer: {
      status: transferStatus,
      evidence_ids: unique(transferCorrect.map((r) => r.evidence.evidence_id)),
      covered_scope: transferCorrect.length ? unique(transferCorrect.map((r) => r.evidence.target.scope)).join(' | ') : 'NOT_CHECKED',
      meaningful_variants: transferVariants
    },
    retention: {
      status: retentionStatus,
      evidence_ids: unique(retentionEligible.map((r) => r.evidence.evidence_id)),
      last_known_exposure_at: latestKnownDate(records),
      delay_description: retentionEligible.length ? unique(retentionEligible.map((r) => r.evidence.interpretation.transfer_type)).join(' | ') : UNKNOWN,
      intervening_practice: input.interveningPractice ?? 'UNKNOWN'
    },
    concern,
    decision_basis: {
      snapshot_id: snapshotId,
      as_of: asOf,
      policy_version: policyVersion,
      evidence_ids: consideredEvidenceIds,
      eligibility_ids: eligibilityIds,
      limitations,
      conflicts: conflictIds,
      next_check_reason: nextCheckReason
    }
  };
}
