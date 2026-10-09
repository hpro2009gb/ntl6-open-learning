import { persistUniClassSourceSnapshot } from './uniclass-context-service.mjs';

const TERMINAL_UNAVAILABLE=new Set(['LOGIN_REQUIRED','CONTRACT_STALE','REFRESH_UNAVAILABLE']);
const SUCCESS_STATUSES=new Set(['READY','PARTIAL']);
const FORBIDDEN_KEY=/^(authorization|cookie|cookies|password|secret|token|access_token|refresh_token|session|session_cookie|session_token|credential|credentials)$/i;

function text(value){
  if(value===null||value===undefined) return null;
  const normalized=String(value).trim();
  return normalized||null;
}

function requireObject(value,code='INVALID_UNICLASS_REFRESH_RESULT'){
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error(code);
  return value;
}

function assertNoCredentialMaterial(value,path=[]){
  if(value===null||value===undefined) return;
  if(Array.isArray(value)){
    value.forEach((item,index)=>assertNoCredentialMaterial(item,[...path,String(index)]));
    return;
  }
  if(typeof value!=='object') return;
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN_KEY.test(key)) throw new Error('UNICLASS_CREDENTIAL_MATERIAL_FORBIDDEN');
    assertNoCredentialMaterial(child,[...path,key]);
  }
}

function pick(object,fields){
  const out={};
  for(const field of fields){
    if(object?.[field]!==undefined) out[field]=object[field];
  }
  return out;
}

function sanitizeArray(value,fields){
  if(!Array.isArray(value)) return [];
  return value
    .filter((item)=>item&&typeof item==='object'&&!Array.isArray(item))
    .map((item)=>pick(item,fields));
}

function sanitizePending(value){
  if(!value||typeof value!=='object'||Array.isArray(value)) return null;
  return {
    globally_verified:value.globally_verified===true,
    open_items:sanitizeArray(value.open_items,[
      'id','date','subject','lesson_title','title','status','due_at','source_ref'
    ])
  };
}

function normalizeStatus(value){
  const status=String(value??'').trim().toUpperCase();
  if(SUCCESS_STATUSES.has(status)||TERMINAL_UNAVAILABLE.has(status)) return status;
  throw new Error('INVALID_UNICLASS_REFRESH_STATUS');
}

function baseResult(status,result){
  return {
    contract_version:'UNICLASS_REFRESH_INGEST/1.0',
    status,
    planning_only:true,
    mastery_evidence:false,
    persisted:false,
    captured_at:text(result?.captured_at),
    refresh_transport:'AKI_BROWSERSKILL',
    refresh_path:'UNICLASS_PAGE_BACKEND_FAST_PATH',
    rediscovery_required:status==='CONTRACT_STALE',
    login_required:status==='LOGIN_REQUIRED',
    unknowns:Array.isArray(result?.unknowns)?result.unknowns.map((x)=>String(x)):[]
  };
}

export function sanitizeUniClassRefreshResult(input){
  const result=requireObject(input);
  assertNoCredentialMaterial(result);
  const status=normalizeStatus(result.status);

  if(TERMINAL_UNAVAILABLE.has(status)){
    return {
      ...baseResult(status,result),
      snapshot:null,
      reason:text(result.reason)??status
    };
  }

  const capturedAt=text(result.captured_at);
  if(!capturedAt||Number.isNaN(new Date(capturedAt).getTime())) throw new Error('INVALID_UNICLASS_CAPTURED_AT');

  const sessions=sanitizeArray(result.sessions,[
    'id','date','subject','session_no','title','status','time_local','lesson_id','lesson_title',
    'visible_assignment_results','tasks_after_session','source_ref'
  ]);
  const exercises=sanitizeArray(result.exercises,[
    'id','date','subject','lesson_id','lesson_title','title','status','due_at','score','source_ref'
  ]);
  const visibleResultContext=sanitizeArray(result.visible_result_context,[
    'scope','date','subject','kind','score','status','authority','source_ref'
  ]);
  const dailyActivity=sanitizeArray(result.daily_activity,[
    'date','subject','lesson_id','lesson_title','session_id','exercise_id','kind','score','status','source_ref'
  ]);

  const snapshot={
    contract_version:'UNICLASS_PLANNING_SNAPSHOT/1.1',
    source:'UNICLASS',
    captured_at:capturedAt,
    timezone:text(result.timezone)??'Asia/Ho_Chi_Minh',
    status:status==='PARTIAL'?'PARTIAL_VERIFIED':'LIVE_VERIFIED',
    credential_material_persisted:false,
    planning_only:true,
    mastery_evidence:false,
    refresh_provenance:{
      transport:'AKI_BROWSERSKILL',
      path:'UNICLASS_PAGE_BACKEND_FAST_PATH',
      requested_window:result.requested_window&&typeof result.requested_window==='object'
        ?pick(result.requested_window,['start_date','end_date','timezone'])
        :null,
      session_count:sessions.length,
      exercise_count:exercises.length,
      backend_contract_ref:text(result.backend_contract_ref),
      recipe_ref:text(result.recipe_ref)
    },
    sessions,
    exercises,
    visible_result_context:visibleResultContext,
    daily_activity:dailyActivity,
    coverage:result.coverage&&typeof result.coverage==='object'
      ?pick(result.coverage,['start_date','end_date','days','complete'])
      :null,
    pending_assignments:sanitizePending(result.pending_assignments),
    unknowns:Array.isArray(result.unknowns)?result.unknowns.map((x)=>String(x)):[]
  };

  return {
    ...baseResult(status,result),
    snapshot
  };
}

export function persistUniClassRefreshResult(input,options={}){
  const sanitized=sanitizeUniClassRefreshResult(input);
  if(!sanitized.snapshot) return sanitized;
  const receipt=persistUniClassSourceSnapshot(sanitized.snapshot,options);
  return {
    ...sanitized,
    persisted:true,
    receipt
  };
}
