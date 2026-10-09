const UNKNOWN = 'UNKNOWN';

const HELP_RANK = Object.freeze({
  NONE_OBSERVED: 0,
  GENERAL_PROMPT: 1,
  TARGET_HINT: 2,
  WORKED_STEP_OR_ANSWER: 3
});

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

function isActiveUsable(record) {
  const e = record?.evidence;
  const q = record?.eligibility;
  return e?.data_status?.status === 'ACTIVE' &&
    q?.evidence_id === e?.evidence_id &&
    q?.checks?.duplicate_excluded === 'PASS' &&
    q?.checks?.target_mapping_valid === 'PASS' &&
    q?.checks?.item_rubric_trustworthy === 'PASS' &&
    q?.checks?.grading_sufficient === 'PASS';
}

function knownDate(value) {
  return value && value !== UNKNOWN;
}

function comparabilityKey(record) {
  const e = record.evidence;
  const parts = [
    e.target?.scope,
    e.target?.rubric_version,
    e.target?.relative_difficulty,
    e.conditions?.response_modality,
    e.conditions?.time_limit
  ];
  if (parts.some((v) => !v || v === UNKNOWN)) return UNKNOWN;
  return parts.join('|');
}

function helpRank(level) {
  return Object.hasOwn(HELP_RANK, level) ? HELP_RANK[level] : null;
}

function sessionize(records) {
  const bySession = new Map();
  for (const record of records) {
    const id = record.evidence.session_id;
    if (!bySession.has(id)) bySession.set(id, []);
    bySession.get(id).push(record);
  }

  const sessions = [];
  for (const [sessionId, rs] of bySession.entries()) {
    const dates = unique(rs.map((r) => r.evidence.observed_at).filter(knownDate)).sort();
    const criterion = rs.map((r) => r.evidence.result?.criterion_result).filter((v) => ['CORRECT', 'PARTIAL', 'INCORRECT'].includes(v));
    const correct = criterion.filter((v) => v === 'CORRECT').length;
    const knownHelp = rs.map((r) => helpRank(r.evidence.help?.level)).filter((v) => v !== null);
    const independenceGranted = rs.filter((r) => r.eligibility?.rights?.INDEPENDENCE_OK === 'GRANTED').length;
    const transferGranted = rs.filter((r) => r.eligibility?.rights?.TRANSFER_OK === 'GRANTED').length;
    const retentionGranted = rs.filter((r) => r.eligibility?.rights?.RETENTION_OK === 'GRANTED').length;
    const keys = unique(rs.map(comparabilityKey));
    sessions.push({
      session_id: sessionId,
      observed_at: dates.length ? dates[0] : UNKNOWN,
      criterion_count: criterion.length,
      correct_count: correct,
      correctness_rate: criterion.length ? correct / criterion.length : null,
      max_help_rank: knownHelp.length ? Math.max(...knownHelp) : null,
      min_help_rank: knownHelp.length ? Math.min(...knownHelp) : null,
      independence_granted_count: independenceGranted,
      independence_rate: criterion.length ? independenceGranted / criterion.length : null,
      transfer_granted_count: transferGranted,
      retention_granted_count: retentionGranted,
      comparability_key: keys.length === 1 ? keys[0] : UNKNOWN,
      evidence_ids: rs.map((r) => r.evidence.evidence_id)
    });
  }

  return sessions.sort((a, b) => {
    if (!knownDate(a.observed_at) && !knownDate(b.observed_at)) return a.session_id.localeCompare(b.session_id);
    if (!knownDate(a.observed_at)) return 1;
    if (!knownDate(b.observed_at)) return -1;
    return String(a.observed_at).localeCompare(String(b.observed_at));
  });
}

function comparablePairs(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    if (session.comparability_key === UNKNOWN || !knownDate(session.observed_at)) continue;
    if (!groups.has(session.comparability_key)) groups.set(session.comparability_key, []);
    groups.get(session.comparability_key).push(session);
  }
  const pairs = [];
  for (const group of groups.values()) {
    group.sort((a, b) => String(a.observed_at).localeCompare(String(b.observed_at)));
    for (let i = 1; i < group.length; i += 1) pairs.push([group[i - 1], group[i]]);
  }
  return pairs;
}

function classifyDelta(deltas, positiveLabel, negativeLabel, stableLabel) {
  if (!deltas.length) return 'INSUFFICIENT_COMPARABLE_DATA';
  const material = deltas.filter((d) => d !== 0);
  if (!material.length) return stableLabel;
  const positive = material.filter((d) => d > 0).length;
  const negative = material.filter((d) => d < 0).length;
  if (positive && !negative) return positiveLabel;
  if (negative && !positive) return negativeLabel;
  return 'MIXED';
}

function correctnessTrend(sessions) {
  const pairs = comparablePairs(sessions).filter(([a, b]) => a.correctness_rate !== null && b.correctness_rate !== null);
  const deltas = pairs.map(([a, b]) => {
    const d = b.correctness_rate - a.correctness_rate;
    return Math.abs(d) < 1e-9 ? 0 : d;
  });
  return {
    status: classifyDelta(deltas, 'IMPROVING', 'WORSENING', 'STABLE'),
    comparable_pair_count: pairs.length,
    basis_sessions: unique(pairs.flatMap(([a, b]) => [a.session_id, b.session_id]))
  };
}

function supportTrend(sessions) {
  const pairs = comparablePairs(sessions).filter(([a, b]) => a.max_help_rank !== null && b.max_help_rank !== null);
  const deltas = pairs.map(([a, b]) => {
    const d = a.max_help_rank - b.max_help_rank;
    return d === 0 ? 0 : d;
  });
  return {
    status: classifyDelta(deltas, 'DECREASING_SUPPORT', 'INCREASING_SUPPORT', 'STABLE_SUPPORT'),
    comparable_pair_count: pairs.length,
    basis_sessions: unique(pairs.flatMap(([a, b]) => [a.session_id, b.session_id]))
  };
}

function independenceTrend(sessions) {
  const pairs = comparablePairs(sessions).filter(([a, b]) => a.independence_rate !== null && b.independence_rate !== null);
  const deltas = pairs.map(([a, b]) => {
    const d = b.independence_rate - a.independence_rate;
    return Math.abs(d) < 1e-9 ? 0 : d;
  });
  return {
    status: classifyDelta(deltas, 'MORE_INDEPENDENT_EVIDENCE', 'LESS_INDEPENDENT_EVIDENCE', 'STABLE_INDEPENDENT_EVIDENCE'),
    comparable_pair_count: pairs.length,
    basis_sessions: unique(pairs.flatMap(([a, b]) => [a.session_id, b.session_id]))
  };
}

function transferObservation(sessions) {
  const total = sessions.reduce((n, s) => n + s.transfer_granted_count, 0);
  return {
    status: total ? 'OBSERVED' : 'NOT_OBSERVED_IN_ACCEPTED_RECORDS',
    eligible_observation_count: total
  };
}

function retentionCue(sessions, conceptState) {
  const total = sessions.reduce((n, s) => n + s.retention_granted_count, 0);
  if (total) return { status: 'DELAYED_EVIDENCE_OBSERVED', reason: 'At least one accepted retention-eligible opportunity exists.' };
  if (conceptState?.retention?.status === 'CHECK_PENDING') return { status: 'CHECK_PENDING', reason: 'Concept State explicitly marks a retention check pending.' };
  if (conceptState?.retention?.status === 'NOT_CHECKED') return { status: 'NOT_CHECKED', reason: 'No accepted delayed retention evidence is recorded.' };
  return { status: 'NO_ADDITIONAL_CUE', reason: 'Trend layer does not infer forgetting from elapsed time alone.' };
}

function anomalyCue(sessions, conceptState) {
  const known = sessions.filter((s) => knownDate(s.observed_at) && s.criterion_count > 0);
  if (known.length < 2) return { status: 'NONE', evidence: [] };
  const latest = known.at(-1);
  const prior = known.slice(0, -1);
  const priorStrong = prior.filter((s) => s.correctness_rate === 1 && s.independence_granted_count > 0);
  const latestHasError = latest.correctness_rate !== null && latest.correctness_rate < 1;
  if (priorStrong.length >= 2 && latestHasError && ['INDEPENDENT_OBSERVED', 'INDEPENDENT_CONFIRMED'].includes(conceptState?.demonstration?.status)) {
    return {
      status: 'RECENT_SINGLE_DEVIATION_AFTER_STABLE_SUCCESS',
      evidence: latest.evidence_ids,
      note: 'Descriptive anomaly only; no cause or broad regression is inferred.'
    };
  }
  return { status: 'NONE', evidence: [] };
}

export function buildTrendReadModel(input) {
  const learnerId = required(input.learnerId, 'learnerId');
  const concept = required(input.concept, 'concept');
  required(concept.concept_id, 'concept.concept_id');
  required(concept.concept_version, 'concept.concept_version');
  const asOf = required(input.asOf, 'asOf');
  const policyVersion = required(input.policyVersion, 'policyVersion');

  const mapped = (input.records ?? []).filter((r) => matchesConcept(r.evidence, concept));
  const accepted = mapped.filter(isActiveUsable);
  const excluded = mapped.filter((r) => !isActiveUsable(r));
  const sessions = sessionize(accepted);
  const unknownDateCount = accepted.filter((r) => !knownDate(r.evidence.observed_at)).length;
  const comparable = sessions.filter((s) => s.comparability_key !== UNKNOWN && knownDate(s.observed_at));
  const conceptState = input.conceptState ?? null;

  const limitations = unique([
    ...(accepted.length === 0 ? ['No accepted comparable evidence is available for trend description.'] : []),
    ...(unknownDateCount ? ['Some accepted evidence has UNKNOWN observation time; chronological trend claims exclude those records.'] : []),
    ...(comparable.length < 2 ? ['Fewer than two chronologically comparable sessions are available for strong trend statements.'] : []),
    ...(excluded.length ? ['Some mapped evidence was excluded from strong trend claims because it was duplicate, inactive, held, disputed, or otherwise ineligible.'] : []),
    'Trend output is descriptive only and must not be treated as diagnosis, forgetting inference, or strategy action.'
  ]);

  return {
    contract_version: 'TREND_READ_MODEL/1.0',
    trend_id: required(input.trendId, 'trendId'),
    learner_id: learnerId,
    concept: {
      concept_id: concept.concept_id,
      concept_version: concept.concept_version,
      subject: concept.subject ?? UNKNOWN,
      scope: concept.scope ?? UNKNOWN
    },
    as_of: asOf,
    policy_version: policyVersion,
    sessions,
    axes: {
      correctness: correctnessTrend(sessions),
      support: supportTrend(sessions),
      independence: independenceTrend(sessions),
      transfer: transferObservation(sessions)
    },
    cues: {
      retention: retentionCue(sessions, conceptState),
      anomaly: anomalyCue(sessions, conceptState)
    },
    evidence_basis: {
      accepted_evidence_ids: accepted.map((r) => r.evidence.evidence_id),
      excluded_evidence_ids: excluded.map((r) => r.evidence?.evidence_id).filter(Boolean),
      unknown_observation_time_count: unknownDateCount
    },
    limitations
  };
}
