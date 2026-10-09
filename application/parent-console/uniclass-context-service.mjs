import fs from 'node:fs';
import path from 'node:path';

const LOAD_RANK=Object.freeze({LOW:0,MEDIUM:1,HIGH:2,UNKNOWN:-1});
const DEFAULT_TTL_HOURS=12;

function readJson(file){ return JSON.parse(fs.readFileSync(file,'utf8')); }
function rel(root,file){ return path.relative(root,file).replaceAll('\\','/'); }
function writeJson(file,value){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n','utf8'); }

function snapshotFileName(capturedAt){
  const d=new Date(capturedAt);
  if(Number.isNaN(d.getTime())) throw new Error('INVALID_UNICLASS_CAPTURED_AT');
  return d.toISOString().replaceAll(':','-')+'.json';
}

function assertSafeExternalSnapshot(snapshot){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)) throw new Error('INVALID_UNICLASS_SNAPSHOT');
  if(snapshot.credential_material_persisted!==false) throw new Error('UNICLASS_CREDENTIAL_MATERIAL_FORBIDDEN');
  if(snapshot.planning_only!==true||snapshot.mastery_evidence!==false) throw new Error('UNICLASS_CONTEXT_AUTHORITY_INVALID');
  if(!snapshot.captured_at) throw new Error('MISSING_UNICLASS_CAPTURED_AT');
  return snapshot;
}

function localDate(asOf,timeZone){
  const d=new Date(asOf);
  if(Number.isNaN(d.getTime())) throw new Error('INVALID_AS_OF');
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
  const get=(type)=>parts.find((x)=>x.type===type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function maxLoad(a,b){
  const left=String(a??'UNKNOWN').toUpperCase();
  const right=String(b??'UNKNOWN').toUpperCase();
  if(left==='UNKNOWN'&&right==='UNKNOWN') return 'UNKNOWN';
  if(left==='UNKNOWN') return right;
  if(right==='UNKNOWN') return left;
  return (LOAD_RANK[left]??-1)>=(LOAD_RANK[right]??-1)?left:right;
}

function workloadHint(snapshot,date){
  const sessions=Array.isArray(snapshot?.sessions)?snapshot.sessions:[];
  const sameDay=sessions.filter((x)=>String(x?.date??'')===date);
  const active=sameDay.filter((x)=>['UPCOMING','IN_PROGRESS'].includes(String(x?.status??'').toUpperCase()));
  const completed=sameDay.filter((x)=>String(x?.status??'').toUpperCase()==='COMPLETED');
  const open=Array.isArray(snapshot?.pending_assignments?.open_items)?snapshot.pending_assignments.open_items:[];
  const dueOpen=open.filter((x)=>!x?.date||String(x.date)===date);
  if(active.length||dueOpen.length>=2) return {external_load:'HIGH',unusual_load:dueOpen.length>=2?'HOMEWORK_HEAVY':'NONE',active_sessions:active.length,pending_open:dueOpen.length};
  if(dueOpen.length===1) return {external_load:'MEDIUM',unusual_load:'NONE',active_sessions:0,pending_open:1};
  if(completed.length) return {external_load:'LOW',unusual_load:'NONE',active_sessions:0,pending_open:0};
  return {external_load:'LOW',unusual_load:'NONE',active_sessions:0,pending_open:0};
}

function emptyProjections(reason){
  return {
    workload:{
      status:'UNAVAILABLE',
      reason,
      planning_only:true,
      mastery_evidence:false,
      value:{external_load:'UNKNOWN',unusual_load:'UNKNOWN',active_sessions:0,pending_open:0}
    },
    learning_position_exposure:{
      status:'UNAVAILABLE',
      reason,
      planning_only:true,
      mastery_evidence:false,
      sessions:[],
      exercises:[]
    },
    external_performance:{
      status:'UNAVAILABLE',
      reason,
      planning_only:true,
      mastery_evidence:false,
      authority:'EXTERNAL_CONTEXT_ONLY',
      results:[]
    }
  };
}

function freshProjections(snapshot,date,hint){
  const sessions=Array.isArray(snapshot?.sessions)?snapshot.sessions:[];
  const exercises=Array.isArray(snapshot?.exercises)?snapshot.exercises:[];
  const results=[
    ...(Array.isArray(snapshot?.visible_result_context)?snapshot.visible_result_context:[]),
    ...sessions.flatMap((session)=>Array.isArray(session?.visible_assignment_results)
      ?session.visible_assignment_results.map((result)=>({
          ...result,
          date:result?.date??session?.date??null,
          subject:result?.subject??session?.subject??null,
          lesson_title:result?.lesson_title??session?.title??session?.lesson_title??null,
          authority:result?.authority??'EXTERNAL_CONTEXT_ONLY'
        }))
      :[])
  ];
  return {
    workload:{
      status:'CURRENT',
      reason:null,
      planning_only:true,
      mastery_evidence:false,
      local_date:date,
      value:hint
    },
    learning_position_exposure:{
      status:'CURRENT',
      reason:null,
      planning_only:true,
      mastery_evidence:false,
      sessions,
      exercises
    },
    external_performance:{
      status:'CURRENT',
      reason:null,
      planning_only:true,
      mastery_evidence:false,
      authority:'EXTERNAL_CONTEXT_ONLY',
      results
    }
  };
}

export function persistUniClassSourceSnapshot(snapshot,options={}){
  const root=path.resolve(options.root??process.cwd());
  const safe=assertSafeExternalSnapshot(snapshot);
  const base=path.join(root,'runtime-data','external-context','uniclass');
  const archive=path.join(base,'snapshots',snapshotFileName(safe.captured_at));
  const current=path.join(base,'current.json');
  writeJson(archive,safe);
  writeJson(current,safe);
  const readback=readJson(current);
  if(readback.captured_at!==safe.captured_at||readback.planning_only!==true||readback.mastery_evidence!==false||readback.credential_material_persisted!==false){
    throw new Error('UNICLASS_SNAPSHOT_READBACK_FAILED');
  }
  return {current_ref:rel(root,current),archive_ref:rel(root,archive),captured_at:safe.captured_at};
}

export function resolveUniClassPlanningContext(options={}){
  const root=path.resolve(options.root??process.cwd());
  const asOf=options.asOf??new Date().toISOString();
  const ttlHours=Number.isFinite(options.ttlHours)?options.ttlHours:DEFAULT_TTL_HOURS;
  const file=path.join(root,'runtime-data','external-context','uniclass','current.json');

  if(!fs.existsSync(file)){
    return {
      contract_version:'UNICLASS_PLANNING_CONTEXT/1.1',
      status:'NOT_FOUND',
      freshness:'MISSING',
      refresh_required:true,
      planning_only:true,
      mastery_evidence:false,
      source_ref:null,
      captured_at:null,
      workload_hint:{external_load:'UNKNOWN',unusual_load:'UNKNOWN',active_sessions:0,pending_open:0},
      projections:emptyProjections('MISSING'),
      snapshot:null
    };
  }

  let snapshot;
  try{ snapshot=readJson(file); }
  catch{
    return {
      contract_version:'UNICLASS_PLANNING_CONTEXT/1.1',
      status:'INVALID_SNAPSHOT',
      freshness:'INVALID',
      refresh_required:true,
      planning_only:true,
      mastery_evidence:false,
      source_ref:rel(root,file),
      captured_at:null,
      workload_hint:{external_load:'UNKNOWN',unusual_load:'UNKNOWN',active_sessions:0,pending_open:0},
      projections:emptyProjections('INVALID'),
      snapshot:null
    };
  }

  const captured=new Date(snapshot?.captured_at??'');
  const now=new Date(asOf);
  const ageMs=now.getTime()-captured.getTime();
  const ttlMs=ttlHours*3600000;
  const fresh=Number.isFinite(ageMs)&&ageMs>=0&&ageMs<=ttlMs;
  const timeZone=snapshot?.timezone??'Asia/Ho_Chi_Minh';
  const date=localDate(asOf,timeZone);
  const hint=fresh?workloadHint(snapshot,date):{external_load:'UNKNOWN',unusual_load:'UNKNOWN',active_sessions:0,pending_open:0};
  const projections=fresh?freshProjections(snapshot,date,hint):emptyProjections('STALE');

  return {
    contract_version:'UNICLASS_PLANNING_CONTEXT/1.1',
    status:fresh?'READY':'STALE',
    freshness:fresh?'FRESH':'STALE',
    refresh_required:!fresh,
    planning_only:true,
    mastery_evidence:false,
    source_ref:rel(root,file),
    captured_at:snapshot?.captured_at??null,
    ttl_hours:ttlHours,
    age_minutes:Number.isFinite(ageMs)?Math.max(0,Math.round(ageMs/60000)):null,
    local_date:date,
    workload_hint:hint,
    projections,
    snapshot:{
      status:snapshot?.status??'UNKNOWN',
      sessions:Array.isArray(snapshot?.sessions)?snapshot.sessions:[],
      exercises:Array.isArray(snapshot?.exercises)?snapshot.exercises:[],
      visible_result_context:Array.isArray(snapshot?.visible_result_context)?snapshot.visible_result_context:[],
      daily_activity:Array.isArray(snapshot?.daily_activity)?snapshot.daily_activity:[],
      coverage:snapshot?.coverage??null,
      pending_assignments:snapshot?.pending_assignments??null,
      refresh_provenance:snapshot?.refresh_provenance??null,
      unknowns:Array.isArray(snapshot?.unknowns)?snapshot.unknowns:[]
    }
  };
}

export function mergePlanningWorkload(base,uniclass){
  const school=base??{};
  if(uniclass?.status!=='READY'){
    return {...school};
  }
  const uni=uniclass.workload_hint??{};
  const unusual=String(school.unusual_load??'UNKNOWN').toUpperCase();
  const uniUnusual=String(uni.unusual_load??'UNKNOWN').toUpperCase();
  return {
    ...school,
    external_load:maxLoad(school.external_load,uni.external_load),
    schedule_known:school.schedule_known===true||uniclass.status==='READY',
    unusual_load:unusual!=='NONE'&&unusual!=='UNKNOWN'?unusual:(uniUnusual!=='UNKNOWN'?uniUnusual:unusual)
  };
}
