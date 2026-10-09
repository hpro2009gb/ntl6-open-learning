const SUBJECTS = Object.freeze(['MATH','VIETNAMESE','ENGLISH']);
const STRATEGIES = new Set(['GIU_NHIP','TANG_TOC','CUNG_CO','GIAM_TAI','DOI_CHIEN_THUAT']);

function required(value, name) {
  if (value === undefined || value === null || value === '') throw new Error(`MISSING_REQUIRED:${name}`);
  return value;
}
function unique(values) { return [...new Set(values.filter((x) => x !== undefined && x !== null && x !== ''))]; }
function subjectOf(entry) { return entry?.concept?.subject ?? entry?.state?.concept?.subject ?? entry?.subject ?? 'UNKNOWN'; }
function conceptId(entry) { return entry?.concept?.concept_id ?? entry?.state?.concept?.concept_id ?? entry?.concept_id ?? 'UNKNOWN'; }
function displayName(entry) { return entry?.display_name ?? entry?.displayName ?? conceptId(entry); }
function rank(entry) { return Number.isFinite(entry?.priority?.rank) ? entry.priority.rank : Number.MAX_SAFE_INTEGER; }
function isConflict(entry) { return entry?.diagnosis?.status === 'CONFLICT' || entry?.state?.concern?.status === 'CONFLICT'; }
function repeated(entry) { return entry?.diagnosis?.status === 'REPEATED_PATTERN' || entry?.state?.concern?.status === 'REPEATED_PATTERN'; }
function demo(entry) { return entry?.state?.demonstration?.status ?? 'UNKNOWN'; }
function transfer(entry) { return entry?.state?.transfer?.status ?? 'NOT_CHECKED'; }
function evidenceIds(entry) { return entry?.state?.decision_basis?.evidence_ids ?? []; }

function subjectEvidenceStatus(entries) {
  if (!entries.length) return 'INSUFFICIENT';
  if (entries.some(isConflict)) return 'CONFLICT';
  if (entries.some((e) => ['INDEPENDENT_OBSERVED','INDEPENDENT_CONFIRMED'].includes(demo(e)))) return 'SUFFICIENT';
  return 'INSUFFICIENT';
}

function currentState(entries, evidenceStatus) {
  if (!entries.length) return 'CHUA_DU_DU_LIEU';
  if (evidenceStatus === 'CONFLICT') return 'DU_LIEU_MAU_THUAN';
  if (entries.some(repeated)) return 'DANG_CUNG_CO';
  if (entries.every((e) => demo(e) === 'INDEPENDENT_CONFIRMED')) return 'CO_BANG_CHUNG_DOC_LAP_ON_DINH_TRONG_PHAM_VI_DA_KIEM_TRA';
  if (entries.some((e) => ['INDEPENDENT_OBSERVED','INDEPENDENT_CONFIRMED'].includes(demo(e)))) return 'DA_CO_BANG_CHUNG_TU_LAM';
  return 'CHUA_DU_BANG_CHUNG_DOC_LAP';
}

function trendSummary(entries) {
  const signals = entries.flatMap((entry) => Object.values(entry?.trend?.axes ?? {}).map((x) => x?.status).filter(Boolean));
  if (!signals.length) return 'CHUA_DU_DU_LIEU_XU_HUONG';
  if (signals.some((x) => ['WORSENING','INCREASING_SUPPORT','LESS_INDEPENDENT_EVIDENCE'].includes(x))) return 'CAN_THEO_DOI';
  if (signals.some((x) => ['IMPROVING','DECREASING_SUPPORT','MORE_INDEPENDENT_EVIDENCE'].includes(x))) return 'DANG_TIEN_BO';
  return 'ON_DINH_HOAC_LAN_LON';
}

function strategyFor(entry) {
  if (entry?.strategy_review?.change_required === true) return 'DOI_CHIEN_THUAT';
  const decision = entry?.decision ?? {};
  if (decision.scheduled_action === 'PAUSE') return 'GIAM_TAI';
  if (decision.need_action === 'ADVANCE') return 'TANG_TOC';
  if (decision.need_action === 'MAINTAIN') return 'GIU_NHIP';
  if (['DIAGNOSE','RETEACH','REPAIR','RECHECK'].includes(decision.need_action)) return 'CUNG_CO';
  return 'CUNG_CO';
}

function gapReason(entry) {
  if (isConflict(entry)) return 'CONFLICT';
  if (repeated(entry)) return entry?.diagnosis?.hypothesis ?? 'REPEATED_PATTERN';
  if (demo(entry) === 'ASSISTED_ONLY') return 'ASSISTED_ONLY';
  if (demo(entry) === 'UNKNOWN') return 'INSUFFICIENT_EVIDENCE';
  if (transfer(entry) === 'NOT_CHECKED') return 'TRANSFER_NOT_CHECKED';
  return null;
}

function journeyStage({ baselineKnown, concepts, milestoneContext }) {
  if (!baselineKnown || !concepts.length) return 'KHOI_DONG';
  if (milestoneContext?.mockStable === true) return 'THI_THU_ON_DINH';
  if (milestoneContext?.targetPracticeStarted === true) return 'LUYEN_MUC_TIEU_NTL6';
  const active = concepts.filter((e) => !isConflict(e));
  if (active.length && active.every((e) => demo(e) === 'INDEPENDENT_CONFIRMED' && transfer(e) === 'CONFIRMED_IN_SCOPE')) return 'VAN_DUNG';
  if (active.length && active.every((e) => demo(e) === 'INDEPENDENT_CONFIRMED')) return 'HOAN_THIEN_LOP_5';
  return 'XAY_NEN';
}

function buildSubjectState(subject, entries, baselineState) {
  const ordered = [...entries].sort((a,b) => rank(a) - rank(b) || conceptId(a).localeCompare(conceptId(b)));
  const evidenceStatus = subjectEvidenceStatus(ordered);
  const gaps = ordered.map((entry) => ({ entry, reason:gapReason(entry) })).filter((x) => x.reason);
  const achievements = ordered
    .filter((entry) => demo(entry) === 'INDEPENDENT_CONFIRMED' || transfer(entry) === 'CONFIRMED_IN_SCOPE')
    .map((entry) => ({ concept_id:conceptId(entry), display_name:displayName(entry), evidence_ids:evidenceIds(entry) }));
  const primary = ordered[0] ?? null;
  const strategy = primary ? strategyFor(primary) : 'CUNG_CO';
  if (!STRATEGIES.has(strategy)) throw new Error(`INVALID_STRATEGY:${strategy}`);
  return {
    subject,
    start_state: baselineState?.summary ?? 'CHUA_DU_DU_LIEU_BASELINE',
    current_state: currentState(ordered, evidenceStatus),
    achievements,
    main_gap: gaps[0] ? { concept_id:conceptId(gaps[0].entry), display_name:displayName(gaps[0].entry), reason:gaps[0].reason } : { reason:'CHUA_CO_KHOANG_TRONG_UU_TIEN' },
    trend: trendSummary(ordered),
    strategy,
    next_action: primary?.decision?.scheduled_action ?? primary?.decision?.need_action ?? 'DIAGNOSE',
    evidence_status: evidenceStatus,
    concept_count: ordered.length
  };
}

export function buildRoadmapSnapshot(input) {
  const snapshotId = required(input.snapshotId, 'snapshotId');
  const learnerId = required(input.learnerId, 'learnerId');
  const asOf = required(input.asOf, 'asOf');
  const baselineRef = required(input.baselineRef, 'baselineRef');
  const targetModel = required(input.targetModel, 'targetModel');
  const policyVersion = required(input.policyVersion, 'policyVersion');
  const concepts = input.concepts ?? [];
  const baselineSubjectStates = input.baselineSubjectStates ?? {};
  const subjectStates = SUBJECTS.map((subject) => buildSubjectState(subject, concepts.filter((e) => subjectOf(e) === subject), baselineSubjectStates[subject]));
  const gaps = subjectStates.flatMap((s) => s.main_gap?.concept_id ? [{ subject:s.subject, ...s.main_gap }] : []);
  const achievements = subjectStates.flatMap((s) => s.achievements.map((x) => ({ subject:s.subject, ...x })));
  const strategySummary = subjectStates.map((s) => ({ subject:s.subject, strategy:s.strategy, next_action:s.next_action, evidence_status:s.evidence_status }));
  const sourceRecordIds = unique(concepts.flatMap(evidenceIds));
  const baselineKnown = baselineRef !== 'UNKNOWN' && Object.keys(baselineSubjectStates).length > 0;
  const unknowns = unique([
    ...(targetModel.unknowns ?? []),
    ...subjectStates.filter((s) => s.evidence_status === 'INSUFFICIENT').map((s) => `${s.subject}_LEARNER_EVIDENCE_INSUFFICIENT`),
    ...subjectStates.filter((s) => s.evidence_status === 'CONFLICT').map((s) => `${s.subject}_LEARNER_EVIDENCE_CONFLICT`)
  ]);
  return {
    contract_version:'ROADMAP_SNAPSHOT/1.0',
    snapshot_id:snapshotId,
    learner_id:learnerId,
    as_of:asOf,
    baseline_ref:baselineRef,
    target_model_ref:`${targetModel.target_model_id}@${targetModel.version}`,
    journey_stage:journeyStage({baselineKnown, concepts, milestoneContext:input.milestoneContext ?? {}}),
    subject_states:subjectStates,
    gaps,
    achievements,
    strategy_summary:strategySummary,
    unknowns,
    source_record_ids:sourceRecordIds,
    policy_version:policyVersion
  };
}
