const LEARNER_EXPOSURE_TYPES = new Set([
  'ASSIGNED_TO_LEARNER','SUBMITTED','HELPED','ANSWER_EXPOSED','RECHECK_USED'
]);

function parseTime(value) {
  if (!value || value === 'UNKNOWN') return null;
  const ms=Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isLearnerExposure(event) {
  return LEARNER_EXPOSURE_TYPES.has(event?.exposure_type);
}

function daysBetween(a,b) {
  return Math.abs(a-b)/(24*60*60*1000);
}

export function evaluateQuestionEligibility(input) {
  const candidate=input?.candidate;
  if (!candidate?.item_id) throw new Error('MISSING_REQUIRED:candidate.item_id');
  const purpose=input?.purpose ?? candidate.purpose ?? 'PRACTICE';
  const exposures=Array.isArray(input?.exposures) ? input.exposures : [];
  const policy=input?.policy ?? {};
  const familySignature=input?.familySignature ?? candidate.family_signature ?? candidate.family_id ?? 'UNKNOWN';
  const asOf=parseTime(input?.asOf);
  const cooldown=Number.isFinite(policy.sameFamilyCooldownDays) ? Math.max(0,policy.sameFamilyCooldownDays) : 7;
  const reasons=[];

  if (purpose !== 'FRESH_RECHECK') {
    return { eligible:true, status:'ELIGIBLE', purpose, reason_codes:[], considered_exposure_ids:[] };
  }

  if (input?.exposureKnowledge === 'UNKNOWN') reasons.push('EXPOSURE_HISTORY_UNKNOWN');

  const learnerEvents=exposures.filter(isLearnerExposure);
  const exact=learnerEvents.filter((e)=>e.item_id===candidate.item_id);
  if (exact.length) reasons.push('EXACT_ITEM_ALREADY_EXPOSED');

  if (exact.some((e)=>['PARTIAL','WORKED_ANSWER','UNKNOWN'].includes(e.answer_exposure))) {
    reasons.push('EXACT_ITEM_ANSWER_EXPOSURE');
  }
  if (exact.some((e)=>['TARGET_HINT','WORKED_STEP_OR_ANSWER','UNKNOWN'].includes(e.help_level))) {
    reasons.push('EXACT_ITEM_HELP_CONTAMINATED');
  }

  const familyEvents=learnerEvents.filter((e)=>
    familySignature !== 'UNKNOWN' &&
    (e.family_signature ?? 'UNKNOWN') === familySignature
  );
  for (const event of familyEvents) {
    const t=parseTime(event.occurred_at);
    if (event.answer_exposure === 'UNKNOWN' || event.help_level === 'UNKNOWN') {
      reasons.push('SAME_FAMILY_EXPOSURE_UNCERTAIN');
      continue;
    }
    if (asOf === null || t === null) {
      reasons.push('SAME_FAMILY_RECENCY_UNKNOWN');
      continue;
    }
    if (daysBetween(asOf,t) <= cooldown) reasons.push('RECENT_SAME_FAMILY_EXPOSURE');
  }

  const unique=[...new Set(reasons)];
  return {
    eligible:unique.length===0,
    status:unique.length ? 'BLOCKED' : 'ELIGIBLE',
    purpose,
    reason_codes:unique,
    considered_exposure_ids:[...new Set([...exact,...familyEvents].map((e)=>e.exposure_id).filter(Boolean))]
  };
}

export function isLearnerExposureEvent(event) {
  return isLearnerExposure(event);
}
