import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const UNKNOWN='UNKNOWN';
const CHECK_STATUSES=new Set(['PASS','FAIL','UNKNOWN','NEEDS_HELP']);
const END_REASONS=new Set(['PEDAGOGIC_COMPLETE','LEARNER_STOPPED','PARENT_STOPPED','TIME_LIMIT','INTERRUPTED','UNKNOWN']);

function safeId(value,name='id'){
  const s=String(value??'');
  if(!s||!/^[A-Za-z0-9._-]+$/.test(s)) throw new Error(`INVALID_${name.toUpperCase()}`);
  return s;
}
function readJson(file){ return JSON.parse(fs.readFileSync(file,'utf8')); }
function arrayOr(value,fallback=[]){ return Array.isArray(value)?value:fallback; }
function valueOrUnknown(value){ return value===undefined||value===null||value===''?UNKNOWN:value; }
function stableValue(value){
  if(Array.isArray(value)) return value.map(stableValue);
  if(!value||typeof value!=='object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stableValue(value[key])]));
}
function stableDigest(value){
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}
function fileDigest(file){ return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function atomicWriteJson(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=path.join(path.dirname(file),`.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const fd=fs.openSync(temp,'wx');
  try{
    fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n','utf8');
    fs.fsyncSync(fd);
  }finally{
    fs.closeSync(fd);
  }
  fs.renameSync(temp,file);
}
function sleepSync(ms){
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
}
function pidAlive(pid){
  if(!Number.isInteger(pid)||pid<=0) return false;
  try{ process.kill(pid,0); return true; }
  catch(error){ return error?.code==='EPERM'; }
}
function normalizeCheck(check,index){
  if(!check||typeof check!=='object'||Array.isArray(check)) throw new Error('INVALID_LESSON_COMPLETION_CHECK');
  const checkId=safeId(check.check_id??check.checkId??`check-${index+1}`,'check_id');
  const status=String(check.status??check.result??UNKNOWN).trim().toUpperCase();
  if(!CHECK_STATUSES.has(status)) throw new Error('INVALID_LESSON_COMPLETION_CHECK_STATUS');
  return {
    check_id:checkId,
    status,
    required:check.required!==false,
    help_used:valueOrUnknown(check.help_used??check.helpUsed)
  };
}
function completionState(checks){
  const required=checks.filter((check)=>check.required!==false);
  if(!required.length) return UNKNOWN;
  if(required.every((check)=>check.status==='PASS')) return true;
  if(required.some((check)=>check.status==='FAIL'||check.status==='NEEDS_HELP')) return false;
  return UNKNOWN;
}
function normalizeEndReason(value,goal){
  const fallback=goal===true?'PEDAGOGIC_COMPLETE':'UNKNOWN';
  const reason=String(value??fallback).trim().toUpperCase();
  if(!END_REASONS.has(reason)) throw new Error('INVALID_LESSON_END_REASON');
  if(goal!==true&&reason==='PEDAGOGIC_COMPLETE') throw new Error('PEDAGOGIC_COMPLETE_REQUIRES_PASSING_CHECKS');
  return reason;
}

export function createLessonResultService(options={}){
  const root=path.resolve(options.root??process.cwd());
  const assessmentsDir=path.join(root,'runtime-data','parent-console','assessments');
  const lockTimeoutMs=Number.isFinite(options.lockTimeoutMs)?Math.max(10,Number(options.lockTimeoutMs)):10000;

  function assessmentDir(id){ return path.join(assessmentsDir,safeId(id,'assessment_id')); }
  function assessmentFile(id){ return path.join(assessmentDir(id),'assessment.json'); }
  function finalLessonResultFile(id){ return path.join(assessmentDir(id),'lesson-result.json'); }
  function sessionDir(id,sessionId){ return path.join(assessmentDir(id),'lesson-sessions',safeId(sessionId,'session_id')); }
  function sessionResultFile(id,sessionId){ return path.join(sessionDir(id,sessionId),'lesson-result.json'); }
  function sessionReceiptFile(id,sessionId){ return path.join(sessionDir(id,sessionId),'persistence-receipt.json'); }
  function lockDir(id){ return path.join(assessmentDir(id),'.lesson-write.lock'); }
  function readLockOwner(lock){
    try{
      const owner=readJson(path.join(lock,'owner.json'));
      if(!owner||typeof owner!=='object'||!Number.isInteger(Number(owner.pid))||!String(owner.token??'').trim()) return null;
      return {pid:Number(owner.pid),token:String(owner.token),acquired_at:owner.acquired_at??null};
    }catch{
      return null;
    }
  }
  function prepareLockCandidate(id,token){
    const candidate=path.join(assessmentDir(id),`.lesson-write.lock.${token}.tmp`);
    fs.mkdirSync(candidate);
    atomicWriteJson(path.join(candidate,'owner.json'),{pid:process.pid,token,acquired_at:new Date().toISOString()});
    return candidate;
  }
  function acquireAssessmentLock(id){
    const lock=lockDir(id);
    const deadline=Date.now()+lockTimeoutMs;
    const token=crypto.randomBytes(16).toString('hex');
    while(true){
      let candidate=null;
      try{
        candidate=prepareLockCandidate(id,token);
        fs.renameSync(candidate,lock);
        candidate=null;
        return {lock,token};
      }catch(error){
        if(candidate) fs.rmSync(candidate,{recursive:true,force:true});
        const contended=fs.existsSync(lock)&&['EEXIST','EPERM','EACCES','ENOTEMPTY'].includes(String(error?.code??''));
        if(!contended&&error?.code!=='EEXIST') throw error;
        const owner=readLockOwner(lock);
        if(!owner) throw new Error('LESSON_ASSESSMENT_LOCK_AMBIGUOUS');
        if(!pidAlive(owner.pid)){
          const tombstone=path.join(assessmentDir(id),`.lesson-write.stale.${owner.token}`);
          try{
            if(!fs.existsSync(tombstone)) fs.renameSync(lock,tombstone);
          }catch(staleError){
            if(!['ENOENT','EEXIST','EPERM','EACCES','ENOTEMPTY'].includes(String(staleError?.code??''))) throw staleError;
          }
          continue;
        }
        if(Date.now()>=deadline) throw new Error('LESSON_ASSESSMENT_LOCK_TIMEOUT');
        sleepSync(10);
      }
    }
  }
  function releaseAssessmentLock(id,held){
    const owner=readLockOwner(held.lock);
    if(!owner||owner.token!==held.token||owner.pid!==process.pid) throw new Error('LESSON_ASSESSMENT_LOCK_OWNERSHIP_LOST');
    fs.rmSync(held.lock,{recursive:true,force:true});
  }
  function withAssessmentLock(id,fn){
    const held=acquireAssessmentLock(id);
    let value;
    let failure=null;
    try{ value=fn(); }
    catch(error){ failure=error; }
    let releaseFailure=null;
    try{ releaseAssessmentLock(id,held); }
    catch(error){ releaseFailure=error; }
    if(releaseFailure) throw releaseFailure;
    if(failure) throw failure;
    return value;
  }

  function getAssessment(id){
    const file=assessmentFile(id);
    if(!fs.existsSync(file)) throw new Error('ASSESSMENT_NOT_FOUND');
    return readJson(file);
  }
  function ensureLesson(record){
    const purpose=String(record?.request?.purpose??'').toUpperCase();
    if(record?.assessment_type!=='LESSON_ACTIVITY'&&!['LEARN','TEACH','RETEACH','REVIEW'].includes(purpose)){
      throw new Error('NOT_LESSON_ACTIVITY');
    }
  }
  function ensureLearner(record,input={}){
    const expected=record?.request?.learner_id??null;
    const actual=input?.learner_id??input?.learnerId??expected;
    if(expected&&actual!==expected) throw new Error('LEARNER_ID_MISMATCH');
    return actual??UNKNOWN;
  }
  function canonicalArtifactFile(id,ref){
    const expectedRoot=path.resolve(assessmentDir(id),'artifacts');
    const file=path.resolve(root,...String(ref).split('/'));
    const relative=path.relative(expectedRoot,file);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative)) throw new Error('LESSON_ARTIFACT_OUTSIDE_CANONICAL_ROOT');
    return file;
  }
  function lessonArtifacts(record){
    return arrayOr(record?.source_artifacts,[]).filter((source)=>{
      const role=String(source?.role??'').toUpperCase();
      return ['AI_TEACHER_PACKAGE','TEACHING_ARTIFACT','HUMAN_TEACHER_GUIDE'].includes(role);
    });
  }
  function resolveArchivedLessonArtifact(record,id,input={}){
    const sources=lessonArtifacts(record);
    const requested=input.artifact_ref??input.artifactRef??record?.lesson_approval?.artifact_ref??null;
    let selected=null;
    if(requested){
      selected=sources.find((source)=>source?.repo_artifact_ref===requested||source?.name===requested)??null;
      if(!selected) throw new Error('LESSON_ARTIFACT_NOT_FOUND');
    }else{
      if(sources.length===0) throw new Error('LESSON_ARTIFACT_REQUIRED');
      if(sources.length>1) throw new Error('LESSON_ARTIFACT_AMBIGUOUS');
      selected=sources[0];
    }
    const ref=selected?.repo_artifact_ref;
    if(!ref) throw new Error('LESSON_ARTIFACT_NOT_ARCHIVED');
    const file=canonicalArtifactFile(id,ref);
    if(!fs.existsSync(file)) throw new Error('LESSON_ARTIFACT_MISSING');
    return {ref,file,sha256:fileDigest(file)};
  }
  function approvedBinding(record,id,input={}){
    const approval=record?.lesson_approval;
    if(String(approval?.status??'').toUpperCase()!=='APPROVED') throw new Error('LESSON_NOT_APPROVED');
    const approvedDigest=String(approval?.artifact_sha256??'').trim().toLowerCase();
    if(!/^[a-f0-9]{64}$/.test(approvedDigest)) throw new Error('APPROVED_LESSON_ARTIFACT_DIGEST_REQUIRED');
    const artifact=resolveArchivedLessonArtifact(record,id,{artifact_ref:approval.artifact_ref});
    if(approvedDigest!==artifact.sha256.toLowerCase()) throw new Error('APPROVED_LESSON_ARTIFACT_DIGEST_MISMATCH');
    const learnerId=ensureLearner(record,input);
    return {
      assessment_id:id,
      learner_id:learnerId,
      artifact_ref:artifact.ref,
      artifact_sha256:artifact.sha256
    };
  }
  function closeoutKey(binding,sessionId){
    return stableDigest({...binding,session_id:sessionId});
  }
  function sessionHistory(record){ return arrayOr(record?.lesson_session_history,[]); }
  function latestIncomplete(record){
    return [...sessionHistory(record)].reverse().find((entry)=>entry?.lesson_goal_completed!==true)??null;
  }
  function validateContinuation(record,binding,sessionId,input={}){
    const continuation=input.continuation_of_session_id??input.continuationOfSessionId??null;
    const latest=latestIncomplete(record);
    if(!continuation){
      if(latest&&latest.session_id!==sessionId) throw new Error('LESSON_CONTINUATION_REQUIRED');
      return null;
    }
    const previous=sessionHistory(record).find((entry)=>entry?.session_id===continuation);
    if(!previous) throw new Error('LESSON_CONTINUATION_SOURCE_NOT_FOUND');
    if(previous.session_id===sessionId) throw new Error('LESSON_CONTINUATION_REQUIRES_NEW_SESSION_ID');
    if(previous.lesson_goal_completed===true||record?.lesson_result) throw new Error('COMPLETED_SESSION_CONTINUATION_REJECTED');
    if(latest?.session_id!==continuation) throw new Error('LESSON_CONTINUATION_NOT_LATEST_INCOMPLETE');
    if(
      previous.assessment_id!==binding.assessment_id||
      previous.learner_id!==binding.learner_id||
      previous.artifact_ref!==binding.artifact_ref||
      previous.artifact_sha256!==binding.artifact_sha256
    ) throw new Error('LESSON_CONTINUATION_BINDING_MISMATCH');
    return continuation;
  }
  function buildResult(record,id,input={},existing=null){
    const binding=approvedBinding(record,id,input);
    const sessionId=safeId(input.session_id??input.sessionId??existing?.lesson_session_id,'session_id');
    const requestedContinuation=input.continuation_of_session_id??input.continuationOfSessionId??null;
    if(existing&&requestedContinuation!==null&&requestedContinuation!==existing.continuation_of_session_id){
      throw new Error('LESSON_SESSION_IDENTITY_CONFLICT');
    }
    const continuationOf=existing?.continuation_of_session_id??validateContinuation(record,binding,sessionId,input);
    const checks=arrayOr(input.completion_checks??input.completionChecks??existing?.session_closeout?.completion_checks,[]).map(normalizeCheck);
    const goal=completionState(checks);
    const endReason=normalizeEndReason(input.end_reason??input.endReason??existing?.session_closeout?.end_reason,goal);
    const completedAt=input.completed_at??input.completedAt??existing?.completed_at??new Date().toISOString();
    const taughtConcepts=arrayOr(input.taught_concepts??input.taughtConcepts??existing?.taught_concepts,record?.request?.target_concepts??[]);
    const understandingChecks=arrayOr(input.understanding_checks??input.understandingChecks??existing?.understanding_checks,[]);
    const unresolvedProvided=(input.unresolved_confusion??input.unresolvedConfusion)!==undefined||existing!==null;
    const checksProvided=(input.understanding_checks??input.understandingChecks)!==undefined||existing!==null;
    const scaffoldingProvided=(input.scaffolding_help??input.scaffoldingHelp)!==undefined||existing!==null;
    const unresolvedConfusion=arrayOr(input.unresolved_confusion??input.unresolvedConfusion??existing?.unresolved_confusion,[UNKNOWN]);
    const scaffolding=input.scaffolding_help??input.scaffoldingHelp??existing?.scaffolding_help??UNKNOWN;
    const nextAction=input.suggested_next_action??input.suggestedNextAction??existing?.suggested_next_action??record?.lesson_activity?.next_action??UNKNOWN;
    const sourceProvenance=input.source_provenance??input.sourceProvenance??existing?.source_provenance??{
      source_kind:'AI_TEACHER_SESSION',
      source_ref:`assessment:${id}`,
      observation_basis:input.observation_basis??input.observationBasis??UNKNOWN
    };
    const payload={
      contract_version:'LESSON_RESULT/1.0',
      result_id:`lesson-result-${id}-${sessionId}`,
      lesson_session_id:sessionId,
      continuation_of_session_id:continuationOf,
      assessment_id:id,
      learner_id:binding.learner_id,
      subject:record?.request?.subject??UNKNOWN,
      topic:input.topic??existing?.topic??record?.display_label??record?.request?.target_concepts?.join(' | ')??UNKNOWN,
      started_at:valueOrUnknown(input.started_at??input.startedAt??existing?.started_at),
      completed_at:completedAt,
      taught_concepts:taughtConcepts,
      understanding_checks:understandingChecks,
      scaffolding_help:scaffolding,
      unresolved_confusion:unresolvedConfusion,
      suggested_next_action:nextAction,
      source_provenance:sourceProvenance,
      completion_basis:input.completion_basis??input.completionBasis??existing?.completion_basis??'SESSION_END_CONDITION',
      observations_complete:existing?.observations_complete??(checksProvided&&scaffoldingProvided&&unresolvedProvided),
      unknown_fields:existing?.unknown_fields??[
        ...(checksProvided?[]:['understanding_checks']),
        ...(scaffoldingProvided?[]:['scaffolding_help']),
        ...(unresolvedProvided?[]:['unresolved_confusion'])
      ],
      session_closeout:{
        contract_version:'LESSON_SESSION_CLOSEOUT/1.0',
        session_ended:true,
        end_reason:endReason,
        lesson_goal_completed:goal,
        completion_checks:checks
      },
      immutable_binding:{
        ...binding,
        closeout_key:closeoutKey(binding,sessionId)
      },
      evidence_effect:'CONTEXT_ONLY_NOT_MASTERY_EVIDENCE',
      mastery_assertion:'NOT_ALLOWED'
    };
    return payload;
  }
  function receiptFor(id,result,persistedAt){
    return {
      contract_version:'LESSON_RESULT_PERSISTENCE_RECEIPT/1.0',
      status:'VERIFIED',
      saved:true,
      assessment_id:id,
      result_id:result.result_id,
      lesson_session_id:result.lesson_session_id,
      closeout_key:result.immutable_binding.closeout_key,
      persisted_at:persistedAt,
      result_ref:`runtime-data/parent-console/assessments/${id}/lesson-sessions/${result.lesson_session_id}/lesson-result.json`,
      receipt_ref:`runtime-data/parent-console/assessments/${id}/lesson-sessions/${result.lesson_session_id}/persistence-receipt.json`,
      result_sha256:stableDigest(result),
      verification_method:'ATOMIC_WRITE_READBACK_SHA256'
    };
  }
  function verifyReceipt(id,result,receipt){
    const expected=receiptFor(id,result,receipt?.persisted_at??'UNKNOWN');
    const fields=['contract_version','status','saved','assessment_id','result_id','lesson_session_id','closeout_key','result_ref','receipt_ref','result_sha256','verification_method'];
    if(!receipt||fields.some((field)=>receipt[field]!==expected[field])) throw new Error('PERSISTENCE_INTEGRITY_CONFLICT');
  }
  function historyEntry(result,receipt){
    return {
      session_id:result.lesson_session_id,
      continuation_of_session_id:result.continuation_of_session_id,
      assessment_id:result.assessment_id,
      learner_id:result.learner_id,
      artifact_ref:result.immutable_binding.artifact_ref,
      artifact_sha256:result.immutable_binding.artifact_sha256,
      closeout_key:result.immutable_binding.closeout_key,
      result_ref:receipt.result_ref,
      receipt_ref:receipt.receipt_ref,
      result_sha256:receipt.result_sha256,
      lesson_goal_completed:result.session_closeout.lesson_goal_completed,
      end_reason:result.session_closeout.end_reason,
      completed_at:result.completed_at
    };
  }
  function assertHistoryEntryCompatible(current,entry){
    const fields=['session_id','continuation_of_session_id','assessment_id','learner_id','artifact_ref','artifact_sha256','closeout_key','result_ref','receipt_ref','result_sha256','lesson_goal_completed','end_reason','completed_at'];
    if(fields.some((field)=>current?.[field]!==entry?.[field])) throw new Error('LESSON_SESSION_IDENTITY_CONFLICT');
  }
  function verifySessionResultBinding(record,id,sessionId,result){
    if(!result||result.contract_version!=='LESSON_RESULT/1.0') throw new Error('PERSISTENCE_INTEGRITY_CONFLICT');
    if(result.assessment_id!==id||result.lesson_session_id!==sessionId||result.result_id!==`lesson-result-${id}-${sessionId}`){
      throw new Error('PERSISTENCE_INTEGRITY_CONFLICT');
    }
    const binding=approvedBinding(record,id,{learner_id:result.learner_id});
    const expected={...binding,closeout_key:closeoutKey(binding,sessionId)};
    const immutable=result.immutable_binding??{};
    for(const field of ['assessment_id','learner_id','artifact_ref','artifact_sha256','closeout_key']){
      if(immutable[field]!==expected[field]) throw new Error('LESSON_SESSION_IDENTITY_CONFLICT');
    }
    if(result.session_closeout?.contract_version!=='LESSON_SESSION_CLOSEOUT/1.0'||result.session_closeout?.session_ended!==true){
      throw new Error('PERSISTENCE_INTEGRITY_CONFLICT');
    }
    if(result.continuation_of_session_id!==null&&result.continuation_of_session_id!==undefined){
      safeId(result.continuation_of_session_id,'continuation_of_session_id');
      if(result.continuation_of_session_id===sessionId) throw new Error('LESSON_SESSION_IDENTITY_CONFLICT');
    }
    return binding;
  }
  function canonicalSessionState(pairs){
    if(!pairs.length) return {chain:[],byId:new Map(),latest:null,latestIncomplete:null,completed:null};
    const byId=new Map(pairs.map((pair)=>[pair.result.lesson_session_id,pair]));
    if(byId.size!==pairs.length) throw new Error('PERSISTENCE_INTEGRITY_CONFLICT');
    const children=new Map();
    const roots=[];
    for(const pair of pairs){
      const result=pair.result;
      const parentId=result.continuation_of_session_id??null;
      if(!parentId){ roots.push(result.lesson_session_id); continue; }
      const parent=byId.get(parentId);
      if(!parent) throw new Error('LESSON_CONTINUATION_SOURCE_NOT_FOUND');
      if(parent.result.session_closeout?.lesson_goal_completed===true) throw new Error('COMPLETED_SESSION_CONTINUATION_REJECTED');
      if(children.has(parentId)) throw new Error('LESSON_CONTINUATION_CHAIN_CONFLICT');
      children.set(parentId,result.lesson_session_id);
    }
    if(roots.length!==1) throw new Error('LESSON_CONTINUATION_CHAIN_CONFLICT');
    const chain=[];
    const visited=new Set();
    let cursor=roots[0];
    while(cursor){
      if(visited.has(cursor)) throw new Error('LESSON_CONTINUATION_CHAIN_CONFLICT');
      visited.add(cursor);
      const pair=byId.get(cursor);
      if(!pair) throw new Error('LESSON_CONTINUATION_CHAIN_CONFLICT');
      chain.push(pair);
      cursor=children.get(cursor)??null;
    }
    if(visited.size!==pairs.length) throw new Error('LESSON_CONTINUATION_CHAIN_CONFLICT');
    const completedPairs=chain.filter((pair)=>pair.result.session_closeout?.lesson_goal_completed===true);
    if(completedPairs.length>1) throw new Error('PERSISTENCE_INTEGRITY_CONFLICT');
    const completed=completedPairs[0]??null;
    if(completed&&chain.at(-1)!==completed) throw new Error('COMPLETED_SESSION_CONTINUATION_REJECTED');
    const latest=chain.at(-1)??null;
    return {
      chain,
      byId,
      latest,
      latestIncomplete:latest&&latest.result.session_closeout?.lesson_goal_completed!==true?latest:null,
      completed
    };
  }
  function recoverPreResultStaging(id,sessionId){
    const dir=sessionDir(id,sessionId);
    let entries;
    try{ entries=fs.readdirSync(dir,{withFileTypes:true}); }
    catch(error){
      if(error?.code==='ENOENT') return true;
      throw error;
    }
    if(entries.length===0){
      fs.rmdirSync(dir);
      return true;
    }
    const resultTemp=/^\.lesson-result\.json\.\d+\.[a-f0-9]{12}\.tmp$/;
    if(entries.every((entry)=>entry.isFile()&&resultTemp.test(entry.name))){
      for(const entry of entries) fs.rmSync(path.join(dir,entry.name),{force:true});
      fs.rmdirSync(dir);
      return true;
    }
    return false;
  }
  function scanCanonicalSessions(record,id){
    const base=path.join(assessmentDir(id),'lesson-sessions');
    if(!fs.existsSync(base)) return canonicalSessionState([]);
    const pairs=[];
    for(const dirent of fs.readdirSync(base,{withFileTypes:true}).filter((entry)=>entry.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))){
      const sessionId=safeId(dirent.name,'session_id');
      const resultFile=sessionResultFile(id,sessionId);
      const receiptFile=sessionReceiptFile(id,sessionId);
      const hasResult=fs.existsSync(resultFile);
      const hasReceipt=fs.existsSync(receiptFile);
      if(!hasResult&&hasReceipt) throw new Error('PERSISTENCE_INTEGRITY_CONFLICT');
      if(!hasResult&&!hasReceipt){
        if(recoverPreResultStaging(id,sessionId)) continue;
        throw new Error('PERSISTENCE_INTEGRITY_CONFLICT');
      }
      let result;
      try{ result=readJson(resultFile); }
      catch{ throw new Error('PERSISTENCE_INTEGRITY_CONFLICT'); }
      verifySessionResultBinding(record,id,sessionId,result);
      let receipt;
      if(hasReceipt){
        try{ receipt=readJson(receiptFile); }
        catch{ throw new Error('PERSISTENCE_INTEGRITY_CONFLICT'); }
        verifyReceipt(id,result,receipt);
      }else{
        receipt=receiptFor(id,result,new Date().toISOString());
        atomicWriteJson(receiptFile,receipt);
        verifyReceipt(id,result,readJson(receiptFile));
      }
      pairs.push({result,receipt});
    }
    return canonicalSessionState(pairs);
  }
  function reconcileAssessmentFromCanonical(record,id,state){
    if(!state.chain.length){
      if(sessionHistory(record).length) throw new Error('PERSISTENCE_INTEGRITY_CONFLICT');
      return record;
    }
    const canonicalEntries=state.chain.map((pair)=>historyEntry(pair.result,pair.receipt));
    const canonicalById=new Map(canonicalEntries.map((entry)=>[entry.session_id,entry]));
    for(const existing of sessionHistory(record)){
      const canonical=canonicalById.get(existing?.session_id);
      if(!canonical) throw new Error('PERSISTENCE_INTEGRITY_CONFLICT');
      assertHistoryEntryCompatible(existing,canonical);
    }
    const before=stableDigest(record);
    record.lesson_session_history=canonicalEntries;
    record.active_lesson_session_id=null;
    if(state.completed){
      record.lesson_result=state.completed.result;
      record.lesson_result_persistence_receipt=state.completed.receipt;
      record.status='COMPLETED_CONTEXT';
      record.completed_at=state.completed.result.completed_at;
    }else{
      delete record.lesson_result;
      delete record.lesson_result_persistence_receipt;
      record.status='SESSION_ENDED_INCOMPLETE';
      record.completed_at=null;
    }
    if(stableDigest(record)!==before) atomicWriteJson(assessmentFile(id),record);
    const readback=getAssessment(id);
    for(const expected of canonicalEntries){
      const actual=sessionHistory(readback).find((entry)=>entry?.session_id===expected.session_id);
      if(!actual) throw new Error('LESSON_RESULT_ASSESSMENT_LINK_VERIFICATION_FAILED');
      assertHistoryEntryCompatible(actual,expected);
    }
    return readback;
  }
  function assessmentLinkCoherent(record,result,receipt){
    const entry=historyEntry(result,receipt);
    const linked=sessionHistory(record).find((item)=>item?.session_id===result.lesson_session_id);
    if(!linked) return false;
    assertHistoryEntryCompatible(linked,entry);
    if(result.session_closeout.lesson_goal_completed===true){
      return record?.status==='COMPLETED_CONTEXT'&&
        record?.lesson_result?.result_id===result.result_id&&
        record?.lesson_result_persistence_receipt?.result_sha256===receipt.result_sha256&&
        record?.completed_at===result.completed_at;
    }
    return record?.status==='SESSION_ENDED_INCOMPLETE'&&
      !record?.lesson_result&&
      !record?.lesson_result_persistence_receipt&&
      (record?.completed_at===null||record?.completed_at===undefined);
  }
  function linkAssessment(record,id,result,receipt){
    const history=sessionHistory(record);
    const existingIndex=history.findIndex((entry)=>entry?.session_id===result.lesson_session_id);
    const entry=historyEntry(result,receipt);
    if(existingIndex>=0){
      const current=history[existingIndex];
      assertHistoryEntryCompatible(current,entry);
      history[existingIndex]=entry;
    }else{
      history.push(entry);
    }
    record.lesson_session_history=history;
    record.active_lesson_session_id=null;
    if(result.session_closeout.lesson_goal_completed===true){
      record.lesson_result=result;
      record.lesson_result_persistence_receipt=receipt;
      record.status='COMPLETED_CONTEXT';
      record.completed_at=result.completed_at;
    }else{
      delete record.lesson_result;
      delete record.lesson_result_persistence_receipt;
      record.status='SESSION_ENDED_INCOMPLETE';
      record.completed_at=null;
    }
    atomicWriteJson(assessmentFile(id),record);
    const readback=getAssessment(id);
    const linked=sessionHistory(readback).find((item)=>item.session_id===result.lesson_session_id);
    if(!linked||linked.result_sha256!==receipt.result_sha256||readback.status!==record.status){
      throw new Error('LESSON_RESULT_ASSESSMENT_LINK_VERIFICATION_FAILED');
    }
    return readback;
  }
  function promoteFinal(id,result){
    if(result.session_closeout.lesson_goal_completed!==true) return null;
    const file=finalLessonResultFile(id);
    if(fs.existsSync(file)){
      const existing=readJson(file);
      if(stableDigest(existing)!==stableDigest(result)) throw new Error('FINAL_LESSON_RESULT_CONFLICT');
      return file;
    }
    atomicWriteJson(file,result);
    const readback=readJson(file);
    if(stableDigest(readback)!==stableDigest(result)) throw new Error('FINAL_LESSON_RESULT_PERSISTENCE_VERIFICATION_FAILED');
    return file;
  }

  function persistLessonResult(id,input={}){
    id=safeId(id,'assessment_id');
    return withAssessmentLock(id,()=>persistLessonResultLocked(id,input));
  }

  function persistLessonResultLocked(id,input={}){
    let record=getAssessment(id);
    ensureLesson(record);
    approvedBinding(record,id,input);
    const sessionId=safeId(input.session_id??input.sessionId,'session_id');
    const canonical=scanCanonicalSessions(record,id);
    const existingCanonical=canonical.byId.get(sessionId)??null;
    if(canonical.completed&&canonical.completed.result.lesson_session_id!==sessionId){
      throw new Error('COMPLETED_LESSON_ALREADY_CLOSED');
    }
    if(!existingCanonical&&canonical.latestIncomplete){
      const requested=input.continuation_of_session_id??input.continuationOfSessionId??null;
      if(requested!==canonical.latestIncomplete.result.lesson_session_id) throw new Error('LESSON_CONTINUATION_REQUIRED');
    }
    record=reconcileAssessmentFromCanonical(record,id,canonical);
    if(record?.lesson_result&&record.lesson_result.lesson_session_id!==sessionId){
      throw new Error('COMPLETED_LESSON_ALREADY_CLOSED');
    }
    const resultFile=sessionResultFile(id,sessionId);
    const receiptFile=sessionReceiptFile(id,sessionId);
    const resultExists=fs.existsSync(resultFile);
    const receiptExists=fs.existsSync(receiptFile);
    if(!resultExists&&receiptExists) throw new Error('PERSISTENCE_INTEGRITY_CONFLICT');
    const existingResult=resultExists?readJson(resultFile):null;
    const candidate=buildResult(record,id,input,existingResult);
    const candidateDigest=stableDigest(candidate);

    let result=candidate;
    if(existingResult){
      const existingDigest=stableDigest(existingResult);
      if(existingDigest!==candidateDigest) throw new Error('LESSON_SESSION_IDENTITY_CONFLICT');
      result=existingResult;
    }else{
      atomicWriteJson(resultFile,result);
      const readback=readJson(resultFile);
      if(stableDigest(readback)!==candidateDigest) throw new Error('LESSON_RESULT_PERSISTENCE_VERIFICATION_FAILED');
    }

    let receipt;
    if(fs.existsSync(receiptFile)){
      receipt=readJson(receiptFile);
      verifyReceipt(id,result,receipt);
    }else{
      receipt=receiptFor(id,result,input.persisted_at??input.persistedAt??new Date().toISOString());
      atomicWriteJson(receiptFile,receipt);
      verifyReceipt(id,result,readJson(receiptFile));
    }

    record=getAssessment(id);
    if(!assessmentLinkCoherent(record,result,receipt)){
      record=linkAssessment(record,id,result,receipt);
    }

    let finalRef=null;
    if(result.session_closeout.lesson_goal_completed===true){
      const finalFile=promoteFinal(id,result);
      finalRef=finalFile?`runtime-data/parent-console/assessments/${id}/lesson-result.json`:null;
      const finalRecord=getAssessment(id);
      if(finalRecord?.lesson_result?.result_id!==result.result_id) throw new Error('LESSON_RESULT_FINAL_LINK_VERIFICATION_FAILED');
    }

    return {
      assessment_id:id,
      status:result.session_closeout.lesson_goal_completed===true?'COMPLETED_CONTEXT':'SESSION_ENDED_INCOMPLETE',
      write_status:existingResult?'NO_OP_EXISTING':'APPENDED',
      lesson_result:result,
      persistence_receipt:receipt,
      final_result_ref:finalRef
    };
  }

  function approveLesson(id,input={}){
    id=safeId(id,'assessment_id');
    return withAssessmentLock(id,()=>approveLessonLocked(id,input));
  }

  function approveLessonLocked(id,input={}){
    const record=getAssessment(id);
    ensureLesson(record);
    const approvedAt=input.approved_at??input.approvedAt??new Date().toISOString();
    const artifact=resolveArchivedLessonArtifact(record,id,input);
    const approval={
      contract_version:'LESSON_APPROVAL/1.0',
      status:'APPROVED',
      assessment_id:id,
      learner_id:ensureLearner(record,input),
      approved_at:approvedAt,
      approved_by:'PARENT',
      artifact_ref:artifact.ref,
      artifact_sha256:artifact.sha256,
      source_ref:input.source_ref??input.sourceRef??'PARENT_CHAT_APPROVAL'
    };
    const existing=record?.lesson_approval??null;
    if(existing){
      if(existing.status==='APPROVED'&&existing.artifact_ref===artifact.ref&&(!existing.artifact_sha256||existing.artifact_sha256===artifact.sha256)){
        return {assessment_id:id,status:'APPROVED',write_status:'NO_OP_EXISTING',approval:existing,persistence_receipt:record.lesson_approval_persistence_receipt??null};
      }
      throw new Error('LESSON_APPROVAL_CONFLICT');
    }
    const receipt={
      contract_version:'LESSON_APPROVAL_PERSISTENCE_RECEIPT/1.0',
      status:'VERIFIED',
      saved:true,
      assessment_id:id,
      persisted_at:approvedAt,
      storage_ref:`runtime-data/parent-console/assessments/${id}/assessment.json`,
      artifact_ref:artifact.ref,
      artifact_sha256:artifact.sha256,
      verification_method:'ATOMIC_WRITE_READBACK_IDENTITY'
    };
    record.lesson_approval=approval;
    record.lesson_approval_persistence_receipt=receipt;
    atomicWriteJson(assessmentFile(id),record);
    const readback=getAssessment(id);
    if(
      readback?.lesson_approval?.status!=='APPROVED'||
      readback?.lesson_approval?.artifact_sha256!==artifact.sha256||
      readback?.lesson_approval_persistence_receipt?.status!=='VERIFIED'
    ) throw new Error('LESSON_APPROVAL_PERSISTENCE_VERIFICATION_FAILED');
    return {assessment_id:id,status:'APPROVED',write_status:'APPENDED',approval:readback.lesson_approval,persistence_receipt:readback.lesson_approval_persistence_receipt};
  }

  return Object.freeze({persistLessonResult,approveLesson});
}
