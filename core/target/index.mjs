const SUBJECTS = Object.freeze(['MATH','VIETNAMESE','ENGLISH']);

function required(value, name) {
  if (value === undefined || value === null || value === '') throw new Error(`MISSING_REQUIRED:${name}`);
  return value;
}

function unique(values) {
  return [...new Set(values.filter((x) => x !== undefined && x !== null && x !== ''))];
}

function isOfficial(entry) {
  return entry?.source_class === 'OFFICIAL_EVENT_FACT';
}

function isOfficialForTargetYear(entry, targetYear) {
  if (!isOfficial(entry)) return false;
  const year = String(targetYear);
  return String(entry?.verified_facts?.date ?? '').startsWith(`${year}-`) ||
    String(entry?.year ?? '').startsWith(`${year}-`);
}

function officialFact(entry) {
  return {
    source_id: entry.id,
    year: entry.year,
    subjects: entry.subjects ?? [],
    verified_facts: entry.verified_facts ?? {},
    provenance_confidence: entry.provenance_confidence ?? 'UNKNOWN',
    authority_ceiling: entry.authority_ceiling ?? 'UNKNOWN'
  };
}

function subjectRequirement(subject, entries, officialTargetEntries) {
  const officialHistory = entries.filter((e) => isOfficial(e) && (e.subjects ?? []).includes(subject));
  const targetOfficial = officialTargetEntries.filter((e) => (e.subjects ?? []).includes(subject));
  const minuteFacts = officialHistory
    .map((e) => ({ source_id:e.id, minutes:e.verified_facts?.subject_minutes?.[subject] }))
    .filter((x) => Number.isFinite(x.minutes));
  return {
    subject,
    status: targetOfficial.length ? 'CURRENT_EVIDENCE_BACKED' : 'PROVISIONAL',
    source_refs: unique(officialHistory.map((e) => e.id)),
    latest_known_minutes: minuteFacts.length ? minuteFacts[minuteFacts.length - 1].minutes : 'UNKNOWN',
    curriculum_basis: unique(officialHistory.map((e) => e.verified_facts?.curriculum_basis)),
    orientation: unique(officialHistory.flatMap((e) => e.verified_facts?.orientation ?? [])),
    limitation: targetOfficial.length
      ? 'Bounded to the cited official target-year source facts.'
      : 'Prior-year official facts are context only and do not establish the 2027 format.'
  };
}

export function buildTargetEvidenceMatrix(archive) {
  const entries = archive?.entries ?? [];
  return entries.flatMap((entry) => (entry.subjects ?? []).map((subject) => ({
    year: entry.year ?? 'UNKNOWN',
    subject,
    source_ref: entry.id,
    source_class: entry.source_class ?? 'UNKNOWN',
    provenance_confidence: entry.provenance_confidence ?? 'UNKNOWN',
    authority_ceiling: entry.authority_ceiling ?? 'UNKNOWN',
    skill_id: 'UNKNOWN',
    item_family: 'UNKNOWN',
    evidence_scope: 'SOURCE_LEVEL_ONLY',
    reported_sections: entry.reported_format?.sections ?? [],
    allowed_use: entry.allowed_use ?? []
  })));
}

export function buildNtl6TargetModel(input) {
  const archive = required(input.archive, 'archive');
  if (archive.contract_version !== 'NTL6_EXAM_ARCHIVE_INDEX/1.0') throw new Error('INVALID_ARCHIVE_CONTRACT');
  const entries = Array.isArray(archive.entries) ? archive.entries : [];
  const asOf = required(input.asOf, 'asOf');
  const targetYear = String(input.targetYear ?? '2027');
  const version = required(input.version, 'version');
  const targetOfficialEntries = entries.filter((e) => isOfficialForTargetYear(e, targetYear));
  const officialFacts = entries.filter(isOfficial).map(officialFact);
  const historical = entries.filter((e) => !isOfficial(e)).map((entry) => ({
    source_id: entry.id,
    year: entry.year ?? 'UNKNOWN',
    subjects: entry.subjects ?? [],
    source_class: entry.source_class ?? 'UNKNOWN',
    provenance_confidence: entry.provenance_confidence ?? 'UNKNOWN',
    reported_format: entry.reported_format ?? null,
    authority_ceiling: entry.authority_ceiling ?? 'UNKNOWN',
    allowed_use: entry.allowed_use ?? []
  }));

  const unknowns = [];
  if (!targetOfficialEntries.length) {
    unknowns.push('OFFICIAL_2027_FORMAT','OFFICIAL_2027_SUBJECT_TIMING','OFFICIAL_2027_BLUEPRINT');
  }
  const reportedEnglish = entries.filter((e) => e.source_class === 'REPORTED_PAST_PAPER' && (e.subjects ?? []).includes('ENGLISH'));
  const reportedVietnamese = entries.filter((e) => e.source_class === 'REPORTED_PAST_PAPER' && (e.subjects ?? []).includes('VIETNAMESE'));
  if (!reportedEnglish.length) unknowns.push('ENGLISH_HISTORICAL_ITEM_FAMILY_COVERAGE');
  if (reportedVietnamese.length < 2) unknowns.push('VIETNAMESE_HISTORICAL_ITEM_FAMILY_COVERAGE');

  return {
    contract_version: 'NTL6_TARGET_MODEL/1.0',
    target_model_id: input.targetModelId ?? 'NTL6-2027-TARGET',
    version,
    as_of: asOf,
    target_school: archive.target_school ?? 'Sample Middle School',
    target_year: targetYear,
    status: targetOfficialEntries.length ? 'CURRENT_EVIDENCE_BACKED' : 'PROVISIONAL',
    official_facts: officialFacts,
    historical_pattern_evidence: historical,
    subject_requirements: SUBJECTS.map((subject) => subjectRequirement(subject, entries, targetOfficialEntries)),
    skill_item_family_matrix: buildTargetEvidenceMatrix(archive),
    unknowns: unique(unknowns),
    source_refs: unique(entries.map((e) => e.id)),
    authority_ceiling: targetOfficialEntries.length ? 'OFFICIAL_TARGET_YEAR_SOURCE_BOUNDED' : 'PROVISIONAL_PRIOR_YEAR_EVIDENCE_ONLY'
  };
}
