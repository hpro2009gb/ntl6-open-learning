import crypto from 'node:crypto';

import { createSourceAuthorityResolver } from './material-provenance-service.mjs';

const LANE_NAMES=Object.freeze([
  'curriculum',
  'school_context',
  'learner_evidence',
  'ntl_exam_pattern',
  'reference',
  'supplementary'
]);

const MANDATORY_CONSTRAINTS=Object.freeze([
  'STRATEGY_AUTHORITY_UNCHANGED',
  'MATERIAL_RESOLVER_EXACT_ARTIFACT_AUTHORITY',
  'HISTORICAL_PAPERS_PATTERN_ONLY',
  'NO_WHOLESALE_REFERENCE_COPY',
  'NO_SECOND_SOURCE_OR_SEARCH_TRUTH'
]);

const EXPECTED_CLASSES=Object.freeze({
  curriculum:new Set(['CTGDPT','SGK']),
  ntl_exam_pattern:new Set(['OFFICIAL_SCHOOL','HISTORICAL_REPORTED','PRACTICE_MOCK','SUPPLEMENTARY_REFERENCE','COMMERCIAL_UNVERIFIED']),
  reference:new Set(['OFFICIAL_SCHOOL','HISTORICAL_REPORTED','PRACTICE_MOCK','SUPPLEMENTARY_REFERENCE','COMMERCIAL_UNVERIFIED']),
  supplementary:new Set(['SUPPLEMENTARY_REFERENCE','LEARNER_PLATFORM'])
});

function stable(value){
  if(Array.isArray(value)) return value.map(stable);
  if(!value||typeof value!=='object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}

function digest(value){
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function uniqueStrings(values){
  return [...new Set((Array.isArray(values)?values:[]).map((value)=>String(value??'').trim()).filter(Boolean))];
}

function applicable(input,name,defaultValue){
  const explicit=input?.lane_applicability?.[name];
  return explicit===undefined?defaultValue:explicit===true;
}

function sourceIds(refs){
  return (refs??[]).map((ref)=>ref?.source_id??ref?.ref??String(ref)).filter(Boolean);
}

function sourceLane(name,isApplicable,resolution,authorityClass){
  if(!isApplicable){
    return {
      status:'NOT_APPLICABLE',
      source_refs:[],
      authority_class:authorityClass,
      observations:[],
      constraints:[],
      freshness:null
    };
  }

  const resolved=Array.isArray(resolution?.resolved)?resolution.resolved:[];
  const unavailable=Array.isArray(resolution?.unavailable)?resolution.unavailable:[];
  const unresolved=Array.isArray(resolution?.unresolved)?resolution.unresolved:[];
  const expected=EXPECTED_CLASSES[name];
  const mismatched=expected
    ?resolved.filter((ref)=>!expected.has(String(ref?.source_class??'UNKNOWN').toUpperCase()))
    :[];

  let status='UNKNOWN';
  if(resolved.length&&unavailable.length===0&&unresolved.length===0&&mismatched.length===0) status='RESOLVED';
  else if(resolved.length||mismatched.length) status='CONFLICT';

  const observations=[
    ...unavailable.map((item)=>`SOURCE_UNAVAILABLE:${item.source_id}:${item.status}`),
    ...unresolved.map((token)=>`UNRESOLVED_SOURCE_REF:${token}`),
    ...mismatched.map((ref)=>`SOURCE_CLASS_MISMATCH:${ref.source_id}:${ref.source_class}`)
  ];

  return {
    status,
    source_refs:resolved,
    authority_class:authorityClass,
    observations,
    constraints:[],
    freshness:null
  };
}

function schoolContextLane(context,isApplicable){
  if(!isApplicable){
    return {
      status:'NOT_APPLICABLE',
      source_refs:[],
      authority_class:'PLANNING_CONTEXT_ONLY',
      observations:[],
      constraints:['NO_MASTERY_EFFECT'],
      freshness:null
    };
  }
  if(!context||typeof context!=='object'){
    return {
      status:'UNKNOWN',
      source_refs:[],
      authority_class:'PLANNING_CONTEXT_ONLY',
      observations:['CURRENT_LEARNING_CONTEXT_MISSING'],
      constraints:['NO_MASTERY_EFFECT'],
      freshness:null
    };
  }

  const conflicts=Array.isArray(context.conflicts)?context.conflicts:[];
  const gaps=Array.isArray(context.gaps)?context.gaps:[];
  const refs=uniqueStrings([
    context?.school_context?.source_ref,
    context?.school_position_context?.resolved_entry?.id,
    context?.uniclass_context?.source_ref
  ]).map((ref)=>({ref}));

  return {
    status:conflicts.length?'CONFLICT':'RESOLVED',
    source_refs:refs,
    authority_class:'PLANNING_CONTEXT_ONLY',
    observations:[
      ...gaps.map((gap)=>`CONTEXT_GAP:${gap}`),
      ...conflicts.map((conflict)=>`CONTEXT_CONFLICT:${conflict?.kind??'UNKNOWN'}`)
    ],
    constraints:['NO_MASTERY_EFFECT','NO_STRATEGY_AUTHORITY'],
    freshness:context?.uniclass_context?.freshness??null
  };
}

function learnerEvidenceLane(refs,isApplicable){
  const normalized=uniqueStrings(refs);
  if(!isApplicable){
    return {
      status:'NOT_APPLICABLE',
      source_refs:[],
      authority_class:'CANONICAL_LEARNER_EVIDENCE_REF',
      observations:[],
      constraints:['REFERENCE_ONLY'],
      freshness:null
    };
  }
  return {
    status:normalized.length?'RESOLVED':'UNKNOWN',
    source_refs:normalized.map((ref)=>({ref})),
    authority_class:'CANONICAL_LEARNER_EVIDENCE_REF',
    observations:normalized.length?[]:['LEARNER_EVIDENCE_REFS_MISSING'],
    constraints:['REFERENCE_ONLY','NO_EVIDENCE_MUTATION'],
    freshness:null
  };
}

function laneGaps(lanes){
  const gaps=[];
  for(const name of LANE_NAMES){
    const lane=lanes[name];
    if(['UNKNOWN','CONFLICT'].includes(lane.status)) gaps.push(`${name.toUpperCase()}_${lane.status}`);
    for(const observation of lane.observations??[]) gaps.push(`${name.toUpperCase()}:${observation}`);
  }
  return [...new Set(gaps)];
}

function provenanceSummary(lanes){
  return {
    lane_statuses:Object.fromEntries(LANE_NAMES.map((name)=>[name,lanes[name].status])),
    source_ids:Object.fromEntries(LANE_NAMES.map((name)=>[name,sourceIds(lanes[name].source_refs)])),
    resolved_source_count:LANE_NAMES.reduce((count,name)=>count+(lanes[name].source_refs?.length??0),0)
  };
}

export function createSourceFusionService(options={}){
  const sourceResolver=options.sourceResolver??createSourceAuthorityResolver(options);

  function fuse(input={}){
    const subject=String(input.subject??'').trim().toUpperCase()||null;
    const strategyRef=input.strategy_ref??input.strategyRef??null;
    if(!strategyRef||typeof strategyRef!=='object'||Array.isArray(strategyRef)){
      throw new Error('SOURCE_FUSION_STRATEGY_REF_REQUIRED');
    }

    const explicitSourceRefs=input.source_refs??input.sourceRefs??{};
    const curriculumApplicable=applicable(input,'curriculum',Boolean(subject));
    const curriculumResolution=Array.isArray(explicitSourceRefs.curriculum)&&explicitSourceRefs.curriculum.length
      ?sourceResolver.resolveRefs(explicitSourceRefs.curriculum)
      :sourceResolver.curriculumRefsForSubject(subject);

    const ntlRefs=uniqueStrings(explicitSourceRefs.ntl_exam_pattern);
    const referenceRefs=uniqueStrings(explicitSourceRefs.reference);
    const supplementaryRefs=uniqueStrings(explicitSourceRefs.supplementary);

    const lanes={
      curriculum:sourceLane('curriculum',curriculumApplicable,curriculumResolution,'CURRICULUM_AUTHORITY_INPUT'),
      school_context:schoolContextLane(
        input.current_learning_context??input.currentLearningContext,
        applicable(input,'school_context',Boolean(input.current_learning_context??input.currentLearningContext))
      ),
      learner_evidence:learnerEvidenceLane(
        input.learner_evidence_refs??input.learnerEvidenceRefs,
        applicable(input,'learner_evidence',true)
      ),
      ntl_exam_pattern:sourceLane(
        'ntl_exam_pattern',
        applicable(input,'ntl_exam_pattern',ntlRefs.length>0),
        sourceResolver.resolveRefs(ntlRefs),
        'PATTERN_EVIDENCE_ONLY'
      ),
      reference:sourceLane(
        'reference',
        applicable(input,'reference',referenceRefs.length>0),
        sourceResolver.resolveRefs(referenceRefs),
        'REFERENCE_ONLY'
      ),
      supplementary:sourceLane(
        'supplementary',
        applicable(input,'supplementary',supplementaryRefs.length>0),
        sourceResolver.resolveRefs(supplementaryRefs),
        'SUPPLEMENTARY_CONTEXT_ONLY'
      )
    };

    lanes.ntl_exam_pattern.constraints=[
      'PATTERN_EVIDENCE_ONLY',
      'NO_WHOLESALE_PAPER_COPY',
      'NO_CURRICULUM_OVERRIDE'
    ];
    lanes.reference.constraints=[
      'REFERENCE_ONLY',
      'NO_WHOLESALE_REFERENCE_COPY',
      'NO_CURRICULUM_OVERRIDE'
    ];
    lanes.supplementary.constraints=[
      'SUPPLEMENTARY_ONLY',
      'NO_CURRICULUM_OVERRIDE',
      'NO_MASTERY_EFFECT'
    ];
    lanes.curriculum.constraints=['CURRICULUM_AUTHORITY_PRESERVED'];

    const itemFamilyRefs=uniqueStrings(input.item_family_refs??input.itemFamilyRefs);
    const generationConstraints=uniqueStrings([
      ...MANDATORY_CONSTRAINTS,
      ...(input.generation_constraints??input.generationConstraints??[])
    ]);
    const gaps=laneGaps(lanes);
    const core={
      learner_id:input.learner_id??input.learnerId??null,
      subject,
      concept_id:input.concept_id??input.conceptId??null,
      purpose:input.purpose??null,
      strategy_ref:strategyRef,
      lanes,
      item_family_refs:itemFamilyRefs,
      generation_constraints:generationConstraints,
      gaps,
      authority_effect:'NONE',
      material_resolution_authority:'EXISTING_MATERIAL_RESOLVER'
    };
    const sourcePackId=`SFP-${digest(core).slice(0,20)}`;

    return Object.freeze({
      contract_version:'SOURCE_FUSION_PACK/1.0',
      source_pack_id:sourcePackId,
      generated_at:input.generated_at??input.generatedAt??new Date().toISOString(),
      ...core,
      provenance_summary:provenanceSummary(lanes)
    });
  }

  return Object.freeze({fuse});
}

export const SOURCE_FUSION_LANES=LANE_NAMES;
