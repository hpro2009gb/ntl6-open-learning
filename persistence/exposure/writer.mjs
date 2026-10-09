import path from 'node:path';
import { appendJsonLine, readJsonl, stableStringify, withFileLock } from '../ledger/store.mjs';

const PURPOSES = new Set(['DIAGNOSTIC','PRACTICE','REPAIR','FRESH_RECHECK','WEEKLY_CHECK','MOCK']);
const TYPES = new Set(['PREVIEWED_TO_PARENT','ASSIGNED_TO_LEARNER','SUBMITTED','HELPED','ANSWER_EXPOSED','RECHECK_USED']);
const HELP = new Set(['NONE_OBSERVED','GENERAL_PROMPT','TARGET_HINT','WORKED_STEP_OR_ANSWER','UNKNOWN']);
const ANSWER = new Set(['NONE_OBSERVED','PARTIAL','WORKED_ANSWER','UNKNOWN']);

export function validateExposure(event) {
  const errors = [];
  if (event?.contract_version !== 'QUESTION_EXPOSURE/1.0') errors.push('INVALID_CONTRACT_VERSION');
  for (const key of ['exposure_id','learner_id','assessment_id','item_id','family_signature','occurred_at','source_ref']) {
    if (!event?.[key]) errors.push(`MISSING_${key}`);
  }
  if (!PURPOSES.has(event?.purpose)) errors.push('INVALID_PURPOSE');
  if (!TYPES.has(event?.exposure_type)) errors.push('INVALID_EXPOSURE_TYPE');
  if (!HELP.has(event?.help_level)) errors.push('INVALID_HELP_LEVEL');
  if (!ANSWER.has(event?.answer_exposure)) errors.push('INVALID_ANSWER_EXPOSURE');
  return errors;
}

export function appendExposureEvent(event, options = {}) {
  const errors = validateExposure(event);
  if (errors.length) return { status:'REJECTED', errors };
  const filePath = path.resolve(options.filePath ?? 'runtime-data/exposure/events.jsonl');
  const lockPath = path.resolve(options.lockPath ?? `${filePath}.lock`);
  return withFileLock(lockPath, () => {
    const rows = readJsonl(filePath);
    const existing = rows.find((row) => row.exposure_id === event.exposure_id);
    if (existing) {
      return stableStringify(existing) === stableStringify(event)
        ? { status:'NO_OP_EXISTING', exposureId:event.exposure_id }
        : { status:'CONFLICT', exposureId:event.exposure_id };
    }
    appendJsonLine(filePath, event);
    return { status:'APPENDED', exposureId:event.exposure_id, event };
  });
}

export function readExposureEvents(filePath) {
  return readJsonl(path.resolve(filePath));
}
