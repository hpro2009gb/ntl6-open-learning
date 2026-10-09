import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLedgerRecords } from '../../persistence/ledger/reader.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT=path.resolve(HERE,'..','..');
const BASELINE_DIR=path.join('content','assessments','grade4-baseline-v1');
const SUBJECT_FILES=Object.freeze({
  MATH:'math.items.json',
  VIETNAMESE:'vietnamese.items.json',
  ENGLISH:'english.items.json'
});

function required(value,name){
  if(value===undefined||value===null||value==='') throw new Error(`MISSING_REQUIRED:${name}`);
  return value;
}
function subjectFile(subject){
  const file=SUBJECT_FILES[subject];
  if(!file) throw new Error(`INVALID_BASELINE_SUBJECT:${subject}`);
  return file;
}
function baselineAnchorPath(root,learnerId){
  return path.join(root,'runtime-data','parent-console','baseline',`${learnerId}.json`);
}
function standardizedPrompt(doc,item){
  if(doc.shared_material && String(item.concept_id).includes('READING')){
    return {passage:doc.shared_material.text,question:item.prompt};
  }
  return item.prompt;
}
function normalizeText(value){
  return String(value??'')
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g,' ')
    .replace(/[.!?]+$/g,'');
}
function parseInteger(value){
  const text=String(value??'').trim().replace(/[\s.,]/g,'');
  return /^-?\d+$/.test(text)?Number(text):null;
}
function gcd(a,b){
  let x=Math.abs(a),y=Math.abs(b);
  while(y){const t=x%y;x=y;y=t;}
  return x||1;
}
function parseFraction(value){
  const match=String(value??'').trim().match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if(!match) return null;
  const numerator=Number(match[1]),denominator=Number(match[2]);
  if(!denominator) return null;
  const d=gcd(numerator,denominator);
  const sign=denominator<0?-1:1;
  return {numerator:(numerator/d)*sign,denominator:Math.abs(denominator/d)};
}
export function gradeBaselineResponse({responseFormat,answerRef,response}){
  const ref=answerRef??{};
  if(Object.hasOwn(ref,'value')){
    const actual=parseInteger(response);
    if(actual===null) return {criterion_result:'INCORRECT',grading_verified:true,reason:'INTEGER_FORMAT_OR_VALUE_MISMATCH'};
    return {criterion_result:actual===Number(ref.value)?'CORRECT':'INCORRECT',grading_verified:true,reason:'EXACT_INTEGER'};
  }
  if(Object.hasOwn(ref,'relation')){
    const actual=String(response??'').trim();
    return {criterion_result:actual===String(ref.relation)?'CORRECT':'INCORRECT',grading_verified:true,reason:'EXACT_RELATION'};
  }
  if(Object.hasOwn(ref,'numerator')&&Object.hasOwn(ref,'denominator')){
    const actual=parseFraction(response);
    if(!actual) return {criterion_result:'INCORRECT',grading_verified:true,reason:'FRACTION_FORMAT_OR_VALUE_MISMATCH'};
    const expected=parseFraction(`${ref.numerator}/${ref.denominator}`);
    const correct=actual.numerator===expected.numerator&&actual.denominator===expected.denominator;
    return {criterion_result:correct?'CORRECT':'INCORRECT',grading_verified:true,reason:'EQUIVALENT_FRACTION'};
  }
  if(Array.isArray(ref.accepted)){
    const actual=normalizeText(response);
    const accepted=ref.accepted.map(normalizeText);
    return {criterion_result:accepted.includes(actual)?'CORRECT':'INCORRECT',grading_verified:true,reason:'EXACT_ACCEPTED_TEXT'};
  }
  return {
    criterion_result:'UNRESOLVED',
    grading_verified:false,
    reason:ref.accepted_meaning?'SEMANTIC_MEANING_NEEDS_RECHECK':
      Array.isArray(ref.required_points)?'MULTI_POINT_RESPONSE_NEEDS_RECHECK':
      ref.rubric_ref?'RUBRIC_RESPONSE_NEEDS_RECHECK':
      responseFormat==='PAIR_INTEGER'?'PAIR_RESPONSE_NEEDS_RECHECK':
      'NON_DETERMINISTIC_RESPONSE'
  };
}
function standardizeItem(doc,item,subject){
  return {
    item_id:item.id,
    family_id:`BASELINE.${subject}.${item.concept_id}`,
    concept_id:item.concept_id,
    concept_version:'1.0',
    rubric_ref:item.answer?.rubric_ref??`BASELINE.${item.concept_id}`,
    rubric_version:'1.0',
    purpose:'DIAGNOSTIC',
    prompt_or_artifact_ref:standardizedPrompt(doc,item),
    response_format:item.response_type,
    answer_or_scoring_ref:item.answer,
    difficulty_band:'GRADE4_PREREQUISITE',
    novelty_relation:'BASELINE',
    source_kind:'ORIGINAL_GENERATED',
    provenance_ref:'NTL6-G4-BASELINE-V1',
    review_status:'REVIEWED_BY_SYSTEM_RULES',
    copyright_handling:'ORIGINAL_GENERATED',
    assessment_role:'DIAGNOSTIC',
    mechanism_probe:(item.signals??[])[0]??'BASELINE_PREREQUISITE',
    help_policy:item.help_policy??'NO_HELP_BEFORE_SUBMISSION',
    scope:item.concept_id
  };
}

export function loadBaselineSubject(subject,options={}){
  const root=path.resolve(options.root??DEFAULT_ROOT);
  const file=path.join(root,BASELINE_DIR,subjectFile(subject));
  const doc=JSON.parse(fs.readFileSync(file,'utf8'));
  if(doc.contract_version!=='NTL6_GRADE4_BASELINE_ITEMS/1.0') throw new Error('INVALID_BASELINE_CONTRACT');
  return {
    subject,
    minutes:doc.minutes,
    items:doc.items.map((item)=>standardizeItem(doc,item,subject)),
    rubrics:doc.rubrics??[]
  };
}

export function createBaselineAssessment({learnerId,subject,requestedAt},options={}){
  const loaded=loadBaselineSubject(subject,options);
  const assessmentId=`BASELINE-${subject}-${String(requestedAt).slice(0,10)}`;
  const studentItems=loaded.items.map(({answer_or_scoring_ref,...item})=>item);
  const parentKey=loaded.items.map((item)=>({
    item_id:item.item_id,
    concept_id:item.concept_id,
    rubric_ref:item.rubric_ref,
    rubric_version:item.rubric_version,
    answer_or_scoring_ref:item.answer_or_scoring_ref,
    source_ref:'content/assessments/grade4-baseline-v1'
  }));
  return {
    request:{
      contract_version:'ASSESSMENT_REQUEST/1.0',
      request_id:`baseline-${subject.toLowerCase()}-${String(requestedAt).replace(/[^0-9]/g,'').slice(0,14)}`,
      learner_id:learnerId,
      subject,
      target_concepts:[...new Set(loaded.items.map((x)=>x.concept_id))],
      purpose:'DIAGNOSTIC',
      max_items:loaded.items.length,
      time_budget_minutes:loaded.minutes,
      difficulty_band:'GRADE4_PREREQUISITE',
      requested_at:requestedAt,
      parent_constraints:{baseline_id:'NTL6-G4-BASELINE-V1'}
    },
    candidate:{
      contract_version:'ASSESSMENT_CANDIDATE/1.0',
      assessment_id:assessmentId,
      request_ref:`baseline-${subject.toLowerCase()}`,
      selected_items:loaded.items.map((x)=>x.item_id),
      generated_items:[],
      shortage:[],
      exposure_checks:['BASELINE_PRESET'],
      validation_refs:['content/assessments/grade4-baseline-v1/baseline-manifest.json'],
      estimated_minutes:loaded.minutes,
      status:'PARENT_PREVIEW'
    },
    preview:{student_items:studentItems,parent_key:parentKey},
    baseline_candidate:true,
    baseline_subject:subject,
    baseline_id:'NTL6-G4-BASELINE-V1',
    created_at:requestedAt,
    status:'PARENT_PREVIEW'
  };
}

export function readBaselineAnchor({learnerId},options={}){
  const root=path.resolve(options.root??DEFAULT_ROOT);
  const file=baselineAnchorPath(root,learnerId);
  if(!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file,'utf8'));
}

export function acceptBaselineAssessment({learnerId,assessmentId,subject,acceptedAt,baselineSummary=null},options={}){
  const root=path.resolve(options.root??DEFAULT_ROOT);
  required(learnerId,'learnerId');required(assessmentId,'assessmentId');required(subject,'subject');required(acceptedAt,'acceptedAt');
  subjectFile(subject);
  const ledgerPath=path.join(root,'runtime-data','ledger','evidence.jsonl');
  const rows=fs.existsSync(ledgerPath)?readLedgerRecords(ledgerPath):[];
  const evidenceRows=rows.filter((r)=>r.record_type==='EVIDENCE_OPPORTUNITY'&&r.payload?.learner_id===learnerId&&r.payload?.session_id===assessmentId);
  if(!evidenceRows.length) throw new Error('BASELINE_RESULTS_REQUIRED');
  const eligibility=new Map(rows.filter((r)=>r.record_type==='EVIDENCE_ELIGIBILITY').map((r)=>[r.payload?.evidence_id,r.payload]));
  const items=evidenceRows.map((r)=>{
    const e=r.payload;
    const el=eligibility.get(e.evidence_id);
    const correct=e.result?.criterion_result==='CORRECT';
    const independent=correct&&el?.rights?.INDEPENDENCE_OK==='GRANTED';
    return {
      evidence_id:e.evidence_id,
      concept_id:e.target?.concept_id??'UNKNOWN',
      criterion_result:e.result?.criterion_result??'UNRESOLVED',
      independence:independent?'INDEPENDENT_CORRECT':correct?'CORRECT_WITH_LIMITATION':'NOT_INDEPENDENT_CORRECT'
    };
  });
  const independentCorrect=items.filter((x)=>x.independence==='INDEPENDENT_CORRECT').length;
  const evidenceTotal=items.length;
  const total=Number.isInteger(baselineSummary?.total_items)?baselineSummary.total_items:evidenceTotal;
  const unresolvedCount=Number.isInteger(baselineSummary?.unresolved_count)?baselineSummary.unresolved_count:Math.max(0,total-evidenceTotal);
  const incorrectCount=Number.isInteger(baselineSummary?.incorrect_count)?baselineSummary.incorrect_count:Math.max(0,evidenceTotal-independentCorrect);
  const anchorFile=baselineAnchorPath(root,learnerId);
  const prior=fs.existsSync(anchorFile)?JSON.parse(fs.readFileSync(anchorFile,'utf8')):{
    contract_version:'PARENT_BASELINE_ANCHOR/1.0',
    learner_id:learnerId,
    baseline_id:'NTL6-G4-BASELINE-V1',
    accepted_subjects:{}
  };
  if(prior.accepted_subjects?.[subject]) throw new Error('BASELINE_SUBJECT_ALREADY_ACCEPTED');
  prior.accepted_subjects??={};
  prior.accepted_subjects[subject]={
    assessment_id:assessmentId,
    accepted_at:acceptedAt,
    summary:`Mốc khởi động: ${independentCorrect}/${total} câu có bằng chứng tự làm đúng; ${incorrectCount} câu sai; ${unresolvedCount} câu chưa thể chấm chắc và cần kiểm tra thêm.`,
    independent_correct_count:independentCorrect,
    incorrect_count:incorrectCount,
    observed_item_count:total,
    evidence_item_count:evidenceTotal,
    unresolved_item_count:unresolvedCount,
    items
  };
  fs.mkdirSync(path.dirname(anchorFile),{recursive:true});
  fs.writeFileSync(anchorFile,JSON.stringify(prior,null,2)+'\n','utf8');
  return prior;
}

export function baselineRoadmapContext({learnerId},options={}){
  const anchor=readBaselineAnchor({learnerId},options);
  if(!anchor) return {baselineRef:'UNKNOWN',baselineSubjectStates:{}};
  const states={};
  for(const [subject,value] of Object.entries(anchor.accepted_subjects??{})){
    states[subject]={summary:value.summary,assessment_id:value.assessment_id,accepted_at:value.accepted_at};
  }
  return {
    baselineRef:Object.keys(states).length?`PARENT_BASELINE_ANCHOR/1.0:${anchor.baseline_id}`:'UNKNOWN',
    baselineSubjectStates:states
  };
}
