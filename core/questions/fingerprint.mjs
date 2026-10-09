import crypto from 'node:crypto';

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function normalizeQuestionText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
    .toLocaleLowerCase('vi');
}

export function stableQuestionValue(value) {
  if (typeof value === 'string') return normalizeQuestionText(value);
  return stableValue(value);
}

export function hashStable(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableQuestionValue(value))).digest('hex');
}

export function exactQuestionFingerprint(item) {
  const prompt = item?.prompt_or_artifact_ref ?? item?.prompt ?? '';
  const answer = item?.answer_or_scoring_ref ?? item?.answer ?? null;
  const rubric = {
    rubric_ref: item?.rubric_ref ?? 'UNKNOWN',
    rubric_version: item?.rubric_version ?? 'UNKNOWN',
    response_format: item?.response_format ?? 'UNKNOWN'
  };
  return 'sha256:' + hashStable({ prompt:normalizeQuestionText(prompt), answer, rubric });
}

export function structuralQuestionSignature(item, family = null) {
  const familyId = item?.family_id ?? family?.family_id ?? 'UNKNOWN';
  const conceptId = item?.concept_id ?? family?.concept_id ?? 'UNKNOWN';
  const conceptVersion = item?.concept_version ?? family?.concept_version ?? 'UNKNOWN';
  const representation = family?.representation ?? item?.representation ?? item?.response_format ?? 'UNKNOWN';
  const contextType = family?.context_type ?? item?.context_type ?? 'UNKNOWN';
  const difficulty = item?.difficulty_band ?? family?.difficulty_band ?? 'UNKNOWN';
  const answerType = item?.answer_or_scoring_ref?.type ?? item?.answer_type ?? 'UNKNOWN';
  return 'struct:' + hashStable({
    family_id:familyId,
    concept_id:conceptId,
    concept_version:conceptVersion,
    representation,
    context_type:contextType,
    difficulty_band:difficulty,
    answer_type:answerType
  });
}
