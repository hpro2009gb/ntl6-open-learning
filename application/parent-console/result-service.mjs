import { deriveEligibility, normalizeOpportunity, stableHash } from '../../core/evidence/index.mjs';
import { appendLedgerRecord, readLedgerRecords } from '../../persistence/ledger/writer.mjs';

const UNKNOWN='UNKNOWN';

function required(value,name) {
  if (value===undefined || value===null || value==='') throw new Error(`MISSING_REQUIRED:${name}`);
  return value;
}

function val(value,fallback=UNKNOWN) {
  return value===undefined || value===null || value==='' ? fallback : value;
}

function evidenceIdFor(input) {
  if (input.evidenceId) return input.evidenceId;
  const identity={
    learner_id:required(input.learnerId,'learnerId'),
    assessment_id:required(input.assessmentId,'assessmentId'),
    item_id:required(input.item?.item_id,'item.item_id'),
    attempt_key:val(input.attemptKey,'1')
  };
  return `ev-pc-${stableHash(identity).slice(0,24)}`;
}

function sourceIdentity(input,itemId) {
  const assessmentId=required(input.assessmentId,'assessmentId');
  const learnerId=required(input.learnerId,'learnerId');
  const attemptKey=val(input.attemptKey,'1');
  const originId=val(input.source?.originId,`parent-console:${assessmentId}:${itemId}:${attemptKey}`);
  return {
    origin_id:originId,
    reporting_channel:val(input.source?.reportingChannel,'PARENT_CONSOLE'),
    dedup_key:val(input.source?.dedupKey,`${learnerId}|${assessmentId}|${itemId}|${attemptKey}`)
  };
}

export function buildEvidenceOpportunity(input) {
  const item=required(input.item,'item');
  const result=required(input.result,'result');
  const evidenceId=evidenceIdFor(input);
  const itemId=required(item.item_id,'item.item_id');
  const assessmentId=required(input.assessmentId,'assessmentId');
  const observedAt=val(input.observedAt);
  const importedAt=required(input.importedAt,'importedAt');
  const source=sourceIdentity(input,itemId);
  const helpLevel=val(result.helpLevel);
  const answerExposure=val(result.answerExposure);
  const firstAttempt=val(result.firstAttempt);
  const retryRelation=val(result.retryRelation);

  return normalizeOpportunity({
    contract_version:'EVIDENCE_OPPORTUNITY/1.0',
    evidence_id:evidenceId,
    session_id:val(input.sessionId,assessmentId),
    opportunity_id:val(input.opportunityId,`${assessmentId}:${itemId}:${val(input.attemptKey,'1')}`),
    learner_id:required(input.learnerId,'learnerId'),
    source_identity:source,
    observed_at:observedAt,
    imported_at:importedAt,
    timezone:val(input.timezone),
    provenance:{
      source_kind:val(input.source?.sourceKind,'PARENT_NOTE'),
      raw_ref:val(input.source?.rawRef,`assessment:${assessmentId}`),
      raw_locator:val(input.source?.rawLocator,`item:${itemId}`),
      capture_completeness:val(input.source?.captureCompleteness,'UNKNOWN')
    },
    target:{
      concept_id:val(item.concept_id,'UNMAPPED'),
      concept_version:val(item.concept_version),
      item_id:itemId,
      item_family:val(item.family_id),
      rubric_ref:val(item.rubric_ref),
      rubric_version:val(item.rubric_version),
      scope:val(item.scope,item.concept_id ?? UNKNOWN),
      relative_difficulty:val(item.difficulty_band)
    },
    result:{
      response_ref:val(result.responseRef,`assessment:${assessmentId}:item:${itemId}:response`),
      criterion_result:val(result.criterionResult,'UNRESOLVED'),
      grader:val(result.grader,'PARENT'),
      grading_verification_status:result.gradingVerified===true ? 'VERIFIED' : val(result.gradingVerificationStatus,'UNRESOLVED')
    },
    help:{
      level:helpLevel,
      source:helpLevel===UNKNOWN ? UNKNOWN : val(result.helpSource,'PARENT_REPORTED'),
      timing:helpLevel===UNKNOWN ? UNKNOWN : val(result.helpTiming,'UNKNOWN'),
      observation_basis:val(result.helpObservationBasis,helpLevel===UNKNOWN?UNKNOWN:'PARENT_REPORTED')
    },
    attempt:{
      first_attempt:firstAttempt,
      retry_relation:retryRelation,
      answer_exposure:answerExposure
    },
    conditions:{
      time_limit:val(result.timeLimit),
      interruption:val(result.interruption),
      fatigue:val(result.fatigue),
      response_modality:val(result.responseModality)
    },
    thinking_tags:Array.isArray(result.thinkingTags) ? result.thinkingTags : [],
    interpretation:{
      error_hypothesis:val(result.errorHypothesis),
      evidence_span:val(result.evidenceSpan,`assessment:${assessmentId}:item:${itemId}`),
      transfer_type:val(result.transferType),
      origin:val(result.interpretationOrigin,'HUMAN'),
      status:val(result.interpretationStatus,'UNRESOLVED'),
      interpretation_version:val(result.interpretationVersion,'PARENT_CONSOLE_R1')
    },
    data_status:{
      status:'ACTIVE',
      supersedes_id:'NOT_APPLICABLE',
      reason:'Parent Console result capture',
      actor:'PARENT',
      changed_at:'NOT_APPLICABLE'
    }
  });
}

function duplicateStatus(evidence,filePath) {
  if (!filePath) return false;
  const rows=readLedgerRecords(filePath);
  const prior=rows.filter((row)=>row.record_type==='EVIDENCE_OPPORTUNITY').map((row)=>row.payload).find((p)=>
    p?.learner_id===evidence.learner_id &&
    p?.opportunity_id===evidence.opportunity_id &&
    p?.source_identity?.origin_id===evidence.source_identity.origin_id &&
    p?.source_identity?.dedup_key===evidence.source_identity.dedup_key &&
    p?.evidence_id!==evidence.evidence_id
  );
  return Boolean(prior);
}

function accepted(status) {
  return status==='APPENDED' || status==='NO_OP_EXISTING';
}

export function captureAssessmentResult(input, options={}) {
  const evidence=buildEvidenceOpportunity(input);
  const ledgerFilePath=required(options.ledgerFilePath,'options.ledgerFilePath');
  const lockPath=required(options.lockPath,'options.lockPath');
  const policyVersion=required(input.policyVersion,'policyVersion');
  const evaluatedAt=required(input.importedAt,'importedAt');
  const duplicate=duplicateStatus(evidence,ledgerFilePath);
  const eligibility=deriveEligibility(evidence,{
    duplicate,
    eligibilityId:`elig-${evidence.evidence_id}`,
    policyVersion,
    evaluatedAt,
    requireRubricAuthority:input.requireRubricAuthority===true,
    rubricAuthority:input.rubricAuthority
  });

  const evidenceWrite=appendLedgerRecord({
    recordType:'EVIDENCE_OPPORTUNITY',
    schemaRef:'EVIDENCE_OPPORTUNITY/1.0',
    idempotencyKey:`result:${evidence.evidence_id}:opportunity`,
    dedupKey:evidence.source_identity.dedup_key,
    occurredAt:evidence.observed_at,
    payload:evidence
  },{filePath:ledgerFilePath,lockPath,appendedAt:input.importedAt});

  if (!accepted(evidenceWrite.status)) {
    return {status:'BLOCKED',stage:'EVIDENCE_APPEND',evidence,evidence_write:evidenceWrite,eligibility:null,eligibility_write:null,affected_concept_ids:[]};
  }

  const eligibilityWrite=appendLedgerRecord({
    recordType:'EVIDENCE_ELIGIBILITY',
    schemaRef:'EVIDENCE_ELIGIBILITY/1.0',
    idempotencyKey:`result:${evidence.evidence_id}:eligibility:${policyVersion}`,
    dedupKey:`${evidence.source_identity.dedup_key}|eligibility|${policyVersion}`,
    occurredAt:evidence.observed_at,
    payload:eligibility
  },{filePath:ledgerFilePath,lockPath,appendedAt:input.importedAt});

  return {
    status:accepted(eligibilityWrite.status) ? 'RECORDED' : 'PARTIAL',
    evidence,
    evidence_write:evidenceWrite,
    eligibility,
    eligibility_write:eligibilityWrite,
    affected_concept_ids:evidence.target.concept_id==='UNMAPPED' ? [] : [evidence.target.concept_id],
    rebuild_required:accepted(eligibilityWrite.status)
  };
}
