import fs from 'node:fs';
import path from 'node:path';

import { createMaterialProvenanceProjector } from './material-provenance-service.mjs';

function safeId(value,name='assessment_id'){
  const s=String(value??'');
  if(!s||!/^[A-Za-z0-9._-]+$/.test(s)) throw new Error(`INVALID_${name.toUpperCase()}`);
  return s;
}
function readJson(file){ return JSON.parse(fs.readFileSync(file,'utf8')); }
function isoDate(value){
  const s=String(value??'');
  return /^\d{4}-\d{2}-\d{2}/.test(s)?s.slice(0,10):null;
}
function promptText(prompt){
  if(typeof prompt==='string') return prompt.trim();
  if(!prompt||typeof prompt!=='object') return '';
  return [prompt.question,prompt.task,prompt.learner_task,prompt.passage]
    .filter((x)=>typeof x==='string'&&x.trim())
    .join(' ').trim();
}
function assessmentIdentity(record){
  return record?.candidate?.assessment_id??record?.assessment_id??null;
}
function subjectOf(record){ return record?.request?.subject??record?.baseline_subject??'UNKNOWN'; }
function purposeOf(record){ return record?.request?.purpose??(record?.baseline_candidate?'DIAGNOSTIC':'UNKNOWN'); }
function typeOf(record){ return record?.baseline_candidate?'BASELINE':record?.assessment_type??purposeOf(record); }
function createdAtOf(record){ return record?.created_at??record?.request?.requested_at??null; }
function statusOf(record){ return record?.status??record?.candidate?.status??'UNKNOWN'; }
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
function sessionModeForRecord(record){
  const explicit=upper(record?.request?.session_mode??record?.session_mode??record?.request?.parent_constraints?.session_mode);
  if(explicit) return SESSION_MODES.has(explicit)?explicit:'UNKNOWN';
  const type=upper(record?.assessment_type);
  const purpose=upper(record?.request?.purpose);
  if(type.includes('LESSON_ACTIVITY')||['LEARN','TEACH','RETEACH','REVIEW'].includes(purpose)) return 'LESSON';
  if(purpose==='PRACTICE'||purpose==='REPAIR') return 'GUIDED_PRACTICE';
  if(['DIAGNOSTIC','FRESH_RECHECK','WEEKLY_CHECK','MOCK'].includes(purpose)||record?.baseline_candidate===true) return 'TEST_RECHECK';
  return 'UNKNOWN';
}
function feedbackPolicyForRecord(record){ return FEEDBACK_BY_MODE[sessionModeForRecord(record)]??'UNKNOWN'; }
function evidenceCeilingForRecord(record){
  const explicit=upper(record?.request?.expected_evidence_ceiling??record?.expected_evidence_ceiling??record?.request?.parent_constraints?.expected_evidence_ceiling);
  return explicit||EVIDENCE_CEILING_BY_MODE[sessionModeForRecord(record)]||'UNKNOWN';
}
function conceptsOf(record){
  const ids=[
    ...(Array.isArray(record?.request?.target_concepts)?record.request.target_concepts:[]),
    ...(Array.isArray(record?.preview?.student_items)?record.preview.student_items.map((x)=>x?.concept_id):[])
  ].filter(Boolean);
  return [...new Set(ids)];
}
function contentSummary(record){
  const prompts=(record?.preview?.student_items??[])
    .map((x)=>promptText(x?.prompt_or_artifact_ref))
    .filter(Boolean)
    .map((x)=>x.replace(/\s+/g,' ').trim())
    .slice(0,2);
  if(prompts.length) return prompts.map((x)=>x.length>120?`${x.slice(0,117)}...`:x).join(' · ');
  const objectives=(record?.lesson_activity?.objectives??[])
    .filter((x)=>typeof x==='string'&&x.trim())
    .slice(0,2)
    .map((x)=>x.replace(/\s+/g,' ').trim());
  if(objectives.length) return objectives.join(' · ');
  const concepts=conceptsOf(record);
  return concepts.length?concepts.slice(0,3).join(' · '):'Chưa có mô tả nội dung';
}
function resultSummary(record){
  const revisions=Array.isArray(record?.grading_revisions)?record.grading_revisions:[];
  const latest=revisions.at(-1);
  const items=Array.isArray(latest?.items)?latest.items:[];
  if(items.length){
    const out={correct:0,partial:0,incorrect:0,unresolved:0};
    for(const item of items){
      const v=item?.criterion_result;
      if(v==='CORRECT') out.correct+=1;
      else if(v==='PARTIAL') out.partial+=1;
      else if(v==='INCORRECT') out.incorrect+=1;
      else out.unresolved+=1;
    }
    return out;
  }
  const auto=record?.auto_evaluation;
  if(auto) return {
    correct:Number(auto.correct_count??0),
    partial:0,
    incorrect:Number(auto.incorrect_count??0),
    unresolved:Number(auto.unresolved_count??0)
  };
  return null;
}

function activityKind(record){
  const type=String(typeOf(record)??'').toUpperCase();
  const purpose=String(purposeOf(record)??'').toUpperCase();
  if(type.includes('LESSON_ACTIVITY')||purpose==='TEACH'||purpose==='RETEACH') return 'LESSON';
  if(purpose==='PRACTICE'||purpose==='REPAIR') return 'PRACTICE';
  return 'TEST';
}
function displayTitle(record){
  const subject=subjectOf(record);
  const subjectText=subject==='MATH'?'Toán':subject==='VIETNAMESE'?'Tiếng Việt':subject==='ENGLISH'?'Tiếng Anh':subject==='MULTI'?'3 môn':'Học tập';
  const purpose=String(purposeOf(record)??'UNKNOWN').toUpperCase();
  const kind=activityKind(record);
  if(kind==='LESSON') return purpose==='RETEACH'?`Bài giảng dạy lại · ${subjectText}`:`Bài giảng · ${subjectText}`;
  if(kind==='PRACTICE') return purpose==='REPAIR'?`Bài luyện phần đang yếu · ${subjectText}`:`Bài luyện · ${subjectText}`;
  if(typeOf(record)==='BASELINE') return `Bài kiểm tra đầu vào · ${subjectText}`;
  if(purpose==='FRESH_RECHECK') return `Bài kiểm tra lại · ${subjectText}`;
  if(purpose==='WEEKLY_CHECK') return `Bài kiểm tra tuần · ${subjectText}`;
  if(purpose==='MOCK') return `Đề mô phỏng · ${subjectText}`;
  if(purpose==='DIAGNOSTIC') return `Bài kiểm tra chẩn đoán · ${subjectText}`;
  return `Bài kiểm tra · ${subjectText}`;
}
function sourceArtifactFor(record,name){
  const sources=Array.isArray(record?.source_artifacts)?record.source_artifacts:[];
  return sources.find((source)=>{
    const repoName=source?.repo_artifact_ref?path.basename(source.repo_artifact_ref):null;
    return repoName===name||source?.name===name;
  })??null;
}
function classifyArtifact(record,name){
  const source=sourceArtifactFor(record,name);
  const role=String(source?.role??'').toUpperCase();
  const lower=name.toLowerCase();
  let kind='SYSTEM';
  let audience='SYSTEM';
  let sourceActor='SYSTEM';
  let label='Tệp hỗ trợ hệ thống';

  if(role==='AI_TEACHER_PACKAGE'){
    kind='LESSON'; audience='AI_TEACHER'; sourceActor='SYSTEM'; label='Bài giảng cho AI dạy';
  } else if(role==='TEACHING_ARTIFACT'){
    const delivery=String(record?.request?.parent_constraints?.delivery_actor??'').toUpperCase();
    kind='LESSON'; audience=delivery==='AI_TEACHER'?'AI_TEACHER':'LEARNER'; sourceActor='SYSTEM';
    label=delivery==='AI_TEACHER'?'Bài giảng cho AI dạy':'Bài giảng cho con học';
  } else if(role.includes('LEARNER_TEST')||role.includes('ORIGINAL_LEARNER_TEST')){
    kind='TEST'; audience='LEARNER'; sourceActor='SYSTEM'; label='Đề cho con làm';
  } else if(lower.includes('transcription')){
    kind='SYSTEM'; audience='SYSTEM'; sourceActor='SYSTEM'; label='Bản chép dữ liệu hệ thống';
  } else if(role.includes('LEARNER_SUBMISSION')||lower.includes('learner-submission')){
    kind='SUBMISSION'; audience='PARENT_GRADER'; sourceActor='LEARNER'; label='Bài con đã làm';
  } else if(role.includes('GRAD')||lower.startsWith('grading-')){
    kind='GRADING'; audience='PARENT_GRADER'; sourceActor='AI_GRADER'; label='Kết quả chấm';
  } else if(lower.endsWith('.pdf')){
    const activity=activityKind(record);
    if(activity==='LESSON'){ kind='LESSON'; audience='LEARNER'; label='Bài giảng'; }
    else if(activity==='PRACTICE'){ kind='PRACTICE'; audience='LEARNER'; label='Bài luyện'; }
    else { kind='TEST'; audience='LEARNER'; label='Đề cho con làm'; }
  }

  return {
    name,
    original_name:source?.name??name,
    role:source?.role??null,
    kind,
    audience,
    source_actor:sourceActor,
    label
  };
}
function artifactRefs(assessmentDir,record){
  const dir=path.join(assessmentDir,'artifacts');
  const actualNames=fs.existsSync(dir)
    ?fs.readdirSync(dir,{withFileTypes:true})
      .filter((entry)=>entry.isFile())
      .map((entry)=>entry.name)
      .filter((name)=>/^[^\\/]+$/.test(name))
    :[];
  const declaredNames=(record?.source_artifacts??[])
    .map((source)=>source?.repo_artifact_ref?path.basename(source.repo_artifact_ref):source?.name)
    .filter((name)=>typeof name==='string'&&name&&/^[^\\/]+$/.test(name));
  const names=[...new Set([...actualNames,...declaredNames])].sort();
  const actualSet=new Set(actualNames);
  const assessmentId=path.basename(assessmentDir);

  return names.map((name)=>{
    const ref=`runtime-data/parent-console/assessments/${assessmentId}/artifacts/${name}`;
    return {
      ...classifyArtifact(record,name),
      artifact_id:`${assessmentId}:${name}`,
      ref,
      exists:actualSet.has(name)
    };
  });
}
function recordAudiences(record,artifacts){
  const values=new Set(artifacts.map((x)=>x.audience).filter((x)=>x&&x!=='SYSTEM'));
  const delivery=String(record?.request?.parent_constraints?.delivery_actor??'').toUpperCase();
  const kind=activityKind(record);
  if(kind==='LESSON'){
    if(delivery==='AI_TEACHER') values.add('AI_TEACHER');
    else values.add('LEARNER');
  }else{
    values.add('LEARNER');
  }
  if((record?.grading_revisions?.length??0)>0||record?.auto_evaluation) values.add('PARENT_GRADER');
  return [...values];
}
function validRelationshipId(value){
  const s=String(value??'').trim();
  return /^[A-Za-z0-9._-]+$/.test(s)?s:null;
}
function relationshipsOf(record){
  const constraints=record?.request?.parent_constraints??{};
  const next=[];
  const depends=[];
  const supersedes=[];

  const nextId=validRelationshipId(constraints.next_assessment_id??record?.next_assessment_id);
  if(nextId) next.push(nextId);

  let prereq=constraints.prerequisite_assessment_id??record?.prerequisite_assessment_id??constraints.prerequisite;
  if(typeof prereq==='string'&&prereq.endsWith('_COMPLETED')) prereq=prereq.slice(0,-'_COMPLETED'.length);
  const prereqId=validRelationshipId(prereq);
  if(prereqId) depends.push(prereqId);

  const supersedeValues=[
    ...(Array.isArray(record?.supersedes)?record.supersedes:[]),
    ...(Array.isArray(constraints.supersedes)?constraints.supersedes:[])
  ];
  for(const value of supersedeValues){
    const id=validRelationshipId(value);
    if(id) supersedes.push(id);
  }

  return {
    depends_on:[...new Set(depends)],
    supersedes:[...new Set(supersedes)],
    next_supported:[...new Set(next)]
  };
}
function derivedWorkflowState(record,artifacts){
  const status=String(statusOf(record)).toUpperCase();
  const hasResult=(record?.grading_revisions?.length??0)>0||Boolean(record?.auto_evaluation)||status==='RESULT_CAPTURED';
  const hasSubmission=Boolean(record?.learner_submission);
  const missingUserArtifact=artifacts.some((x)=>x.audience!=='SYSTEM'&&!x.exists);

  if(missingUserArtifact) return 'MATERIAL_MISSING';
  if(hasResult||status==='COMPLETED_CONTEXT'||status==='COMPLETED') return 'COMPLETED';
  if(status==='SESSION_ENDED_INCOMPLETE') return 'NEEDS_TEACHING';
  if(hasSubmission) return 'WAITING_FOR_GRADING';
  if(status.includes('PAUSE')||status.includes('BLOCK')||status.includes('WAIT')) return 'BLOCKED_OR_WAITING';
  const kind=activityKind(record);
  if(kind==='LESSON'&&['READY','READY_CONTEXT','PARENT_PREVIEW'].includes(status)) return 'NEEDS_TEACHING';
  if((kind==='PRACTICE'||kind==='TEST')&&['READY','READY_CONTEXT','PARENT_PREVIEW'].includes(status)) return 'READY_FOR_LEARNER';
  return 'UNKNOWN';
}
function provenanceHaystack(provenance){
  return [
    provenance?.generation_origin,
    ...(provenance?.curriculum_grounding??[]).flatMap((x)=>[x.source_id,x.source_class,x.title,x.authority]),
    ...(provenance?.exam_pattern_evidence??[]).flatMap((x)=>[x.source_id,x.source_class,x.title,x.authority]),
    ...(provenance?.gaps??[])
  ].filter(Boolean);
}
function matchesProvenance(provenance,category){
  const wanted=String(category??'').trim().toUpperCase();
  if(!wanted) return true;
  if(String(provenance?.generation_origin??'').toUpperCase()===wanted) return true;
  const refs=[...(provenance?.curriculum_grounding??[]),...(provenance?.exam_pattern_evidence??[])];
  if(refs.some((x)=>[x?.source_id,x?.source_class,x?.authority].some((v)=>String(v??'').toUpperCase()===wanted))) return true;
  if(wanted==='UNKNOWN'&&(provenance?.gaps??[]).length) return true;
  return false;
}
function rowFromEntry(id,record,dir,provenanceProjector){
  const artifacts=artifactRefs(dir,record);
  const provenance=provenanceProjector.project(record,artifacts);
  const canonicalStatus=statusOf(record);
  return {
    assessment_id:id,
    date:isoDate(createdAtOf(record)),
    created_at:createdAtOf(record),
    completed_at:record?.lesson_result?.completed_at??record?.completed_at??null,
    submitted_at:record?.learner_submission?.submitted_at??null,
    graded_at:record?.result_captured_at??record?.grading_revisions?.at?.(-1)?.graded_at??null,
    subject:subjectOf(record),
    purpose:purposeOf(record),
    assessment_type:typeOf(record),
    activity_kind:activityKind(record),
    session_mode:sessionModeForRecord(record),
    feedback_policy:feedbackPolicyForRecord(record),
    expected_evidence_ceiling:evidenceCeilingForRecord(record),
    display_title:displayTitle(record),
    audiences:recordAudiences(record,artifacts),
    artifact_kinds:[...new Set(artifacts.map((x)=>x.kind).filter((x)=>x!=='SYSTEM'))],
    status:canonicalStatus,
    canonical_status:canonicalStatus,
    derived_workflow_state:derivedWorkflowState(record,artifacts),
    content_summary:contentSummary(record),
    concept_ids:conceptsOf(record),
    item_count:Array.isArray(record?.preview?.student_items)?record.preview.student_items.length:0,
    result_summary:resultSummary(record),
    lesson_result:record?.lesson_result??null,
    lesson_result_persistence_status:record?.lesson_result_persistence_receipt?.status??null,
    lesson_approval:record?.lesson_approval??null,
    lesson_approval_persistence_status:record?.lesson_approval_persistence_receipt?.status??null,
    lesson_session_history:Array.isArray(record?.lesson_session_history)?record.lesson_session_history:[],
    lesson_next_action:record?.lesson_result?.suggested_next_action??record?.lesson_activity?.next_action??null,
    persistence_status:record?.persistence_receipt?.status??'LEGACY_UNSPECIFIED',
    grading_revision_count:Array.isArray(record?.grading_revisions)?record.grading_revisions.length:0,
    artifacts,
    provenance,
    relationships:relationshipsOf(record),
    warnings:artifacts.filter((x)=>!x.exists).map((x)=>`ARTIFACT_MISSING:${x.ref}`)
  };
}

export function createAssessmentHistoryService(options={}){
  const root=path.resolve(options.root??process.cwd());
  const assessmentsDir=path.join(root,'runtime-data','parent-console','assessments');
  const provenanceProjector=createMaterialProvenanceProjector({root});

  function loadEntries(){
    if(!fs.existsSync(assessmentsDir)) return [];
    const entries=[];
    for(const dirent of fs.readdirSync(assessmentsDir,{withFileTypes:true})){
      if(!dirent.isDirectory()) continue;
      const file=path.join(assessmentsDir,dirent.name,'assessment.json');
      if(!fs.existsSync(file)) continue;
      try{
        const record=readJson(file);
        const id=assessmentIdentity(record)??dirent.name;
        entries.push({id,record,dir:path.dirname(file)});
      }catch{
        // Corrupt records are omitted from the read model rather than guessed.
      }
    }
    return entries;
  }

  function list(filters={}){
    const date=filters.date?String(filters.date):null;
    const dateFrom=filters.date_from??filters.dateFrom??null;
    const dateTo=filters.date_to??filters.dateTo??null;
    const subject=filters.subject?String(filters.subject).toUpperCase():null;
    const purposeRaw=filters.purpose??filters.type;
    const purpose=purposeRaw?String(purposeRaw).toUpperCase():null;
    const kind=filters.kind?String(filters.kind).toUpperCase():null;
    const sessionModeRaw=filters.session_mode??filters.sessionMode;
    const sessionMode=sessionModeRaw?String(sessionModeRaw).toUpperCase():null;
    const feedbackPolicyRaw=filters.feedback_policy??filters.feedbackPolicy;
    const feedbackPolicy=feedbackPolicyRaw?String(feedbackPolicyRaw).toUpperCase():null;
    const audience=filters.audience?String(filters.audience).toUpperCase():null;
    const status=filters.status?String(filters.status).toUpperCase():null;
    const workflowStatus=filters.workflow_status??filters.workflowStatus;
    const workflow=workflowStatus?String(workflowStatus).toUpperCase():null;
    const conceptId=filters.concept_id??filters.conceptId;
    const provenanceCategory=filters.provenance_category??filters.provenanceCategory??filters.provenance;
    const assessmentId=filters.assessment_id??filters.assessmentId;
    const q=String(filters.q??filters.content??'').trim().toLowerCase();

    return loadEntries().map(({id,record,dir})=>rowFromEntry(id,record,dir,provenanceProjector)).filter((row)=>{
      if(date&&row.date!==date) return false;
      if(dateFrom&&(!row.date||row.date<String(dateFrom))) return false;
      if(dateTo&&(!row.date||row.date>String(dateTo))) return false;
      if(subject&&String(row.subject).toUpperCase()!==subject) return false;
      if(purpose&&String(row.purpose).toUpperCase()!==purpose&&String(row.assessment_type).toUpperCase()!==purpose) return false;
      if(kind&&row.activity_kind!==kind&&!row.artifact_kinds.includes(kind)) return false;
      if(sessionMode&&row.session_mode!==sessionMode) return false;
      if(feedbackPolicy&&row.feedback_policy!==feedbackPolicy) return false;
      if(audience&&!row.audiences.includes(audience)) return false;
      if(status&&String(row.canonical_status).toUpperCase()!==status) return false;
      if(workflow&&String(row.derived_workflow_state).toUpperCase()!==workflow) return false;
      if(conceptId&&!row.concept_ids.includes(conceptId)) return false;
      if(provenanceCategory&&!matchesProvenance(row.provenance,provenanceCategory)) return false;
      if(assessmentId&&row.assessment_id!==assessmentId) return false;
      if(q){
        const artifactText=row.artifacts.flatMap((x)=>[x.name,x.original_name,x.label,x.role,x.kind,x.audience,x.ref]);
        const haystack=[
          row.display_title,row.content_summary,...row.concept_ids,row.subject,row.purpose,row.assessment_type,
          row.activity_kind,row.session_mode,row.feedback_policy,row.expected_evidence_ceiling,...row.artifact_kinds,...row.audiences,row.assessment_id,row.canonical_status,
          row.derived_workflow_state,...artifactText,...provenanceHaystack(row.provenance)
        ].filter(Boolean).join(' ').toLowerCase();
        if(!haystack.includes(q)) return false;
      }
      return true;
    }).sort((a,b)=>{
      const byCreated=String(b.created_at??'').localeCompare(String(a.created_at??''));
      return byCreated||String(a.assessment_id).localeCompare(String(b.assessment_id));
    });
  }

  function detail(id){
    const safe=safeId(id);
    const assessmentDir=path.join(assessmentsDir,safe);
    const file=path.join(assessmentDir,'assessment.json');
    if(!fs.existsSync(file)) throw new Error('ASSESSMENT_NOT_FOUND');
    const record=readJson(file);
    const artifacts=artifactRefs(assessmentDir,record);
    const provenance=provenanceProjector.project(record,artifacts);
    const canonicalStatus=statusOf(record);
    return {
      contract_version:'ASSESSMENT_HISTORY_DETAIL/1.2',
      assessment_id:assessmentIdentity(record)??safe,
      date:isoDate(createdAtOf(record)),
      created_at:createdAtOf(record),
      ready_at:record?.ready_at??null,
      completed_at:record?.lesson_result?.completed_at??record?.completed_at??null,
      submitted_at:record?.learner_submission?.submitted_at??null,
      graded_at:record?.result_captured_at??record?.grading_revisions?.at?.(-1)?.graded_at??null,
      subject:subjectOf(record),
      purpose:purposeOf(record),
      assessment_type:typeOf(record),
      activity_kind:activityKind(record),
      session_mode:sessionModeForRecord(record),
      feedback_policy:feedbackPolicyForRecord(record),
      expected_evidence_ceiling:evidenceCeilingForRecord(record),
      display_title:displayTitle(record),
      audiences:recordAudiences(record,artifacts),
      artifact_kinds:[...new Set(artifacts.map((x)=>x.kind).filter((x)=>x!=='SYSTEM'))],
      status:canonicalStatus,
      canonical_status:canonicalStatus,
      derived_workflow_state:derivedWorkflowState(record,artifacts),
      content_summary:contentSummary(record),
      concept_ids:conceptsOf(record),
      candidate:record?.candidate??null,
      questions:record?.preview?.student_items??[],
      parent_key:record?.preview?.parent_key??[],
      learner_submission:record?.learner_submission??null,
      persistence_receipt:record?.persistence_receipt??null,
      result_persistence_receipt:record?.result_persistence_receipt??null,
      lesson_result:record?.lesson_result??null,
      lesson_result_persistence_receipt:record?.lesson_result_persistence_receipt??null,
      lesson_approval:record?.lesson_approval??null,
      lesson_approval_persistence_receipt:record?.lesson_approval_persistence_receipt??null,
      lesson_session_history:Array.isArray(record?.lesson_session_history)?record.lesson_session_history:[],
      lesson_next_action:record?.lesson_result?.suggested_next_action??record?.lesson_activity?.next_action??null,
      grading_revisions:Array.isArray(record?.grading_revisions)?record.grading_revisions:[],
      auto_evaluation:record?.auto_evaluation??null,
      next_steps:record?.auto_evaluation?.next_steps??[],
      artifact_refs:artifacts,
      artifacts,
      provenance,
      relationships:relationshipsOf(record),
      warnings:artifacts.filter((x)=>!x.exists).map((x)=>`ARTIFACT_MISSING:${x.ref}`)
    };
  }

  return Object.freeze({list,detail});
}

export const createMaterialReadModel=createAssessmentHistoryService;
