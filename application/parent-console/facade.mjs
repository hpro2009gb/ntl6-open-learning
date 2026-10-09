import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAssessmentCandidate } from './assessment-service.mjs';
import { createAssessmentHistoryService } from './assessment-history-service.mjs';
import { createMaterialResolver } from './material-resolver-service.mjs';
import { createLessonResultService } from './lesson-result-service.mjs';
import { buildCurrentLearningContext } from './current-learning-context-service.mjs';
import { createSourceFusionService } from './source-fusion-service.mjs';
import { captureAssessmentResult } from './result-service.mjs';
import { recordParentCorrection } from './correction-service.mjs';
import { buildCurrentRoadmap, buildCurrentLearningModels } from './roadmap-service.mjs';
import { loadNtl6TargetModel, persistTargetSnapshot } from './target-service.mjs';
import { buildParentDashboard } from './dashboard-query.mjs';
import { resolveSchoolPlanningContext } from './school-context-service.mjs';
import { resolveUniClassPlanningContext, mergePlanningWorkload } from './uniclass-context-service.mjs';
import { createBaselineAssessment, acceptBaselineAssessment, baselineRoadmapContext, readBaselineAnchor, gradeBaselineResponse } from './baseline-service.mjs';
import { readExposureEvents, appendExposureEvent } from '../../persistence/exposure/writer.mjs';
import { readQuestionCandidates, readQuestionLifecycleEvents, appendQuestionCandidate, appendQuestionLifecycleEvent } from '../../persistence/question-bank/writer.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT=path.resolve(HERE,'..','..');

function safeId(value,name='id') {
  const s=String(value??'');
  if (!s||!/^[A-Za-z0-9._-]+$/.test(s)) throw new Error(`INVALID_${name.toUpperCase()}`);
  return s;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file,'utf8')); }
function writeJson(file,value) { fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n','utf8'); }
function existsReadJson(file,fallback) { return fs.existsSync(file)?readJson(file):fallback; }

const SESSION_MODES=new Set(['LESSON','GUIDED_PRACTICE','INDEPENDENT_PRACTICE','TEST_RECHECK']);
const FEEDBACK_BY_MODE=Object.freeze({
  LESSON:'IMMEDIATE_TEACHING',
  GUIDED_PRACTICE:'IMMEDIATE_COACHING',
  INDEPENDENT_PRACTICE:'AFTER_SUBMISSION',
  TEST_RECHECK:'SEALED_UNTIL_SUBMISSION'
});
const EVIDENCE_CEILING_BY_MODE=Object.freeze({
  LESSON:'CONTEXT_ONLY_NOT_MASTERY_EVIDENCE',
  GUIDED_PRACTICE:'PRACTICE_CONTEXT_ERROR_HELP_ONLY',
  INDEPENDENT_PRACTICE:'CONDITIONAL_INDEPENDENCE_EXISTING_POLICY',
  TEST_RECHECK:'CONDITIONAL_FRESH_RECHECK_EXISTING_POLICY'
});
function upper(value){ return String(value??'').trim().toUpperCase(); }
function defaultAssessmentSessionMode(purpose){
  const p=upper(purpose);
  if(p==='PRACTICE'||p==='REPAIR') return 'GUIDED_PRACTICE';
  if(['DIAGNOSTIC','FRESH_RECHECK','WEEKLY_CHECK','MOCK'].includes(p)) return 'TEST_RECHECK';
  throw new Error('ASSESSMENT_PURPOSE_SESSION_MODE_UNMAPPED');
}
function normalizeAssessmentModeRequest(request){
  const purpose=upper(request?.purpose);
  const explicit=upper(request?.session_mode??request?.parent_constraints?.session_mode);
  const mode=explicit||defaultAssessmentSessionMode(purpose);
  if(!SESSION_MODES.has(mode)||mode==='LESSON') throw new Error('ASSESSMENT_SESSION_MODE_INVALID');
  if(['DIAGNOSTIC','FRESH_RECHECK','WEEKLY_CHECK','MOCK'].includes(purpose)&&mode!=='TEST_RECHECK'){
    throw new Error('ASSESSMENT_SESSION_MODE_PURPOSE_MISMATCH');
  }
  const expectedFeedback=FEEDBACK_BY_MODE[mode];
  const suppliedFeedback=upper(request?.feedback_policy??request?.parent_constraints?.feedback_policy);
  if(suppliedFeedback&&suppliedFeedback!==expectedFeedback) throw new Error('FEEDBACK_POLICY_MODE_MISMATCH');
  const suppliedCeiling=upper(request?.expected_evidence_ceiling??request?.parent_constraints?.expected_evidence_ceiling);
  const expectedCeiling=EVIDENCE_CEILING_BY_MODE[mode];
  if(suppliedCeiling&&suppliedCeiling!==expectedCeiling) throw new Error('EVIDENCE_CEILING_MODE_MISMATCH');
  return {...request,session_mode:mode,feedback_policy:expectedFeedback,expected_evidence_ceiling:expectedCeiling};
}
function sessionModeForRecord(record){
  const explicit=upper(record?.request?.session_mode??record?.session_mode??record?.request?.parent_constraints?.session_mode);
  if(explicit){
    if(!SESSION_MODES.has(explicit)) throw new Error('SESSION_MODE_INVALID');
    return explicit;
  }
  const type=upper(record?.assessment_type);
  const purpose=upper(record?.request?.purpose);
  if(type.includes('LESSON_ACTIVITY')||['LEARN','TEACH','RETEACH','REVIEW'].includes(purpose)) return 'LESSON';
  return defaultAssessmentSessionMode(purpose||'DIAGNOSTIC');
}
function evidenceResultForMode(result,mode){
  if(mode!=='GUIDED_PRACTICE'||upper(result?.helpLevel)!=='NONE_OBSERVED') return result;
  return {
    ...result,
    helpLevel:'UNKNOWN',
    helpSource:result?.helpSource??'SESSION_MODE_POLICY',
    helpTiming:result?.helpTiming??'UNKNOWN',
    helpObservationBasis:'GUIDED_PRACTICE_MODE_DOES_NOT_ESTABLISH_INDEPENDENCE'
  };
}

export function createParentConsoleFacade(options={}) {
  const root=path.resolve(options.root??DEFAULT_ROOT);
  const learnerId=safeId(options.learnerId??'default-learner','learner_id');
  const runtime=path.join(root,'runtime-data');
  const ledgerPath=path.join(runtime,'ledger','evidence.jsonl');
  const ledgerLock=`${ledgerPath}.lock`;
  const exposurePath=path.join(runtime,'exposure','events.jsonl');
  const exposureLock=`${exposurePath}.lock`;
  const candidatePath=path.join(runtime,'question-bank','candidates.jsonl');
  const candidateLock=`${candidatePath}.lock`;
  const lifecyclePath=path.join(runtime,'question-bank','lifecycle-events.jsonl');
  const lifecycleLock=`${lifecyclePath}.lock`;
  const assessmentsDir=path.join(runtime,'parent-console','assessments');
  const assessmentHistory=createAssessmentHistoryService({root});
  const materialResolver=options.materialResolver??createMaterialResolver({root});
  const lessonResults=options.lessonResults??createLessonResultService({root});
  const sourceFusion=options.sourceFusion??createSourceFusionService({root});

  function assessmentFile(id) {
    return path.join(assessmentsDir,safeId(id,'assessment_id'),'assessment.json');
  }
  function persistAssessmentRecord(stored,persistedAt=new Date().toISOString()) {
    const id=safeId(stored?.candidate?.assessment_id??stored?.assessment_id,'assessment_id');
    const receipt={
      contract_version:'ASSESSMENT_PERSISTENCE_RECEIPT/1.0',
      status:'VERIFIED',
      assessment_id:id,
      persisted_at:persistedAt,
      storage_ref:`runtime-data/parent-console/assessments/${id}/assessment.json`,
      verification_method:'WRITE_READBACK_IDENTITY'
    };
    stored.persistence_receipt=receipt;
    const file=assessmentFile(id);
    writeJson(file,stored);
    const readback=readJson(file);
    if(readback?.candidate?.assessment_id!==id||JSON.stringify(readback?.persistence_receipt)!==JSON.stringify(receipt)) {
      throw new Error('ASSESSMENT_PERSISTENCE_VERIFICATION_FAILED');
    }
    return readback;
  }
  function currentTarget(asOf=new Date().toISOString(),version='R1-PROVISIONAL') {
    return loadNtl6TargetModel({root,asOf,version,targetYear:'2027'});
  }
  function planningContext(asOf=new Date().toISOString()) {
    const school=resolveSchoolPlanningContext({root,asOf,classId:'DEMO_CLASS'});
    const uniclass=resolveUniClassPlanningContext({root,asOf});
    return {
      ...school,
      workload_context:mergePlanningWorkload(school.workload_context,uniclass),
      uniclass_context:uniclass
    };
  }
  function learningContext(input={}) {
    const asOf=input.as_of??input.asOf??new Date().toISOString();
    const school=resolveSchoolPlanningContext({root,asOf,classId:'DEMO_CLASS'});
    const uniclass=resolveUniClassPlanningContext({root,asOf});
    return buildCurrentLearningContext({
      as_of:asOf,
      school_context:school,
      school_position_context:input.school_position_context??input.schoolPositionContext??null,
      uniclass_context:uniclass,
      uniclass_refresh_outcome:input.uniclass_refresh_outcome??input.uniclassRefreshOutcome??null
    });
  }
  function sourceFusionPack(input={}) {
    const asOf=input.as_of??input.asOf??new Date().toISOString();
    return sourceFusion.fuse({
      ...input,
      learner_id:learnerId,
      current_learning_context:input.current_learning_context??input.currentLearningContext??learningContext({asOf})
    });
  }
  function dashboard({subject=null,asOf=new Date().toISOString()}={}) {
    const targetModel=currentTarget(asOf);
    const baseline=baselineRoadmapContext({learnerId},{root});
    const planning=planningContext(asOf);
    const roadmap=buildCurrentRoadmap({root,learnerId,asOf,targetModel,policyVersion:'PARENT_CONSOLE_R1',workloadContext:planning.workload_context,...baseline});
    return {...buildParentDashboard({learnerId,roadmap,targetModel,subjectFilter:null}),planning_context:planning};
  }
  function progress({subject=null,asOf=new Date().toISOString()}={}) {
    const targetModel=currentTarget(asOf);
    const baseline=baselineRoadmapContext({learnerId},{root});
    const planning=planningContext(asOf);
    const roadmap=buildCurrentRoadmap({root,learnerId,asOf,targetModel,policyVersion:'PARENT_CONSOLE_R1',workloadContext:planning.workload_context,...baseline});
    const models=buildCurrentLearningModels({root,learnerId,asOf,policyVersion:'PARENT_CONSOLE_R1',workloadContext:planning.workload_context});
    return {
      contract_version:'PARENT_PROGRESS/1.0',
      learner_id:learnerId,
      as_of:asOf,
      planning_context:planning,
      roadmap,
      concepts:models.filter((m)=>!subject||m.concept.subject===subject).map((m)=>({
        concept:m.concept,
        state:m.state,
        trend:m.trend,
        diagnosis:m.diagnosis,
        priority:m.priority,
        decision:m.decision
      }))
    };
  }
  function createAssessment(request) {
    request=normalizeAssessmentModeRequest(request);
    if (request.learner_id!==learnerId) throw new Error('LEARNER_ID_MISMATCH');
    const exposures=fs.existsSync(exposurePath)?readExposureEvents(exposurePath):[];
    const result=createAssessmentCandidate(request,{root,exposures,exposureKnowledge:'KNOWN',asOf:request.requested_at});
    const stored=persistAssessmentRecord({...result,request,created_at:request.requested_at,status:result.candidate.status});

    const keyById=new Map(result.preview.parent_key.map((x)=>[x.item_id,x]));
    const generatedById=new Map(result.preview.student_items.filter((x)=>result.candidate.generated_items.includes(x.item_id)).map((x)=>[x.item_id,{...x,answer_or_scoring_ref:keyById.get(x.item_id)?.answer_or_scoring_ref??null}]));
    for (const id of result.candidate.generated_items) {
      const item=generatedById.get(id);
      if (!item) continue;
      const candidateWrite=appendQuestionCandidate(item,{filePath:candidatePath,lockPath:candidateLock});
      if (!['APPENDED','NO_OP_EXISTING'].includes(candidateWrite.status)) continue;
      const baseEvent={
        contract_version:'QUESTION_LIFECYCLE_EVENT/1.0',
        item_id:id,actor:'SYSTEM',occurred_at:request.requested_at,
        item_fingerprint:item.item_fingerprint,
        family_signature:item.family_signature,
        reason:'Validated bounded generation for assessment preview',
        validation_refs:result.candidate.validation_refs
      };
      appendQuestionLifecycleEvent({...baseEvent,event_id:`${result.candidate.assessment_id}-${id}-generated`,previous_state:'NONE',new_state:'GENERATED_CANDIDATE'},{filePath:lifecyclePath,lockPath:lifecycleLock});
      appendQuestionLifecycleEvent({...baseEvent,event_id:`${result.candidate.assessment_id}-${id}-validated`,previous_state:'GENERATED_CANDIDATE',new_state:'VALIDATED'},{filePath:lifecyclePath,lockPath:lifecycleLock});
    }
    return stored;
  }
  function createBaseline(subject,body={}) {
    const requestedAt=body.requested_at??new Date().toISOString();
    const stored=createBaselineAssessment({learnerId,subject,requestedAt},{root});
    return persistAssessmentRecord(stored);
  }
  function acceptBaseline(id,body={}) {
    const stored=getAssessment(id);
    if(stored.baseline_candidate!==true) throw new Error('NOT_BASELINE_ASSESSMENT');
    if(stored.status!=='RESULT_CAPTURED') throw new Error('BASELINE_RESULTS_REQUIRED');
    return acceptBaselineAssessment({
      learnerId,
      assessmentId:id,
      subject:stored.baseline_subject,
      acceptedAt:body.accepted_at??new Date().toISOString(),
      baselineSummary:stored.auto_evaluation??null
    },{root});
  }
  function getAssessment(id) {
    const file=assessmentFile(id);
    if (!fs.existsSync(file)) throw new Error('ASSESSMENT_NOT_FOUND');
    return readJson(file);
  }
  function markReady(id,body={}) {
    const stored=getAssessment(id);
    if (!stored.preview?.student_items?.length) throw new Error('ASSESSMENT_HAS_NO_ITEMS');
    const at=body.occurred_at??new Date().toISOString();
    const writes=[];
    for (const item of stored.preview.student_items) {
      writes.push(appendExposureEvent({
        contract_version:'QUESTION_EXPOSURE/1.0',
        exposure_id:`${stored.candidate.assessment_id}-${item.item_id}-assigned`,
        learner_id:learnerId,
        assessment_id:stored.candidate.assessment_id,
        item_id:item.item_id,
        family_signature:item.family_signature??item.family_id??'UNKNOWN_FAMILY',
        purpose:stored.request.purpose,
        exposure_type:'ASSIGNED_TO_LEARNER',
        help_level:'NONE_OBSERVED',
        answer_exposure:'NONE_OBSERVED',
        occurred_at:at,
        source_ref:`assessment:${stored.candidate.assessment_id}`
      },{filePath:exposurePath,lockPath:exposureLock}));
    }
    stored.status='READY';
    stored.ready_at=at;
    writeJson(assessmentFile(id),stored);
    return {assessment_id:id,status:'READY',exposure_writes:writes};
  }
  function submitAnswers(id,body={}) {
    let stored=getAssessment(id);
    if(stored.baseline_candidate!==true) throw new Error('BASELINE_SUBMISSION_ONLY');
    if(stored.status==='RESULT_CAPTURED') throw new Error('ASSESSMENT_ALREADY_GRADED');
    const items=stored.preview?.student_items??[];
    const answers=Array.isArray(body.answers)?body.answers:[];
    if(!items.length) throw new Error('ASSESSMENT_HAS_NO_ITEMS');
    if(!answers.length) throw new Error('ANSWERS_REQUIRED');

    const expectedIds=new Set(items.map((item)=>item.item_id));
    const seen=new Set();
    const byId=new Map();
    for(const entry of answers){
      const itemId=String(entry?.item_id??'');
      if(!expectedIds.has(itemId)) throw new Error(`ASSESSMENT_ITEM_NOT_FOUND:${itemId}`);
      if(seen.has(itemId)) throw new Error(`DUPLICATE_ANSWER:${itemId}`);
      const answer=String(entry?.answer??'').trim();
      if(!answer) throw new Error(`ANSWER_REQUIRED:${itemId}`);
      seen.add(itemId);
      byId.set(itemId,answer);
    }
    if(seen.size!==expectedIds.size) throw new Error('ALL_ANSWERS_REQUIRED');

    const submittedAt=body.submitted_at??new Date().toISOString();
    if(stored.status!=='READY'&&stored.status!=='SUBMITTED'){
      markReady(id,{occurred_at:submittedAt});
      stored=getAssessment(id);
    }
    stored.learner_submission={
      submitted_at:submittedAt,
      answers:items.map((item)=>({item_id:item.item_id,answer:byId.get(item.item_id)}))
    };
    stored.status='SUBMITTED';
    writeJson(assessmentFile(id),stored);

    const keyById=new Map((stored.preview?.parent_key??[]).map((x)=>[x.item_id,x]));
    const gradeRows=items.map((item)=>{
      const key=keyById.get(item.item_id);
      const grade=gradeBaselineResponse({
        responseFormat:item.response_format,
        answerRef:key?.answer_or_scoring_ref,
        response:byId.get(item.item_id)
      });
      return {
        item_id:item.item_id,
        concept_id:item.concept_id,
        grade,
        result:{
          criterionResult:grade.criterion_result,
          grader:'SYSTEM_RULE',
          gradingVerified:grade.grading_verified===true,
          gradingVerificationStatus:grade.grading_verified===true?'VERIFIED':'UNRESOLVED',
          helpLevel:'NONE_OBSERVED',
          helpSource:'SYSTEM_SESSION',
          helpTiming:'BEFORE_SUBMISSION',
          helpObservationBasis:'NO_IN_APP_HELP_OR_ANSWER_REVEAL',
          firstAttempt:'YES',
          retryRelation:'FRESH',
          answerExposure:'NONE_OBSERVED',
          timeLimit:'KNOWN',
          interruption:'UNKNOWN',
          fatigue:'UNKNOWN',
          responseModality:'TYPED',
          errorHypothesis:'UNKNOWN',
          interpretationStatus:grade.grading_verified===true?'VERIFIED':'UNRESOLVED',
          interpretationOrigin:'RULE',
          transferType:'NONE',
          responseRef:`assessment:${id}:item:${item.item_id}:learner-response`
        }
      };
    });
    const deterministic=gradeRows.filter((x)=>x.grade.grading_verified===true);
    const unresolved=gradeRows.filter((x)=>x.grade.grading_verified!==true);

    if(deterministic.length){
      recordResults(id,{
        imported_at:submittedAt,
        observed_at:submittedAt,
        policy_version:'PARENT_CONSOLE_R1',
        source_kind:'OTHER',
        results:deterministic.map(({item_id,result})=>({item_id,result}))
      });
    }

    const progressNow=progress({asOf:submittedAt});
    const decisionByConcept=new Map((progressNow.concepts??[]).map((x)=>[x.concept?.concept_id,x.decision]));
    const nextSteps=gradeRows
      .filter((x)=>x.grade.criterion_result!=='CORRECT')
      .map((x)=>{
        const decision=decisionByConcept.get(x.concept_id);
        return {
          item_id:x.item_id,
          concept_id:x.concept_id,
          result:x.grade.criterion_result,
          reason:x.grade.reason,
          action:decision?.need_action??(x.grade.criterion_result==='UNRESOLVED'?'DIAGNOSE':'RECHECK'),
          scheduled_action:decision?.scheduled_action??(x.grade.criterion_result==='UNRESOLVED'?'DIAGNOSE':'RECHECK'),
          test_more:true
        };
      });
    const correctCount=deterministic.filter((x)=>x.grade.criterion_result==='CORRECT').length;
    const incorrectCount=deterministic.filter((x)=>x.grade.criterion_result==='INCORRECT').length;
    const autoEvaluation={
      evaluated_at:submittedAt,
      total_items:items.length,
      auto_graded_count:deterministic.length,
      correct_count:correctCount,
      incorrect_count:incorrectCount,
      unresolved_count:unresolved.length,
      unresolved_items:unresolved.map((x)=>({item_id:x.item_id,concept_id:x.concept_id,reason:x.grade.reason})),
      next_steps:nextSteps,
      note:'Hệ chỉ tự chấm khi đáp án đủ chắc; phần chưa chắc được chuyển sang kiểm tra thêm thay vì đoán.'
    };
    stored=getAssessment(id);
    stored.learner_submission={
      submitted_at:submittedAt,
      answers:items.map((item)=>({item_id:item.item_id,answer:byId.get(item.item_id)}))
    };
    stored.auto_evaluation=autoEvaluation;
    if(stored.status!=='RESULT_CAPTURED') stored.status='RESULT_CAPTURED';
    writeJson(assessmentFile(id),stored);

    let baselineAnchor=null;
    try{
      baselineAnchor=acceptBaseline(id,{accepted_at:submittedAt});
    }catch(error){
      if(error?.message==='BASELINE_SUBJECT_ALREADY_ACCEPTED') baselineAnchor=readBaselineAnchor({learnerId},{root});
      else throw error;
    }
    const finalDashboard=dashboard({asOf:submittedAt});
    return {
      assessment_id:id,
      status:'RESULT_CAPTURED',
      answer_count:stored.learner_submission.answers.length,
      auto_evaluation:autoEvaluation,
      baseline_anchor:baselineAnchor,
      dashboard:finalDashboard
    };
  }
  function recordResults(id,body={}) {
    const stored=getAssessment(id);
    const results=Array.isArray(body.results)?body.results:[];
    if (!results.length) throw new Error('RESULTS_REQUIRED');
    const importedAt=body.imported_at??new Date().toISOString();
    const observedAt=body.observed_at??importedAt;
    const sourceKind=body.source_kind??'PARENT_NOTE';
    const studentById=new Map(stored.preview.student_items.map((x)=>[x.item_id,x]));
    const keyById=new Map(stored.preview.parent_key.map((x)=>[x.item_id,x]));
    const writes=[];
    for (const entry of results) {
      const student=studentById.get(entry.item_id);
      const key=keyById.get(entry.item_id);
      if (!student||!key) throw new Error(`ASSESSMENT_ITEM_NOT_FOUND:${entry.item_id}`);
      const item={...student,answer_or_scoring_ref:key.answer_or_scoring_ref};
      const mode=sessionModeForRecord(stored);
      const result=captureAssessmentResult({
        learnerId,
        assessmentId:id,
        item,
        result:evidenceResultForMode(entry.result,mode),
        importedAt,
        observedAt,
        policyVersion:body.policy_version??'PARENT_CONSOLE_R1',
        source:{sourceKind,rawRef:`assessment:${id}`,rawLocator:`item:${entry.item_id}`,captureCompleteness:'COMPLETE'}
      },{ledgerFilePath:ledgerPath,lockPath:ledgerLock});
      writes.push(result);

      const help=entry.result?.helpLevel??'UNKNOWN';
      const answer=entry.result?.answerExposure??'UNKNOWN';
      appendExposureEvent({
        contract_version:'QUESTION_EXPOSURE/1.0',
        exposure_id:`${id}-${entry.item_id}-submitted-${writes.length}`,
        learner_id:learnerId,assessment_id:id,item_id:entry.item_id,
        family_signature:student.family_signature??student.family_id??'UNKNOWN_FAMILY',
        purpose:stored.request.purpose,exposure_type:'SUBMITTED',
        help_level:help,answer_exposure:answer,
        occurred_at:observedAt,
        source_ref:`assessment:${id}`
      },{filePath:exposurePath,lockPath:exposureLock});
    }
    const itemReceipts=writes.map((write,index)=>({
      item_id:results[index].item_id,
      evidence_id:write?.evidence?.evidence_id??null,
      status:write?.status??'BLOCKED',
      evidence_write_status:write?.evidence_write?.status??null,
      eligibility_write_status:write?.eligibility_write?.status??null,
      saved:write?.status==='RECORDED'
    }));
    const saved=itemReceipts.every((x)=>x.saved===true);
    const resultReceipt={
      contract_version:'ASSESSMENT_RESULT_PERSISTENCE_RECEIPT/1.0',
      status:saved?'VERIFIED':'INCOMPLETE',
      saved,
      assessment_id:id,
      persisted_at:importedAt,
      item_receipts:itemReceipts
    };
    const priorRevisions=Array.isArray(stored.grading_revisions)?stored.grading_revisions:[];
    const revisionIndex=priorRevisions.length+1;
    const graders=[...new Set(results.map((x)=>x?.result?.grader).filter(Boolean))];
    const gradingRevision={
      contract_version:'ASSESSMENT_GRADING_REVISION/1.0',
      revision_id:`${id}-grade-r${revisionIndex}`,
      revision_index:revisionIndex,
      graded_at:importedAt,
      observed_at:observedAt,
      source_kind:sourceKind,
      graders,
      items:results.map((entry,index)=>({
        item_id:entry.item_id,
        criterion_result:entry?.result?.criterionResult??'UNRESOLVED',
        grading_verification_status:entry?.result?.gradingVerified===true?'VERIFIED':(entry?.result?.gradingVerificationStatus??'UNRESOLVED'),
        interpretation_origin:entry?.result?.interpretationOrigin??'UNRESOLVED',
        interpretation_status:entry?.result?.interpretationStatus??'UNRESOLVED',
        evidence_id:itemReceipts[index]?.evidence_id??null,
        persistence_status:itemReceipts[index]?.status??'BLOCKED'
      })),
      persistence_receipt:resultReceipt
    };
    stored.grading_revisions=[...priorRevisions,gradingRevision];
    stored.result_persistence_receipt=resultReceipt;
    stored.status='RESULT_CAPTURED';
    stored.result_captured_at=importedAt;
    writeJson(assessmentFile(id),stored);
    const readback=getAssessment(id);
    const persistedRevision=readback.grading_revisions?.at(-1);
    if(persistedRevision?.revision_id!==gradingRevision.revision_id) throw new Error('RESULT_AUDIT_PERSISTENCE_VERIFICATION_FAILED');
    const postPersist=resultReceipt.status==='VERIFIED'
      ?postPersistContinuation(id,{asOf:importedAt,persistenceReceipt:resultReceipt})
      :{contract_version:'POST_PERSIST_CONTINUATION/1.0',status:'BLOCKED_INCOMPLETE_PERSISTENCE',assessment_id:id,persistence_receipt_status:resultReceipt.status};
    return {
      assessment_id:id,
      status:'RESULT_CAPTURED',
      writes,
      persistence_receipt:resultReceipt,
      grading_revision:gradingRevision,
      post_persist:postPersist,
      dashboard:postPersist?.progress?.dashboard??dashboard({asOf:stored.result_captured_at})
    };
  }
  function correct(body) {
    return recordParentCorrection(body,{ledgerFilePath:ledgerPath,lockPath:ledgerLock});
  }
  function questionBank() {
    return {
      candidates:fs.existsSync(candidatePath)?readQuestionCandidates(candidatePath):[],
      lifecycle:fs.existsSync(lifecyclePath)?readQuestionLifecycleEvents(lifecyclePath):[]
    };
  }
  function changeQuestionState(id,newState,body={}) {
    safeId(id,'item_id');
    const bank=questionBank();
    const item=bank.candidates.find((x)=>x.item_id===id);
    if (!item) throw new Error('QUESTION_CANDIDATE_NOT_FOUND');
    const events=bank.lifecycle.filter((x)=>x.item_id===id);
    const previous=events.length?events.at(-1).new_state:'NONE';
    const event={
      contract_version:'QUESTION_LIFECYCLE_EVENT/1.0',
      event_id:`${id}-${newState.toLowerCase()}-${String(body.occurred_at??new Date().toISOString()).replace(/[^0-9]/g,'')}`,
      item_id:id,previous_state:previous,new_state:newState,
      actor:'PARENT',validation_refs:body.validation_refs??[],
      reason:body.reason??(newState==='PROMOTED'?'Phụ huynh duyệt vào ngân hàng sử dụng':'Phụ huynh ngừng sử dụng câu hỏi'),
      occurred_at:body.occurred_at??new Date().toISOString(),
      item_fingerprint:item.item_fingerprint,
      family_signature:item.family_signature
    };
    return appendQuestionLifecycleEvent(event,{filePath:lifecyclePath,lockPath:lifecycleLock});
  }
  function revalidateTarget(body={}) {
    const model=currentTarget(body.as_of??new Date().toISOString(),body.version??`R1-${Date.now()}`);
    const snapshot=persistTargetSnapshot(model,{root});
    return {model,snapshot:path.relative(root,snapshot).replaceAll('\\','/')};
  }
  function materials(filters={}) {
    return materialResolver.searchMaterials(filters);
  }
  function currentMaterial(filters={}) {
    const asOf=filters.as_of??filters.asOf??new Date().toISOString();
    const supplied=filters.workload_context??filters.workloadContext;
    const workloadContext=supplied??planningContext(asOf).workload_context;
    return materialResolver.resolveCurrentMaterial({
      learner_id:learnerId,
      subject:filters.subject??null,
      as_of:asOf,
      workload_context:workloadContext
    });
  }
  function materialResolution(id,filters={}) {
    return materialResolver.resolveMaterialByIdentity({
      assessment_id:safeId(id,'assessment_id'),
      artifact_ref:filters.artifact_ref??filters.artifactRef??null
    });
  }
  function approvedLesson(filters={}) {
    return materialResolver.resolveApprovedLesson({
      learner_id:learnerId,
      assessment_id:filters.assessment_id??filters.assessmentId??null,
      artifact_ref:filters.artifact_ref??filters.artifactRef??null,
      subject:filters.subject??null,
      concept_id:filters.concept_id??filters.conceptId??null,
      as_of:filters.as_of??filters.asOf??new Date().toISOString(),
      workload_context:filters.workload_context??filters.workloadContext
    });
  }
  function postPersistContinuation(id,{asOf=new Date().toISOString(),persistenceReceipt}={}) {
    if(persistenceReceipt?.status!=='VERIFIED'||persistenceReceipt?.saved===false){
      throw new Error('POST_PERSIST_RELOAD_REQUIRES_VERIFIED_RECEIPT');
    }
    const canonicalAssessment=getAssessment(id);
    const subject=canonicalAssessment?.request?.subject??canonicalAssessment?.baseline_subject??null;
    const freshProgress=progress({subject,asOf});
    const nextAction=currentMaterial({subject,as_of:asOf,workload_context:freshProgress.planning_context?.workload_context});
    return {
      contract_version:'POST_PERSIST_CONTINUATION/1.0',
      status:'RELOADED',
      assessment_id:id,
      persisted_at:persistenceReceipt.persisted_at??null,
      persistence_receipt_status:persistenceReceipt.status,
      canonical_assessment:{
        status:canonicalAssessment?.status??null,
        result_persistence_status:canonicalAssessment?.result_persistence_receipt?.status??null,
        lesson_result_persistence_status:canonicalAssessment?.lesson_result_persistence_receipt?.status??null,
        grading_revision_count:Array.isArray(canonicalAssessment?.grading_revisions)?canonicalAssessment.grading_revisions.length:0,
        lesson_session_count:Array.isArray(canonicalAssessment?.lesson_session_history)?canonicalAssessment.lesson_session_history.length:0
      },
      progress:freshProgress,
      next_action:nextAction
    };
  }
  function approveLesson(id,body={}) {
    return lessonResults.approveLesson(safeId(id,'assessment_id'),{...body,learner_id:learnerId});
  }
  function completeLesson(id,body={}) {
    const persisted=lessonResults.persistLessonResult(safeId(id,'assessment_id'),{...body,learner_id:learnerId});
    if(persisted?.persistence_receipt?.status!=='VERIFIED') throw new Error('LESSON_RESULT_PERSISTENCE_NOT_VERIFIED');
    return {
      ...persisted,
      post_persist:postPersistContinuation(id,{
        asOf:persisted.lesson_result?.completed_at??new Date().toISOString(),
        persistenceReceipt:persisted.persistence_receipt
      })
    };
  }

  return {
    root,learnerId,
    getDashboard:dashboard,
    getProgress:progress,
    getPlanningContext:({asOf=new Date().toISOString()}={})=>planningContext(asOf),
    getCurrentLearningContext:learningContext,
    getSourceFusion:sourceFusionPack,
    getBaseline:()=>readBaselineAnchor({learnerId},{root}),
    createBaseline,
    acceptBaseline,
    createAssessment,
    getAssessment,
    markAssessmentReady:markReady,
    submitAssessmentAnswers:submitAnswers,
    recordAssessmentResults:recordResults,
    getAssessmentHistory:(filters={})=>assessmentHistory.list(filters),
    getAssessmentHistoryDetail:(id)=>assessmentHistory.detail(id),
    getMaterials:materials,
    getCurrentMaterial:currentMaterial,
    getApprovedLesson:approvedLesson,
    getMaterialResolution:materialResolution,
    approveLesson,
    completeLesson,
    recordCorrection:correct,
    getQuestionBank:questionBank,
    promoteQuestion:(id,body)=>changeQuestionState(id,'PROMOTED',body),
    retireQuestion:(id,body)=>changeQuestionState(id,'RETIRED',body),
    revalidateTarget
  };
}
