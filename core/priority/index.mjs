const UNKNOWN = 'UNKNOWN';

const PRIORITY_ORDINAL = Object.freeze({ HIGH: 2, MEDIUM: 1, LOW: 0, NONE: 0, UNKNOWN: 0 });
const RELEVANCE_ORDINAL = Object.freeze({ HIGH: 2, MEDIUM: 1, LOW: 0, UNKNOWN: 0 });

function required(value, name) {
  if (value === undefined || value === null || value === '') throw new Error(`MISSING_REQUIRED:${name}`);
  return value;
}

function truthyFlag(value) {
  return value === true;
}

function ordinal(value, table) {
  return table[value ?? 'UNKNOWN'] ?? 0;
}

function unresolvedConflict(candidate) {
  return candidate?.diagnosis?.status === 'CONFLICT' || candidate?.state?.concern?.status === 'CONFLICT';
}

function repeatedWeakness(candidate) {
  return candidate?.diagnosis?.status === 'REPEATED_PATTERN' || candidate?.state?.concern?.status === 'REPEATED_PATTERN';
}

function prerequisiteSufficient(candidate) {
  const demo = candidate?.state?.demonstration?.status;
  if (!['INDEPENDENT_OBSERVED', 'INDEPENDENT_CONFIRMED'].includes(demo)) return false;
  if (unresolvedConflict(candidate)) return false;
  if (repeatedWeakness(candidate)) return false;
  if (['QUALITY_DISPUTE', 'AMBIGUOUS_MECHANISMS'].includes(candidate?.diagnosis?.status)) return false;
  return true;
}

function downstreamBlockCount(candidate, candidates) {
  if (prerequisiteSufficient(candidate)) return 0;
  const id = candidate.concept.concept_id;
  return candidates.filter((other) =>
    other !== candidate &&
    truthyFlag(other.meta?.active_target) &&
    (other.concept?.prerequisite_ids ?? []).includes(id)
  ).length;
}

function verificationDue(candidate) {
  if (truthyFlag(candidate.meta?.verification_due)) return true;
  if (candidate?.state?.demonstration?.status === 'INDEPENDENT_OBSERVED') return true;
  if (candidate?.state?.concern?.status === 'SIGNAL') return true;
  return candidate?.diagnosis?.status === 'AMBIGUOUS_MECHANISMS';
}

function retentionDue(candidate) {
  if (truthyFlag(candidate.meta?.retention_due)) return true;
  return candidate?.state?.retention?.status === 'CHECK_PENDING';
}

function advanceReady(candidate) {
  return truthyFlag(candidate.meta?.advance_scope_approved) &&
    candidate?.state?.demonstration?.status === 'INDEPENDENT_CONFIRMED' &&
    candidate?.state?.transfer?.status === 'CONFIRMED_IN_SCOPE' &&
    candidate?.state?.concern?.status === 'NONE_OBSERVED' &&
    ['NO_SUPPORTED_PATTERN', undefined].includes(candidate?.diagnosis?.status) &&
    !unresolvedConflict(candidate) &&
    !repeatedWeakness(candidate);
}

function topClass(flags) {
  if (flags.prerequisite_blocker) return 'PREREQUISITE_BLOCKER';
  if (flags.unresolved_conflict) return 'UNRESOLVED_CONFLICT';
  if (flags.repeated_supported_weakness) return 'REPEATED_SUPPORTED_WEAKNESS';
  if (flags.parent_priority_rank > 0) return 'PARENT_PRIORITY';
  if (flags.exam_relevance_rank > 0) return 'EXAM_RELEVANCE';
  if (flags.verification_due) return 'VERIFICATION_DUE';
  if (flags.retention_due) return 'RETENTION_DUE';
  if (flags.advance_readiness) return 'ADVANCE_READINESS';
  return 'BASELINE';
}

function reasonCodes(flags, meta) {
  const reasons = [];
  if (flags.prerequisite_blocker) reasons.push('PREREQUISITE_BLOCKER');
  if (flags.unresolved_conflict) reasons.push('UNRESOLVED_MATERIAL_CONFLICT');
  if (flags.repeated_supported_weakness) reasons.push('REPEATED_SUPPORTED_WEAKNESS');
  if (flags.parent_priority_rank > 0) reasons.push(`PARENT_PRIORITY_${meta.parent_priority ?? 'UNKNOWN'}`);
  if (flags.exam_relevance_rank > 0) reasons.push(`EXAM_RELEVANCE_${meta.exam_relevance ?? 'UNKNOWN'}`);
  if (flags.verification_due) reasons.push('VERIFICATION_DUE');
  if (flags.retention_due) reasons.push('RETENTION_CHECK_DUE');
  if (flags.advance_readiness) reasons.push('ADVANCE_READINESS');
  if (!reasons.length) reasons.push('NO_SPECIAL_PRIORITY_SIGNAL');
  return reasons;
}

function compareEntries(a, b) {
  const booleans = [
    'prerequisite_blocker',
    'unresolved_conflict',
    'repeated_supported_weakness'
  ];
  for (const key of booleans) {
    if (a.flags[key] !== b.flags[key]) return a.flags[key] ? -1 : 1;
  }

  for (const key of ['parent_priority_rank', 'exam_relevance_rank']) {
    if (a.flags[key] !== b.flags[key]) return b.flags[key] - a.flags[key];
  }

  for (const key of ['verification_due', 'retention_due', 'advance_readiness']) {
    if (a.flags[key] !== b.flags[key]) return a.flags[key] ? -1 : 1;
  }

  if (a.flags.blocked_downstream_count !== b.flags.blocked_downstream_count) {
    return b.flags.blocked_downstream_count - a.flags.blocked_downstream_count;
  }

  return a.concept_id.localeCompare(b.concept_id);
}

function makeEntry(candidate, candidates) {
  const conceptId = required(candidate?.concept?.concept_id, 'candidate.concept.concept_id');
  required(candidate?.concept?.concept_version, 'candidate.concept.concept_version');
  const meta = candidate.meta ?? {};
  const blockedCount = downstreamBlockCount(candidate, candidates);
  const flags = {
    prerequisite_blocker: blockedCount > 0,
    blocked_downstream_count: blockedCount,
    unresolved_conflict: unresolvedConflict(candidate),
    repeated_supported_weakness: repeatedWeakness(candidate),
    parent_priority_rank: ordinal(meta.parent_priority, PRIORITY_ORDINAL),
    exam_relevance_rank: ordinal(meta.exam_relevance, RELEVANCE_ORDINAL),
    verification_due: verificationDue(candidate),
    retention_due: retentionDue(candidate),
    advance_readiness: advanceReady(candidate)
  };

  return {
    concept_id: conceptId,
    concept_version: candidate.concept.concept_version,
    subject: candidate.concept.subject ?? UNKNOWN,
    scope: candidate.concept.scope ?? UNKNOWN,
    priority_class: topClass(flags),
    reasons: reasonCodes(flags, meta),
    flags,
    evidence_refs: {
      state_id: candidate.state?.state_id ?? UNKNOWN,
      diagnosis_id: candidate.diagnosis?.diagnosis_id ?? UNKNOWN,
      trend_id: candidate.trend?.trend_id ?? UNKNOWN
    },
    limitations: [
      ...(candidate.diagnosis?.status === 'QUALITY_DISPUTE' ? ['Priority reflects unresolved evidence quality; it does not convert disputed evidence into learner fact.'] : []),
      ...(unresolvedConflict(candidate) ? ['Material conflict remains unresolved; priority reflects uncertainty, not a selected source winner.'] : [])
    ]
  };
}

export function rankConceptPriorities(input) {
  const prioritySetId = required(input.prioritySetId, 'prioritySetId');
  const asOf = required(input.asOf, 'asOf');
  const policyVersion = required(input.policyVersion, 'policyVersion');
  const candidates = input.candidates ?? [];

  const entries = candidates.map((candidate) => makeEntry(candidate, candidates)).sort(compareEntries);
  return {
    contract_version: 'PRIORITY_READ_MODEL/1.0',
    priority_set_id: prioritySetId,
    as_of: asOf,
    policy_version: policyVersion,
    ordering_policy: [
      'PREREQUISITE_BLOCKER',
      'UNRESOLVED_CONFLICT',
      'REPEATED_SUPPORTED_WEAKNESS',
      'PARENT_PRIORITY',
      'EXAM_RELEVANCE',
      'VERIFICATION_DUE',
      'RETENTION_DUE',
      'ADVANCE_READINESS',
      'CONCEPT_ID_ASC'
    ],
    ranked: entries.map((entry, index) => ({ rank: index + 1, ...entry })),
    limitations: [
      'Ranking is lexicographic and reason-based; there is no weighted aggregate priority score.',
      'Parent/exam relevance is planning context and never upgrades weak evidence into learner truth.',
      'This read model does not allocate time, dose, calendar slots, or strategy actions.'
    ]
  };
}
