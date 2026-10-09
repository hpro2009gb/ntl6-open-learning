import path from 'node:path';
import { appendJsonLine, readJsonl, sha256, stableStringify, withFileLock } from './store.mjs';

const TYPE_TO_SCHEMA = Object.freeze({
  EVIDENCE_OPPORTUNITY: 'EVIDENCE_OPPORTUNITY/1.0',
  EVIDENCE_ELIGIBILITY: 'EVIDENCE_ELIGIBILITY/1.0',
  CONCEPT_STATE: 'CONCEPT_STATE/1.0',
  STRATEGY_DECISION: 'STRATEGY_DECISION/1.0',
  DELIVERED_INTERVENTION: 'DELIVERED_INTERVENTION/1.0',
  STRATEGY_OUTCOME: 'STRATEGY_OUTCOME/1.0',
  LEDGER_CORRECTION: 'LEDGER_CORRECTION/1.0'
});

function nonempty(value) {
  return value !== undefined && value !== null && value !== '';
}

function semanticFromInput(input) {
  return {
    record_type: input.recordType,
    schema_ref: input.schemaRef,
    idempotency_key: input.idempotencyKey,
    dedup_key: input.dedupKey,
    occurred_at: input.occurredAt,
    revision: input.revision ?? 1,
    supersedes_record_id: input.supersedesRecordId ?? 'NOT_APPLICABLE',
    payload: input.payload
  };
}

function semanticFromRecord(record) {
  return {
    record_type: record.record_type,
    schema_ref: record.schema_ref,
    idempotency_key: record.idempotency_key,
    dedup_key: record.dedup_key,
    occurred_at: record.occurred_at,
    revision: record.revision,
    supersedes_record_id: record.supersedes_record_id,
    payload: record.payload
  };
}

export function validateLedgerAppendInput(input) {
  const errors = [];
  if (!TYPE_TO_SCHEMA[input?.recordType]) errors.push('INVALID_RECORD_TYPE');
  if (TYPE_TO_SCHEMA[input?.recordType] && input.schemaRef !== TYPE_TO_SCHEMA[input.recordType]) errors.push('SCHEMA_REF_MISMATCH');
  for (const key of ['idempotencyKey','dedupKey','occurredAt']) if (!nonempty(input?.[key])) errors.push(`MISSING_${key}`);
  if (!input?.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) errors.push('INVALID_PAYLOAD');
  if (input?.revision !== undefined && (!Number.isInteger(input.revision) || input.revision < 1)) errors.push('INVALID_REVISION');
  return errors;
}

export function appendLedgerRecord(input, options = {}) {
  const errors = validateLedgerAppendInput(input);
  if (errors.length) return { status: 'REJECTED', errors };

  const filePath = path.resolve(options.filePath ?? 'runtime-data/ledger/evidence.jsonl');
  const lockPath = path.resolve(options.lockPath ?? `${filePath}.lock`);
  const semantic = semanticFromInput(input);

  return withFileLock(lockPath, () => {
    const rows = readJsonl(filePath);
    const existing = rows.find((row) => row.idempotency_key === input.idempotencyKey);
    if (existing) {
      return stableStringify(semanticFromRecord(existing)) === stableStringify(semantic)
        ? { status: 'NO_OP_EXISTING', recordId: existing.record_id, revision: existing.revision }
        : { status: 'CONFLICT', recordId: existing.record_id, revision: existing.revision };
    }

    const record = {
      ledger_record_version: 'CANONICAL_LEDGER_RECORD/1.0',
      record_id: `lr-${sha256(input.idempotencyKey).slice(0, 24)}`,
      record_type: input.recordType,
      schema_ref: input.schemaRef,
      idempotency_key: input.idempotencyKey,
      dedup_key: input.dedupKey,
      occurred_at: input.occurredAt,
      appended_at: options.appendedAt ?? new Date().toISOString(),
      revision: input.revision ?? 1,
      supersedes_record_id: input.supersedesRecordId ?? 'NOT_APPLICABLE',
      payload: input.payload
    };
    appendJsonLine(filePath, record);
    return { status: 'APPENDED', recordId: record.record_id, revision: record.revision, record };
  });
}

export function readLedgerRecords(filePath) {
  return readJsonl(path.resolve(filePath));
}
