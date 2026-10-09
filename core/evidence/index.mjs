import crypto from 'node:crypto';

export const RIGHTS = Object.freeze([
  'CONTEXT_OK',
  'ASSISTED_PROGRESS_OK',
  'INDEPENDENCE_OK',
  'TRANSFER_OK',
  'RETENTION_OK'
]);

const UNKNOWN = 'UNKNOWN';
const NOT_APPLICABLE = 'NOT_APPLICABLE';

function required(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`MISSING_REQUIRED_IDENTITY:${name}`);
  }
  return value;
}

function semantic(value, fallback = UNKNOWN) {
  return value === undefined || value === null || value === '' ? fallback : value;
}

function obj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function makeDedupIdentity(evidence) {
  return [
    required(evidence.learner_id, 'learner_id'),
    required(evidence.opportunity_id, 'opportunity_id'),
    required(evidence.source_identity?.origin_id, 'source_identity.origin_id'),
    required(evidence.source_identity?.dedup_key, 'source_identity.dedup_key')
  ].join('|');
}

export function normalizeOpportunity(candidate, options = {}) {
  const sourceIdentity = obj(candidate.source_identity);
  const provenance = obj(candidate.provenance);
  const target = obj(candidate.target);
  const result = obj(candidate.result);
  const help = obj(candidate.help);
  const attempt = obj(candidate.attempt);
  const conditions = obj(candidate.conditions);
  const interpretation = obj(candidate.interpretation);
  const dataStatus = obj(candidate.data_status);

  const learnerId = required(candidate.learner_id, 'learner_id');
  const opportunityId = required(candidate.opportunity_id, 'opportunity_id');
  const originId = required(sourceIdentity.origin_id, 'source_identity.origin_id');
  const dedupKey = semantic(sourceIdentity.dedup_key, `${learnerId}|${opportunityId}|${originId}`);

  return {
    contract_version: 'EVIDENCE_OPPORTUNITY/1.0',
    evidence_id: required(candidate.evidence_id, 'evidence_id'),
    session_id: required(candidate.session_id, 'session_id'),
    opportunity_id: opportunityId,
    learner_id: learnerId,
    source_identity: {
      origin_id: originId,
      reporting_channel: semantic(sourceIdentity.reporting_channel),
      dedup_key: dedupKey
    },
    observed_at: semantic(candidate.observed_at),
    imported_at: required(candidate.imported_at ?? options.importedAt, 'imported_at'),
    timezone: semantic(candidate.timezone, options.timezone ?? UNKNOWN),
    provenance: {
      source_kind: semantic(provenance.source_kind, 'OTHER'),
      raw_ref: semantic(provenance.raw_ref),
      raw_locator: semantic(provenance.raw_locator),
      capture_completeness: semantic(provenance.capture_completeness)
    },
    target: {
      concept_id: semantic(target.concept_id, 'UNMAPPED'),
      concept_version: semantic(target.concept_version),
      item_id: semantic(target.item_id),
      item_family: semantic(target.item_family),
      rubric_ref: semantic(target.rubric_ref),
      rubric_version: semantic(target.rubric_version),
      scope: semantic(target.scope),
      relative_difficulty: semantic(target.relative_difficulty)
    },
    result: {
      response_ref: semantic(result.response_ref),
      criterion_result: semantic(result.criterion_result, 'UNRESOLVED'),
      grader: semantic(result.grader),
      grading_verification_status: semantic(result.grading_verification_status, 'UNRESOLVED')
    },
    help: {
      level: semantic(help.level),
      source: semantic(help.source),
      timing: semantic(help.timing),
      observation_basis: semantic(help.observation_basis)
    },
    attempt: {
      first_attempt: semantic(attempt.first_attempt),
      retry_relation: semantic(attempt.retry_relation),
      answer_exposure: semantic(attempt.answer_exposure)
    },
    conditions: {
      time_limit: semantic(conditions.time_limit),
      interruption: semantic(conditions.interruption),
      fatigue: semantic(conditions.fatigue),
      response_modality: semantic(conditions.response_modality)
    },
    thinking_tags: arr(candidate.thinking_tags),
    interpretation: {
      error_hypothesis: semantic(interpretation.error_hypothesis),
      evidence_span: semantic(interpretation.evidence_span),
      transfer_type: semantic(interpretation.transfer_type),
      origin: semantic(interpretation.origin, 'RULE'),
      status: semantic(interpretation.status, 'UNRESOLVED'),
      interpretation_version: semantic(interpretation.interpretation_version, options.interpretationVersion ?? 'UNVERSIONED')
    },
    data_status: {
      status: semantic(dataStatus.status, 'ACTIVE'),
      supersedes_id: semantic(dataStatus.supersedes_id, NOT_APPLICABLE),
      reason: semantic(dataStatus.reason, 'Initial normalized record'),
      actor: semantic(dataStatus.actor, 'SYSTEM_OPERATOR'),
      changed_at: semantic(dataStatus.changed_at, NOT_APPLICABLE)
    }
  };
}

function check(condition, unknown = false) {
  if (unknown) return 'UNKNOWN';
  return condition ? 'PASS' : 'FAIL';
}

function allPass(checks, names) {
  return names.every((name) => checks[name] === 'PASS');
}

export function deriveEligibility(evidenceInput, options = {}) {
  const evidence = normalizeOpportunity(evidenceInput, options);
  const duplicateKnown = typeof options.duplicate === 'boolean';
  const duplicate = options.duplicate === true;
  const status = evidence.data_status.status;
  const held = status === 'HELD';
  const inactive = status === 'SUPERSEDED' || status === 'RETRACTED';

  const provenanceUnknown = [evidence.provenance.raw_ref, evidence.provenance.raw_locator].includes(UNKNOWN);
  const authority = obj(options.rubricAuthority);
  const requireRubricAuthority = options.requireRubricAuthority === true;
  const authorityProvided = Object.keys(authority).length > 0;
  const authorityRequested = requireRubricAuthority || authorityProvided;
  const authorityValues = [authority.concept_id, authority.concept_version, authority.rubric_ref, authority.rubric_version];
  const authorityIncomplete = authorityRequested && authorityValues.some((value) => value === undefined || value === null || value === '' || value === UNKNOWN);
  const intrinsicMappingUnknown = evidence.target.concept_id === 'UNMAPPED' || evidence.target.concept_version === UNKNOWN;
  const intrinsicRubricUnknown = evidence.target.rubric_ref === UNKNOWN || evidence.target.rubric_version === UNKNOWN;
  const authorityConceptMismatch = authorityProvided && !authorityIncomplete && (
    evidence.target.concept_id !== authority.concept_id ||
    evidence.target.concept_version !== authority.concept_version
  );
  const authorityRubricMismatch = authorityProvided && !authorityIncomplete && (
    evidence.target.rubric_ref !== authority.rubric_ref ||
    evidence.target.rubric_version !== authority.rubric_version
  );
  const mappingUnknown = intrinsicMappingUnknown || authorityIncomplete;
  const rubricUnknown = intrinsicRubricUnknown || authorityIncomplete;
  const gradingUnknown = evidence.result.criterion_result === 'UNRESOLVED' || ['UNRESOLVED', 'PROPOSED'].includes(evidence.result.grading_verification_status);
  const helpUnknown = evidence.help.level === UNKNOWN || evidence.attempt.retry_relation === UNKNOWN || evidence.attempt.answer_exposure === UNKNOWN || evidence.attempt.first_attempt === UNKNOWN;
  const noveltyUnknown = evidence.attempt.retry_relation === UNKNOWN || evidence.attempt.answer_exposure === UNKNOWN || evidence.attempt.first_attempt === UNKNOWN;

  const checks = {
    provenance_traceable: check(!provenanceUnknown, provenanceUnknown),
    target_mapping_valid: authorityConceptMismatch ? 'FAIL' : check(!mappingUnknown, mappingUnknown),
    item_rubric_trustworthy: authorityRubricMismatch ? 'FAIL' : check(!rubricUnknown, rubricUnknown),
    grading_sufficient: check(!gradingUnknown, gradingUnknown),
    help_retry_exposure_sufficient: check(!helpUnknown, helpUnknown),
    novelty_independence_sufficient: noveltyUnknown ? 'UNKNOWN' : check(
      evidence.attempt.first_attempt === 'YES' &&
      evidence.attempt.retry_relation === 'FRESH' &&
      evidence.attempt.answer_exposure === 'NONE_OBSERVED'
    ),
    duplicate_excluded: duplicateKnown ? (duplicate ? 'FAIL' : 'PASS') : 'UNKNOWN',
    active_status: status === 'ACTIVE' ? 'PASS' : 'FAIL'
  };

  const denied = Object.fromEntries(RIGHTS.map((right) => [right, 'DENIED']));
  const rights = held ? Object.fromEntries(RIGHTS.map((right) => [right, 'HELD'])) : denied;

  if (!held && !inactive) {
    if (checks.provenance_traceable !== 'FAIL') {
      rights.CONTEXT_OK = 'GRANTED';
    }

    if (allPass(checks, ['target_mapping_valid', 'item_rubric_trustworthy', 'grading_sufficient', 'duplicate_excluded', 'active_status'])) {
      rights.ASSISTED_PROGRESS_OK = 'GRANTED';
    }

    const independenceConditions = allPass(checks, [
      'provenance_traceable',
      'target_mapping_valid',
      'item_rubric_trustworthy',
      'grading_sufficient',
      'help_retry_exposure_sufficient',
      'novelty_independence_sufficient',
      'duplicate_excluded',
      'active_status'
    ]) && evidence.help.level === 'NONE_OBSERVED';

    if (independenceConditions) {
      rights.INDEPENDENCE_OK = 'GRANTED';
      if (
        evidence.interpretation.status === 'VERIFIED' &&
        evidence.interpretation.transfer_type !== UNKNOWN &&
        evidence.interpretation.transfer_type !== 'NONE'
      ) {
        rights.TRANSFER_OK = 'GRANTED';
      }
      if (
        evidence.interpretation.status === 'VERIFIED' &&
        evidence.observed_at !== UNKNOWN &&
        String(evidence.interpretation.transfer_type).startsWith('DELAYED_')
      ) {
        rights.RETENTION_OK = 'GRANTED';
      }
    }
  }

  const reasonCodes = [];
  if (!duplicateKnown) reasonCodes.push('DUPLICATE_STATUS_UNKNOWN');
  if (duplicate) reasonCodes.push('DUPLICATE_ORIGIN_OPPORTUNITY');
  if (held) reasonCodes.push('HELD_EVIDENCE');
  if (held && gradingUnknown) reasonCodes.push('HELD_GRADING_DISPUTE');
  if (inactive) reasonCodes.push(`INACTIVE_${status}`);
  if (mappingUnknown) reasonCodes.push('TARGET_MAPPING_UNKNOWN');
  if (authorityIncomplete) reasonCodes.push('RUBRIC_AUTHORITY_UNKNOWN');
  if (authorityConceptMismatch) reasonCodes.push('TARGET_AUTHORITY_MISMATCH');
  if (authorityRubricMismatch) reasonCodes.push('RUBRIC_AUTHORITY_MISMATCH');
  if (helpUnknown) {
    reasonCodes.push('HELP_RETRY_EXPOSURE_UNKNOWN');
    reasonCodes.push('UNKNOWN_HELP_RETRY');
  }
  if (gradingUnknown) reasonCodes.push('GRADING_UNRESOLVED');
  const externalAggregateContextOnly = ['UNICLASS', 'ISMART', 'SCHOOL'].includes(evidence.provenance.source_kind) &&
    rights.CONTEXT_OK === 'GRANTED' && rights.INDEPENDENCE_OK !== 'GRANTED' && mappingUnknown;
  if (externalAggregateContextOnly) reasonCodes.push('EXTERNAL_AGGREGATE_CONTEXT_ONLY');
  if (rights.INDEPENDENCE_OK === 'GRANTED') {
    reasonCodes.push('INDEPENDENCE_ELIGIBLE_VISIBLE_SCOPE');
    reasonCodes.push('FRESH_INDEPENDENT_VISIBLE_SCOPE');
    if (rights.RETENTION_OK !== 'GRANTED') reasonCodes.push('NO_DELAYED_CHECK');
  }
  if (reasonCodes.length === 0) reasonCodes.push('NO_STRONG_RIGHT_GRANTED');

  return {
    contract_version: 'EVIDENCE_ELIGIBILITY/1.0',
    eligibility_id: required(options.eligibilityId ?? `elig-${evidence.evidence_id}`, 'eligibility_id'),
    evidence_id: evidence.evidence_id,
    policy_version: semantic(options.policyVersion, 'ntl6-policy-1.0'),
    evaluated_at: required(options.evaluatedAt, 'evaluated_at'),
    checks,
    rights,
    limitations: [
      ...(evidence.help.level === 'NONE_OBSERVED' ? ['NONE_OBSERVED is limited to captured scope; outside help may be unknown.'] : []),
      ...(evidence.observed_at === UNKNOWN ? ['Original observation time is unknown.'] : []),
      ...(mappingUnknown ? ['Evidence is not mapped to a validated concept/version.'] : []),
      ...(authorityIncomplete ? ['Required rubric authority is missing or incomplete; rubric trust remains unknown.'] : []),
      ...(authorityConceptMismatch ? ['Evidence concept/version does not match the approved rubric authority target.'] : []),
      ...(authorityRubricMismatch ? ['Evidence rubric reference/version does not match the approved rubric authority.'] : [])
    ],
    reason_codes: reasonCodes
  };
}

export class EvidenceRegistry {
  #idempotency = new Map();
  #dedup = new Map();

  register({ idempotencyKey, evidence: evidenceInput }) {
    required(idempotencyKey, 'idempotencyKey');
    const evidence = normalizeOpportunity(evidenceInput);
    const hash = stableHash(evidence);

    if (this.#idempotency.has(idempotencyKey)) {
      const prior = this.#idempotency.get(idempotencyKey);
      if (prior.hash !== hash) {
        const error = new Error('IDEMPOTENCY_CONFLICT');
        error.code = 'IDEMPOTENCY_CONFLICT';
        throw error;
      }
      return { status: 'IDEMPOTENT_REPLAY', duplicate: prior.duplicate, primary_evidence_id: prior.primaryEvidenceId, evidence };
    }

    const dedupIdentity = makeDedupIdentity(evidence);
    if (this.#dedup.has(dedupIdentity)) {
      const primaryEvidenceId = this.#dedup.get(dedupIdentity);
      this.#idempotency.set(idempotencyKey, { hash, duplicate: true, primaryEvidenceId });
      return { status: 'DUPLICATE_ORIGIN', duplicate: true, primary_evidence_id: primaryEvidenceId, evidence };
    }

    this.#dedup.set(dedupIdentity, evidence.evidence_id);
    this.#idempotency.set(idempotencyKey, { hash, duplicate: false, primaryEvidenceId: evidence.evidence_id });
    return { status: 'NEW', duplicate: false, primary_evidence_id: evidence.evidence_id, evidence };
  }
}
