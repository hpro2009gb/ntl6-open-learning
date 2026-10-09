import path from 'node:path';
import { appendJsonLine, readJsonl, stableStringify, withFileLock } from '../ledger/store.mjs';

const STATES = new Set(['NONE','GENERATED_CANDIDATE','VALIDATED','PROMOTED','RETIRED']);
const NEXT = Object.freeze({
  NONE: new Set(['GENERATED_CANDIDATE']),
  GENERATED_CANDIDATE: new Set(['VALIDATED','RETIRED']),
  VALIDATED: new Set(['PROMOTED','RETIRED']),
  PROMOTED: new Set(['RETIRED']),
  RETIRED: new Set()
});

export function validateLifecycleEvent(event) {
  const errors = [];
  if (event?.contract_version !== 'QUESTION_LIFECYCLE_EVENT/1.0') errors.push('INVALID_CONTRACT_VERSION');
  for (const key of ['event_id','item_id','actor','reason','occurred_at','item_fingerprint','family_signature']) {
    if (!event?.[key]) errors.push(`MISSING_${key}`);
  }
  if (!STATES.has(event?.previous_state)) errors.push('INVALID_PREVIOUS_STATE');
  if (!STATES.has(event?.new_state) || event?.new_state === 'NONE') errors.push('INVALID_NEW_STATE');
  if (!Array.isArray(event?.validation_refs)) errors.push('INVALID_VALIDATION_REFS');
  if (STATES.has(event?.previous_state) && !NEXT[event.previous_state]?.has(event?.new_state)) errors.push('ILLEGAL_TRANSITION');
  return errors;
}

export function appendQuestionLifecycleEvent(event, options = {}) {
  const errors = validateLifecycleEvent(event);
  if (errors.length) return { status:'REJECTED', errors };
  const filePath = path.resolve(options.filePath ?? 'runtime-data/question-bank/lifecycle-events.jsonl');
  const lockPath = path.resolve(options.lockPath ?? `${filePath}.lock`);
  return withFileLock(lockPath, () => {
    const rows = readJsonl(filePath);
    const sameEvent = rows.find((row) => row.event_id === event.event_id);
    if (sameEvent) {
      return stableStringify(sameEvent) === stableStringify(event)
        ? { status:'NO_OP_EXISTING', eventId:event.event_id }
        : { status:'CONFLICT', eventId:event.event_id };
    }
    const itemRows = rows.filter((row) => row.item_id === event.item_id);
    const actualState = itemRows.length ? itemRows[itemRows.length - 1].new_state : 'NONE';
    if (actualState !== event.previous_state) return { status:'CONFLICT', eventId:event.event_id, expectedPreviousState:actualState };
    appendJsonLine(filePath, event);
    return { status:'APPENDED', eventId:event.event_id, event };
  });
}

export function appendQuestionCandidate(candidate, options = {}) {
  if (!candidate || typeof candidate !== 'object' || !candidate.item_id) return { status:'REJECTED', errors:['MISSING_item_id'] };
  const filePath = path.resolve(options.filePath ?? 'runtime-data/question-bank/candidates.jsonl');
  const lockPath = path.resolve(options.lockPath ?? `${filePath}.lock`);
  return withFileLock(lockPath, () => {
    const rows = readJsonl(filePath);
    const existing = rows.find((row) => row.item_id === candidate.item_id);
    if (existing) {
      return stableStringify(existing) === stableStringify(candidate)
        ? { status:'NO_OP_EXISTING', itemId:candidate.item_id }
        : { status:'CONFLICT', itemId:candidate.item_id };
    }
    appendJsonLine(filePath, candidate);
    return { status:'APPENDED', itemId:candidate.item_id, candidate };
  });
}

export function readQuestionLifecycleEvents(filePath) {
  return readJsonl(path.resolve(filePath));
}
export function readQuestionCandidates(filePath) {
  return readJsonl(path.resolve(filePath));
}
