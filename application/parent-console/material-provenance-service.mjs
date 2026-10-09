import fs from 'node:fs';
import path from 'node:path';

function readJsonIfExists(file){
  try{
    if(!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file,'utf8'));
  }catch{
    return null;
  }
}

function normalizedRegistryClass(source){
  const kind=String(source?.source_kind??'').toUpperCase();
  if(kind==='OFFICIAL_CURRICULUM') return 'CTGDPT';
  if(kind==='SCHOOL_TEXTBOOK_OR_MATERIAL') return 'SGK';
  if(kind==='OFFICIAL_EXAM_TARGET') return 'OFFICIAL_SCHOOL';
  if(kind==='SUPPLEMENTARY_REFERENCE') return 'SUPPLEMENTARY_REFERENCE';
  if(kind==='LEARNER_PLATFORM') return 'LEARNER_PLATFORM';
  return kind||'UNKNOWN';
}

function normalizedArchiveClass(entry){
  const cls=String(entry?.source_class??'').toUpperCase();
  if(cls==='OFFICIAL_EVENT_FACT') return 'OFFICIAL_SCHOOL';
  if(cls==='REPORTED_PAST_PAPER') return 'HISTORICAL_REPORTED';
  if(cls==='PRACTICE_MOCK') return 'PRACTICE_MOCK';
  if(cls==='COMPILATION') return 'SUPPLEMENTARY_REFERENCE';
  if(cls==='PAID_OR_UNVERIFIED') return 'COMMERCIAL_UNVERIFIED';
  return cls||'UNKNOWN';
}

function explicitSourceTokens(record){
  const out=new Set();
  const collectValue=(value)=>{
    if(typeof value==='string'){
      const token=value.trim();
      if(/^SRC-[A-Za-z0-9._-]+$/.test(token)||/^NTL-[A-Za-z0-9._-]+$/.test(token)) out.add(token);
      return;
    }
    if(Array.isArray(value)) for(const item of value) collectValue(item);
  };
  const walk=(node)=>{
    if(!node||typeof node!=='object') return;
    if(Array.isArray(node)){
      for(const item of node) walk(item);
      return;
    }
    for(const [key,value] of Object.entries(node)){
      const k=String(key).toLowerCase();
      if(['source_id','source_ids','source_ref','source_refs'].includes(k)) collectValue(value);
      if(value&&typeof value==='object') walk(value);
    }
  };
  walk(record);
  return [...out];
}

function generationKinds(record){
  const kinds=new Set();
  const add=(value)=>{
    const v=String(value??'').trim().toUpperCase();
    if(v) kinds.add(v);
  };
  add(record?.generation_origin);
  add(record?.source_kind);
  for(const item of record?.preview?.student_items??[]) add(item?.source_kind);
  for(const artifact of record?.source_artifacts??[]) add(artifact?.source_kind);
  return [...kinds];
}

function generationOrigin(record,artifacts=[]){
  const kinds=generationKinds(record);
  if(kinds.some((x)=>x==='AI_GENERATED')) return 'AI_GENERATED';
  if(kinds.some((x)=>x==='ORIGINAL_GENERATED'||x.startsWith('GENERATED_')||x.endsWith('_GENERATED'))) return 'ORIGINAL_GENERATED';
  if(kinds.some((x)=>x.includes('LEARNER'))) return 'LEARNER_ORIGIN';
  if(kinds.some((x)=>x.includes('UPLOADED')||x.includes('IMPORTED')||x==='LEGACY_CHAT_ARTIFACT')) return 'IMPORTED';
  const actors=new Set(artifacts.map((x)=>String(x?.source_actor??'').toUpperCase()).filter(Boolean));
  if(actors.size===1&&actors.has('LEARNER')) return 'LEARNER_ORIGIN';
  return 'UNKNOWN';
}

function registryRef(source){
  return {
    source_id:source.source_id,
    source_class:normalizedRegistryClass(source),
    authority:source.authority_tier??'UNKNOWN',
    title:source.title??source.source_id,
    ref:source?.provenance?.url??source?.provenance?.local_ref??source.source_id,
    confidence:source.status??'UNKNOWN',
    note:Array.isArray(source.uncertainty)&&source.uncertainty.length?source.uncertainty[0]:null
  };
}

function archiveRef(entry){
  return {
    source_id:entry.id,
    source_class:normalizedArchiveClass(entry),
    authority:entry.authority_ceiling??'UNKNOWN',
    title:entry.title??entry.id,
    ref:entry.url??entry.urls?.[0]??entry.id,
    confidence:entry.provenance_confidence??'UNKNOWN',
    note:null
  };
}

function registryLane(source){
  const kind=String(source?.source_kind??'').toUpperCase();
  if(kind==='OFFICIAL_CURRICULUM'||kind==='SCHOOL_TEXTBOOK_OR_MATERIAL') return 'curriculum_grounding';
  return 'exam_pattern_evidence';
}

function sourceUnavailable(source){
  const status=String(source?.status??'').toUpperCase();
  return status.includes('MISSING')||status.includes('NOT_YET')||status.includes('UNKNOWN');
}

export function createMaterialProvenanceProjector(options={}){
  const root=path.resolve(options.root??process.cwd());
  const registry=readJsonIfExists(path.join(root,'content','sources','source-registry.json'));
  const archive=readJsonIfExists(path.join(root,'content','exam-target','sample-district','archive-index.json'));
  const registryById=new Map((registry?.sources??[]).map((x)=>[x.source_id,x]));
  const archiveById=new Map((archive?.entries??[]).map((x)=>[x.id,x]));

  function project(record,artifacts=[]){
    const curriculum_grounding=[];
    const exam_pattern_evidence=[];
    const gaps=[];

    for(const token of explicitSourceTokens(record)){
      const source=registryById.get(token);
      if(source){
        if(sourceUnavailable(source)){
          gaps.push(`SOURCE_UNVERIFIED:${token}`);
          continue;
        }
        const ref=registryRef(source);
        if(registryLane(source)==='curriculum_grounding') curriculum_grounding.push(ref);
        else exam_pattern_evidence.push(ref);
        continue;
      }
      const entry=archiveById.get(token);
      if(entry){
        exam_pattern_evidence.push(archiveRef(entry));
        continue;
      }
      gaps.push(`UNRESOLVED_SOURCE_REF:${token}`);
    }

    const origin=generationOrigin(record,artifacts);
    if(!curriculum_grounding.length) gaps.push('CURRICULUM_GROUNDING_UNKNOWN');
    if(!exam_pattern_evidence.length) gaps.push('EXAM_PATTERN_EVIDENCE_UNKNOWN');
    if(origin==='UNKNOWN') gaps.push('GENERATION_ORIGIN_UNKNOWN');

    return {
      curriculum_grounding,
      exam_pattern_evidence,
      generation_origin:origin,
      gaps:[...new Set(gaps)]
    };
  }

  return Object.freeze({project});
}

const SUBJECT_CURRICULUM_SOURCE=Object.freeze({
  MATH:'SRC-SCHOOL-MATH5',
  VIETNAMESE:'SRC-SCHOOL-VI5',
  ENGLISH:'SRC-SCHOOL-EN5'
});

function uniqueStrings(values){
  return [...new Set((Array.isArray(values)?values:[]).map((value)=>String(value??'').trim()).filter(Boolean))];
}

function authorityRegistryRef(source){
  return {
    ...registryRef(source),
    source_kind:source.source_kind??'UNKNOWN',
    allowed_use:Array.isArray(source.allowed_use)?source.allowed_use:[],
    forbidden_use:Array.isArray(source.forbidden_use)?source.forbidden_use:[]
  };
}

function authorityArchiveRef(entry){
  return {
    ...archiveRef(entry),
    source_kind:entry.source_class??'UNKNOWN',
    allowed_use:Array.isArray(entry.allowed_use)?entry.allowed_use:[],
    subjects:Array.isArray(entry.subjects)?entry.subjects:[]
  };
}

export function createSourceAuthorityResolver(options={}){
  const root=path.resolve(options.root??process.cwd());
  const registry=readJsonIfExists(path.join(root,'content','sources','source-registry.json'));
  const archive=readJsonIfExists(path.join(root,'content','exam-target','sample-district','archive-index.json'));
  const registryById=new Map((registry?.sources??[]).map((source)=>[source.source_id,source]));
  const archiveById=new Map((archive?.entries??[]).map((entry)=>[entry.id,entry]));

  function resolveRefs(refs=[]){
    const resolved=[];
    const unavailable=[];
    const unresolved=[];
    for(const token of uniqueStrings(refs)){
      const source=registryById.get(token);
      if(source){
        if(sourceUnavailable(source)) unavailable.push({source_id:token,status:source.status??'UNKNOWN'});
        else resolved.push(authorityRegistryRef(source));
        continue;
      }
      const entry=archiveById.get(token);
      if(entry){
        resolved.push(authorityArchiveRef(entry));
        continue;
      }
      unresolved.push(token);
    }
    return {resolved,unavailable,unresolved};
  }

  function curriculumRefsForSubject(subject){
    const normalized=String(subject??'').trim().toUpperCase();
    if(!normalized) return {resolved:[],unavailable:[],unresolved:[]};
    const ids=['SRC-MOET-CTGDPT2018'];
    const schoolSource=SUBJECT_CURRICULUM_SOURCE[normalized];
    if(schoolSource) ids.push(schoolSource);
    return resolveRefs(ids);
  }

  return Object.freeze({resolveRefs,curriculumRefsForSubject});
}

export function bindSourceFusionProvenance(record,sourcePack){
  if(!record||typeof record!=='object'||Array.isArray(record)) throw new Error('INVALID_MATERIAL_RECORD');
  if(!sourcePack||sourcePack.contract_version!=='SOURCE_FUSION_PACK/1.0'||sourcePack.authority_effect!=='NONE'){
    throw new Error('INVALID_SOURCE_FUSION_PACK');
  }
  const lanes=sourcePack.lanes??{};
  const explicitMissingOrConflict=Object.entries(lanes)
    .filter(([,lane])=>['UNKNOWN','CONFLICT'].includes(String(lane?.status??'').toUpperCase()))
    .map(([name])=>name);
  return {
    ...record,
    source_fusion:{
      contract_version:'SOURCE_FUSION_BINDING/1.0',
      source_pack_ref:sourcePack.source_pack_id,
      curriculum_refs:(lanes.curriculum?.source_refs??[]).map((ref)=>ref.source_id??ref.ref??ref),
      learner_evidence_refs:(lanes.learner_evidence?.source_refs??[]).map((ref)=>ref.source_id??ref.ref??ref),
      ntl_reference_refs:[
        ...(lanes.ntl_exam_pattern?.source_refs??[]),
        ...(lanes.reference?.source_refs??[])
      ].map((ref)=>ref.source_id??ref.ref??ref),
      supplementary_context_refs:(lanes.supplementary?.source_refs??[]).map((ref)=>ref.source_id??ref.ref??ref),
      item_family_refs:Array.isArray(sourcePack.item_family_refs)?sourcePack.item_family_refs:[],
      generation_constraints:Array.isArray(sourcePack.generation_constraints)?sourcePack.generation_constraints:[],
      explicit_missing_or_conflict_lanes:explicitMissingOrConflict,
      generation_origin:record.generation_origin??'UNKNOWN',
      authority_effect:'NONE'
    }
  };
}
