import { mergePlanningWorkload } from './uniclass-context-service.mjs';

const UNAVAILABLE_REFRESH=new Set(['REFRESH_UNAVAILABLE','LOGIN_REQUIRED','CONTRACT_STALE']);

function text(value){
  if(value===null||value===undefined) return null;
  const normalized=String(value).trim();
  return normalized||null;
}

function schoolPositionSummary(value){
  if(!value){
    return {
      status:'UNKNOWN',
      planning_only:true,
      mastery_evidence:false,
      position:null,
      resolved_entry:null,
      lineage:null
    };
  }
  return {
    status:String(value.state??'UNKNOWN').toUpperCase(),
    planning_only:true,
    mastery_evidence:false,
    position:value.position??null,
    resolved_entry:value.resolved_entry??null,
    lineage:value.lineage??null
  };
}

function refreshSummary(value){
  if(!value) return {status:'NOT_ATTEMPTED',reason:null,rediscovery_required:false,login_required:false};
  const status=String(value.status??'UNKNOWN').toUpperCase();
  return {
    status,
    reason:text(value.reason),
    rediscovery_required:value.rediscovery_required===true||status==='CONTRACT_STALE',
    login_required:value.login_required===true||status==='LOGIN_REQUIRED'
  };
}

function currentUniClassProjection(uniclass,key){
  const projection=uniclass?.projections?.[key];
  if(uniclass?.status==='READY'&&projection?.status==='CURRENT') return projection;
  return {
    status:'UNAVAILABLE',
    reason:uniclass?.freshness??uniclass?.status??'UNKNOWN',
    planning_only:true,
    mastery_evidence:false,
    ...(key==='learning_position_exposure'?{sessions:[],exercises:[]}:{results:[],authority:'EXTERNAL_CONTEXT_ONLY'})
  };
}

function gapsFor(schoolPosition,uniclass,refresh){
  const gaps=[];
  const positionStatus=String(schoolPosition?.status??'UNKNOWN').toUpperCase();
  if(positionStatus==='AMBIGUOUS') gaps.push('SCHOOL_POSITION_AMBIGUOUS');
  else if(positionStatus==='UNRESOLVED') gaps.push('SCHOOL_POSITION_UNRESOLVED');
  else if(positionStatus==='UNKNOWN') gaps.push('SCHOOL_POSITION_UNKNOWN');

  const uniStatus=String(uniclass?.status??'NOT_FOUND').toUpperCase();
  if(uniStatus==='STALE') gaps.push('UNICLASS_STALE');
  else if(uniStatus==='NOT_FOUND') gaps.push('UNICLASS_MISSING');
  else if(uniStatus==='INVALID_SNAPSHOT') gaps.push('UNICLASS_INVALID');

  if(UNAVAILABLE_REFRESH.has(refresh.status)) gaps.push(`UNICLASS_${refresh.status}`);
  return [...new Set(gaps)];
}

export function buildCurrentLearningContext(options={}){
  const school=options.school_context??{};
  const schoolPosition=schoolPositionSummary(options.school_position_context);
  const uniclass=options.uniclass_context??{
    status:'NOT_FOUND',
    freshness:'MISSING',
    refresh_required:true,
    projections:null
  };
  const refresh=refreshSummary(options.uniclass_refresh_outcome);
  const workload=mergePlanningWorkload(school.workload_context??{},uniclass);
  const uniLearning=currentUniClassProjection(uniclass,'learning_position_exposure');
  const uniPerformance=currentUniClassProjection(uniclass,'external_performance');
  const conflicts=[];

  if(schoolPosition.status==='CONFLICT'){
    conflicts.push({
      kind:'SCHOOL_POSITION_CONFLICT',
      refs:Array.isArray(schoolPosition.lineage?.conflicts_with)
        ?schoolPosition.lineage.conflicts_with.map((item)=>item?.id??null).filter(Boolean)
        :[]
    });
  }

  return {
    contract_version:'CURRENT_LEARNING_CONTEXT/1.0',
    as_of:text(options.as_of)??null,
    planning_only:true,
    mastery_evidence:false,
    authority:{
      learner_truth:'UNCHANGED',
      strategy_engine:'UNCHANGED',
      material_resolver:'UNCHANGED',
      external_context:'PLANNING_ONLY'
    },
    workload_context:workload,
    school_context:school,
    school_position_context:schoolPosition,
    uniclass_context:{
      status:uniclass.status??'NOT_FOUND',
      freshness:uniclass.freshness??'MISSING',
      refresh_required:uniclass.refresh_required!==false,
      source_ref:uniclass.source_ref??null,
      captured_at:uniclass.captured_at??null,
      refresh
    },
    learning_position_exposure:{
      planning_only:true,
      mastery_evidence:false,
      school_position:schoolPosition,
      uniclass:uniLearning
    },
    external_performance_context:{
      ...uniPerformance,
      planning_only:true,
      mastery_evidence:false,
      authority:'EXTERNAL_CONTEXT_ONLY'
    },
    conflicts,
    gaps:gapsFor(schoolPosition,uniclass,refresh)
  };
}
