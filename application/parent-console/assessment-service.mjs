import { composeWeeklyCheck, loadCanonicalItemIndex } from '../../content/assessments/weekly/compose-weekly-check.mjs';
import { buildQuestionPreview, loadQuestionAssets, selectQuestionsForAssessment } from './question-service.mjs';

const PURPOSES=new Set(['DIAGNOSTIC','PRACTICE','REPAIR','FRESH_RECHECK','WEEKLY_CHECK','MOCK']);

function req(ok,message) {
  if (!ok) throw new Error(message);
}

function validateRequest(request) {
  req(request?.contract_version==='ASSESSMENT_REQUEST/1.0','ASSESSMENT_REQUEST_CONTRACT_INVALID');
  req(request?.request_id,'REQUEST_ID_REQUIRED');
  req(request?.learner_id,'LEARNER_ID_REQUIRED');
  req(['MATH','VIETNAMESE','ENGLISH'].includes(request?.subject),'SUBJECT_INVALID');
  req(Array.isArray(request?.target_concepts)&&request.target_concepts.length>0,'TARGET_CONCEPTS_REQUIRED');
  req(PURPOSES.has(request?.purpose),'ASSESSMENT_PURPOSE_INVALID');
  req(Number.isInteger(request?.max_items)&&request.max_items>0,'MAX_ITEMS_INVALID');
  req(Number.isFinite(request?.time_budget_minutes)&&request.time_budget_minutes>0,'TIME_BUDGET_INVALID');
  req(request?.requested_at,'REQUESTED_AT_REQUIRED');
}

function previewFromItems(items) {
  const student_items=[];
  const parent_key=[];
  for (const item of items) {
    const preview=buildQuestionPreview(item);
    student_items.push(preview.student_item);
    parent_key.push(preview.parent_key);
  }
  return {student_items,parent_key};
}

function makeAssessmentId(request) {
  return request.parent_constraints?.assessment_id??`ASMT-${request.request_id}`;
}

function itemSubject(item){
  const id=String(item?.concept_id??'');
  if(id.startsWith('MATH.')) return 'MATH';
  if(id.startsWith('VI.')) return 'VIETNAMESE';
  if(id.startsWith('EN.')) return 'ENGLISH';
  return 'UNKNOWN';
}
function defaultWeeklyPools(root,request){
  const assets=loadQuestionAssets(root);
  const target=new Set(request.target_concepts??[]);
  const items=assets.items.filter((item)=>itemSubject(item)===request.subject && (!target.size||target.has(item.concept_id)));
  const byRole=(role)=>items.filter((item)=>item.assessment_role===role).map((item)=>item.item_id);
  const current=items.filter((item)=>item.assessment_role==='DIAGNOSTIC'||item.purpose==='DIAGNOSTIC').map((item)=>item.item_id);
  const transfer=items.filter((item)=>item.assessment_role==='TRANSFER'||item.novelty_relation==='TRANSFER').map((item)=>item.item_id);
  return {current,repair:byRole('REPAIR_PRACTICE'),spaced:byRole('FRESH_RECHECK'),transfer};
}
function weeklyCandidate(request,options={}) {
  const root=options.root;
  const itemIndex=options.itemIndex??loadCanonicalItemIndex(root);
  const pc=request.parent_constraints??{};
  const supplied=pc.category_pools&&Object.values(pc.category_pools).some((x)=>Array.isArray(x)&&x.length);
  const categoryPools=supplied?pc.category_pools:defaultWeeklyPools(root,request);
  const weeklyRequest={
    pack_id:makeAssessmentId(request),
    week_id:pc.week_id??null,
    subject_scope:[request.subject],
    max_items:request.max_items,
    time_budget_minutes:request.time_budget_minutes,
    shares:pc.shares,
    category_pools:categoryPools,
    excluded_item_ids:pc.excluded_item_ids??[],
    recent_item_ids:pc.recent_item_ids??[],
    answer_exposed_item_ids:pc.answer_exposed_item_ids??[],
    estimated_minutes_by_item:pc.estimated_minutes_by_item??{}
  };
  const pack=composeWeeklyCheck(weeklyRequest,{itemIndex,policy:options.weeklyPolicy});
  const ids=pack.items.map((x)=>x.item_id);
  const items=ids.map((id)=>itemIndex.get(id)).filter(Boolean);
  const shortage=pack.unfilled_categories.map((x)=>`${x.category.toUpperCase()}_SHORT_${x.missing}`);
  if (ids.length<request.max_items) shortage.push(`REQUESTED_${request.max_items}_AVAILABLE_${ids.length}`);
  if (!ids.length) shortage.push('NO_ELIGIBLE_ITEMS');
  return {
    candidate:{
      contract_version:'ASSESSMENT_CANDIDATE/1.0',
      assessment_id:makeAssessmentId(request),
      request_ref:request.request_id,
      selected_items:ids,
      generated_items:[],
      shortage:[...new Set(shortage)],
      exposure_checks:[
        ...pack.exclusions.recent.map((id)=>`${id}:EXCLUDED_RECENT`),
        ...pack.exclusions.answer_exposed.map((id)=>`${id}:EXCLUDED_ANSWER_EXPOSED`)
      ],
      validation_refs:[pack.policy_ref],
      estimated_minutes:pack.workload.estimated_minutes,
      status:ids.length ? 'PARENT_PREVIEW' : 'BLOCKED'
    },
    preview:previewFromItems(items),
    weekly_pack:pack
  };
}

export function createAssessmentCandidate(request,options={}) {
  validateRequest(request);
  if (request.purpose==='WEEKLY_CHECK') return weeklyCandidate(request,options);

  const root=options.root;
  const assets=options.assets??loadQuestionAssets(root);
  const result=selectQuestionsForAssessment(request,{
    root,
    assets,
    exposures:options.exposures,
    exposureKnowledge:options.exposureKnowledge,
    asOf:options.asOf??request.requested_at
  });
  const allItems=[...result.selected,...result.generated];
  return {
    candidate:{
      contract_version:'ASSESSMENT_CANDIDATE/1.0',
      assessment_id:makeAssessmentId(request),
      request_ref:request.request_id,
      selected_items:result.selected.map((x)=>x.item_id),
      generated_items:result.generated.map((x)=>x.item_id),
      shortage:result.shortage,
      exposure_checks:result.exposure_checks.length?result.exposure_checks:['NO_EXPOSURE_BLOCKS'],
      validation_refs:result.validation_refs.length?result.validation_refs:['CANONICAL_SEED_ITEMS_ONLY'],
      estimated_minutes:result.estimated_minutes,
      status:allItems.length ? 'PARENT_PREVIEW' : 'BLOCKED'
    },
    preview:previewFromItems(allItems)
  };
}
