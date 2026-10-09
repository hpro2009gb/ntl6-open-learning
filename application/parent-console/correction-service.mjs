import { appendLedgerRecord } from '../../persistence/ledger/writer.mjs';

function required(value,name) {
  if (value===undefined || value===null || value==='') throw new Error(`MISSING_REQUIRED:${name}`);
  return value;
}

const ACTIONS=new Set(['HOLD','RELEASE_HOLD','SUPERSEDE','RETRACT']);

export function buildParentCorrection(input) {
  const action=required(input.action,'action');
  if (!ACTIONS.has(action)) throw new Error(`INVALID_CORRECTION_ACTION:${action}`);
  return {
    contract_version:'LEDGER_CORRECTION/1.0',
    correction_id:required(input.correctionId,'correctionId'),
    target_record_id:required(input.targetRecordId,'targetRecordId'),
    action,
    reason:required(input.reason,'reason'),
    actor:'PARENT',
    created_at:required(input.createdAt,'createdAt'),
    replacement_record_id:input.replacementRecordId ?? 'NOT_APPLICABLE',
    affected_snapshot_ids:Array.isArray(input.affectedSnapshotIds) ? [...new Set(input.affectedSnapshotIds)] : [],
    affected_decision_ids:Array.isArray(input.affectedDecisionIds) ? [...new Set(input.affectedDecisionIds)] : [],
    rebuild_required:input.rebuildRequired !== false
  };
}

function accepted(status) {
  return status==='APPENDED' || status==='NO_OP_EXISTING';
}

export function recordParentCorrection(input,options={}) {
  const correction=buildParentCorrection(input);
  const ledgerFilePath=required(options.ledgerFilePath,'options.ledgerFilePath');
  const lockPath=required(options.lockPath,'options.lockPath');
  const write=appendLedgerRecord({
    recordType:'LEDGER_CORRECTION',
    schemaRef:'LEDGER_CORRECTION/1.0',
    idempotencyKey:`correction:${correction.correction_id}`,
    dedupKey:`${correction.target_record_id}|${correction.correction_id}`,
    occurredAt:correction.created_at,
    payload:correction
  },{filePath:ledgerFilePath,lockPath,appendedAt:correction.created_at});

  return {
    status:accepted(write.status) ? 'RECORDED' : 'BLOCKED',
    correction,
    write,
    rebuild_request:accepted(write.status) && correction.rebuild_required ? {
      target_record_id:correction.target_record_id,
      affected_snapshot_ids:correction.affected_snapshot_ids,
      affected_decision_ids:correction.affected_decision_ids,
      reason:`PARENT_CORRECTION:${correction.action}`
    } : null
  };
}
