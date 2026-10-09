import path from 'node:path';

import { createMaterialReadModel } from './assessment-history-service.mjs';
import { buildCurrentLearningModels } from './roadmap-service.mjs';

const ACTION_PROFILES=Object.freeze({
  RETEACH:Object.freeze({purposes:['RETEACH','TEACH'],kinds:['LESSON']}),
  REPAIR:Object.freeze({purposes:['REPAIR'],kinds:['PRACTICE']}),
  RECHECK:Object.freeze({purposes:['FRESH_RECHECK'],kinds:['TEST']}),
  DIAGNOSE:Object.freeze({purposes:['DIAGNOSTIC'],kinds:['TEST']}),
  MAINTAIN:Object.freeze({purposes:['PRACTICE'],kinds:['PRACTICE']})
});

const ACTIVE_STATES=new Set(['NEEDS_TEACHING','READY_FOR_LEARNER']);
const COMPLETED_STATES=new Set(['COMPLETED']);

function normalizeSubject(value){
  const s=String(value??'').trim().toUpperCase();
  return s||null;
}
function normalizeAction(value){
  const s=String(value??'').trim().toUpperCase();
  return s||null;
}
function canonicalRefFor(row){
  return row?.artifacts?.find((x)=>x.exists)?.ref??row?.artifacts?.[0]?.ref??null;
}
function visibleArtifacts(row){
  return (row?.artifacts??[]).filter((x)=>x.audience!=='SYSTEM'&&x.kind!=='SYSTEM');
}
function priorityRank(model){
  const rank=Number(model?.priority?.rank);
  return Number.isFinite(rank)?rank:Number.MAX_SAFE_INTEGER;
}
function stableModelKey(model){
  return String(model?.concept?.concept_id??model?.decision?.concept_id??'');
}
function selectStrategyModel(models,{subject=null}={}){
  const wanted=normalizeSubject(subject);
  const candidates=(models??[]).filter((model)=>{
    const modelSubject=normalizeSubject(model?.concept?.subject);
    return !wanted||modelSubject===wanted;
  });
  if(!candidates.length) return null;
  return [...candidates].sort((a,b)=>priorityRank(a)-priorityRank(b)||stableModelKey(a).localeCompare(stableModelKey(b)))[0];
}
function matchesProfile(row,profile){
  if(!row||!profile) return false;
  const purpose=String(row.purpose??'').toUpperCase();
  const kind=String(row.activity_kind??'').toUpperCase();
  return profile.purposes.includes(purpose)&&profile.kinds.includes(kind);
}
function rowSupportsConcept(row,conceptId){
  if(!conceptId) return true;
  return (row?.concept_ids??[]).includes(conceptId);
}
function rowSupportsSubject(row,subject){
  if(!subject) return true;
  const rowSubject=normalizeSubject(row?.subject);
  const wanted=normalizeSubject(subject);
  return rowSubject===wanted||rowSubject==='MULTI';
}
function rowIsApprovedLesson(row){
  return String(row?.activity_kind??'').toUpperCase()==='LESSON'&&String(row?.lesson_approval?.status??'').toUpperCase()==='APPROVED';
}
function removeSuperseded(rows){
  const superseded=new Set();
  for(const row of rows){
    for(const id of row?.relationships?.supersedes??[]) superseded.add(id);
  }
  return rows.filter((row)=>!superseded.has(row.assessment_id));
}
function dependencyBlock(row,materialReadModel){
  const blockers=[];
  for(const id of row?.relationships?.depends_on??[]){
    const dep=materialReadModel.list({assessment_id:id})[0];
    if(!dep){
      blockers.push({assessment_id:id,state:'MISSING'});
      continue;
    }
    if(!COMPLETED_STATES.has(String(dep.derived_workflow_state).toUpperCase())){
      blockers.push({assessment_id:id,state:dep.derived_workflow_state});
    }
  }
  return blockers;
}
function result(kind,payload={}){
  return Object.freeze({contract_version:'MATERIAL_RESOLUTION/1.0',kind,...payload});
}

export function createMaterialResolver(options={}){
  const root=path.resolve(options.root??process.cwd());
  const materialReadModel=options.materialReadModel??createMaterialReadModel({root});
  const currentModelsProvider=options.currentModelsProvider??((input)=>buildCurrentLearningModels({
    root,
    learnerId:input.learner_id??input.learnerId??'default-learner',
    asOf:input.as_of??input.asOf??new Date().toISOString(),
    policyVersion:input.policy_version??input.policyVersion??'PARENT_CONSOLE_R1',
    workloadContext:input.workload_context??input.workloadContext
  }));

  function searchMaterials(query={}){
    return materialReadModel.list(query);
  }

  function resolveApprovedLessonArtifact(row,input={}){
    const approvedRef=row?.lesson_approval?.artifact_ref??null;
    if(!approvedRef){
      return result('MATERIAL_MISSING',{reason:'APPROVED_LESSON_ARTIFACT_REF_REQUIRED',material:row,expected_ref:null});
    }
    const requestedRef=input.artifact_ref??input.artifactRef??null;
    if(requestedRef&&requestedRef!==approvedRef){
      return result('BLOCKED',{
        reason:'APPROVED_LESSON_ARTIFACT_REF_MISMATCH',
        material:row,
        approved_ref:approvedRef,
        requested_ref:requestedRef
      });
    }
    const matches=(row?.artifacts??[]).filter((artifact)=>artifact?.ref===approvedRef||artifact?.artifact_id===approvedRef);
    if(matches.length===0){
      return result('MATERIAL_MISSING',{reason:'APPROVED_LESSON_ARTIFACT_NOT_FOUND',material:row,expected_ref:approvedRef});
    }
    if(matches.length>1){
      return result('AMBIGUOUS',{reason:'APPROVED_LESSON_ARTIFACT_AMBIGUOUS',material:row,approved_ref:approvedRef,candidates:matches});
    }
    const artifact=matches[0];
    if(!artifact.exists){
      return result('MATERIAL_MISSING',{reason:'APPROVED_LESSON_ARTIFACT_MISSING',material:row,expected_ref:approvedRef,artifact});
    }
    return result('EXACT',{material:row,artifact});
  }

  function resolveMaterialByIdentity(input={}){
    const assessmentId=input.assessment_id??input.assessmentId;
    if(!assessmentId) return result('NOT_FOUND',{reason:'ASSESSMENT_ID_REQUIRED'});
    const row=materialReadModel.list({assessment_id:assessmentId})[0];
    if(!row) return result('NOT_FOUND',{reason:'ASSESSMENT_NOT_FOUND',assessment_id:assessmentId});

    const requestedRef=input.artifact_ref??input.artifactRef??null;
    if(requestedRef){
      const artifact=(row.artifacts??[]).find((x)=>x.ref===requestedRef||x.artifact_id===requestedRef);
      if(!artifact) return result('NOT_FOUND',{reason:'ARTIFACT_NOT_FOUND',assessment_id:row.assessment_id,artifact_ref:requestedRef});
      if(!artifact.exists) return result('MATERIAL_MISSING',{material:row,expected_ref:artifact.ref,artifact});
      return result('EXACT',{material:row,artifact});
    }

    const artifacts=visibleArtifacts(row);
    if(artifacts.length===1){
      const artifact=artifacts[0];
      if(!artifact.exists) return result('MATERIAL_MISSING',{material:row,expected_ref:artifact.ref,artifact});
      return result('EXACT',{material:row,artifact});
    }
    if(artifacts.length>1) return result('AMBIGUOUS',{reason:'MULTIPLE_USER_ARTIFACTS',material:row,candidates:artifacts});
    if(row.derived_workflow_state==='MATERIAL_MISSING'){
      return result('MATERIAL_MISSING',{material:row,expected_ref:canonicalRefFor(row)});
    }
    return result('EXACT',{material:row,artifact:null});
  }

  function resolveCurrentMaterial(input={}){
    const models=input.current_models??input.currentModels??currentModelsProvider(input);
    const model=selectStrategyModel(models,{subject:input.subject});
    if(!model) return result('NOT_FOUND',{reason:'NO_STRATEGY_DECISION',subject:normalizeSubject(input.subject)});

    const decision=model.decision??{};
    const scheduledAction=normalizeAction(decision.scheduled_action??decision.need_action);
    const needAction=normalizeAction(decision.need_action);
    const subject=normalizeSubject(model?.concept?.subject??input.subject);
    const conceptId=model?.concept?.concept_id??decision.concept_id??null;
    const strategyRef={
      decision_id:decision.decision_id??null,
      concept_id:conceptId,
      subject,
      need_action:needAction,
      scheduled_action:scheduledAction,
      priority_rank:priorityRank(model),
      authority_scope_ref:decision.authority_scope_ref??null
    };

    if(scheduledAction==='PAUSE'){
      return result('BLOCKED',{reason:'STRATEGY_SCHEDULED_PAUSE',strategy_ref:strategyRef});
    }

    const profile=ACTION_PROFILES[scheduledAction];
    if(!profile){
      return result('NOT_FOUND',{reason:`NO_MATERIAL_PROFILE_FOR_ACTION:${scheduledAction??'UNKNOWN'}`,strategy_ref:strategyRef});
    }

    let candidates=materialReadModel.list({concept_id:conceptId}).filter((row)=>
      rowSupportsConcept(row,conceptId)&&
      rowSupportsSubject(row,subject)&&
      matchesProfile(row,profile)&&
      !COMPLETED_STATES.has(String(row.derived_workflow_state).toUpperCase())
    );
    candidates=removeSuperseded(candidates);

    if(!candidates.length){
      return result('NOT_FOUND',{
        reason:'NO_MATCHING_MATERIAL',
        strategy_ref:strategyRef,
        required_profile:{action:scheduledAction,purposes:profile.purposes,kinds:profile.kinds}
      });
    }

    const missing=candidates.filter((row)=>row.derived_workflow_state==='MATERIAL_MISSING');
    const active=candidates.filter((row)=>ACTIVE_STATES.has(String(row.derived_workflow_state).toUpperCase()));

    if(active.length===0&&missing.length===1){
      const row=missing[0];
      return result('MATERIAL_MISSING',{material:row,expected_ref:canonicalRefFor(row),strategy_ref:strategyRef});
    }

    const eligible=active.length?active:candidates.filter((row)=>row.derived_workflow_state!=='MATERIAL_MISSING');
    const unblocked=[];
    const blocked=[];
    for(const row of eligible){
      const blockers=dependencyBlock(row,materialReadModel);
      if(blockers.length) blocked.push({material:row,blockers});
      else unblocked.push(row);
    }

    if(unblocked.length===1){
      const row=unblocked[0];
      const artifacts=visibleArtifacts(row).filter((x)=>x.exists);
      const artifact=artifacts.length===1?artifacts[0]:null;
      return result('EXACT',{material:row,artifact,strategy_ref:strategyRef});
    }
    if(unblocked.length>1){
      return result('AMBIGUOUS',{
        reason:'MULTIPLE_MATCHING_CURRENT_MATERIALS',
        candidates:unblocked,
        strategy_ref:strategyRef
      });
    }
    if(blocked.length){
      return result('BLOCKED',{
        reason:'MATERIAL_DEPENDENCY_NOT_COMPLETED',
        candidates:blocked,
        strategy_ref:strategyRef
      });
    }
    if(missing.length){
      if(missing.length===1){
        const row=missing[0];
        return result('MATERIAL_MISSING',{material:row,expected_ref:canonicalRefFor(row),strategy_ref:strategyRef});
      }
      return result('AMBIGUOUS',{reason:'MULTIPLE_MISSING_MATCHES',candidates:missing,strategy_ref:strategyRef});
    }

    return result('NOT_FOUND',{reason:'NO_ACTIONABLE_MATCHING_MATERIAL',strategy_ref:strategyRef});
  }

  function resolveApprovedLesson(input={}){
    const assessmentId=input.assessment_id??input.assessmentId??null;
    if(assessmentId){
      const row=materialReadModel.list({assessment_id:assessmentId})[0];
      if(!row) return result('NOT_FOUND',{reason:'ASSESSMENT_NOT_FOUND',assessment_id:assessmentId});
      if(String(row?.activity_kind??'').toUpperCase()!=='LESSON') return result('BLOCKED',{reason:'NOT_LESSON_MATERIAL',material:row});
      if(!rowIsApprovedLesson(row)) return result('BLOCKED',{reason:'LESSON_NOT_APPROVED',material:row});
      if(COMPLETED_STATES.has(String(row?.derived_workflow_state??'').toUpperCase())) return result('BLOCKED',{reason:'LESSON_ALREADY_COMPLETED',material:row});
      return resolveApprovedLessonArtifact(row,input);
    }

    const conceptId=input.concept_id??input.conceptId??null;
    if(conceptId){
      let rows=materialReadModel.list({concept_id:conceptId}).filter((row)=>
        rowIsApprovedLesson(row)&&
        rowSupportsSubject(row,input.subject)&&
        rowSupportsConcept(row,conceptId)&&
        !COMPLETED_STATES.has(String(row.derived_workflow_state).toUpperCase())
      );
      rows=removeSuperseded(rows);
      const active=rows.filter((row)=>ACTIVE_STATES.has(String(row.derived_workflow_state).toUpperCase()));
      const candidates=active.length?active:rows;
      if(candidates.length===0) return result('NOT_FOUND',{reason:'NO_APPROVED_MATCHING_LESSON',concept_id:conceptId,subject:normalizeSubject(input.subject)});
      if(candidates.length>1) return result('AMBIGUOUS',{reason:'MULTIPLE_APPROVED_LESSONS',candidates});
      const row=candidates[0];
      const blockers=dependencyBlock(row,materialReadModel);
      if(blockers.length) return result('BLOCKED',{reason:'MATERIAL_DEPENDENCY_NOT_COMPLETED',material:row,blockers});
      return resolveApprovedLessonArtifact(row,input);
    }

    let rows=materialReadModel.list({subject:normalizeSubject(input.subject)}).filter((row)=>
      rowIsApprovedLesson(row)&&
      rowSupportsSubject(row,input.subject)&&
      !COMPLETED_STATES.has(String(row.derived_workflow_state).toUpperCase())
    );
    rows=removeSuperseded(rows);
    const active=rows.filter((row)=>ACTIVE_STATES.has(String(row.derived_workflow_state).toUpperCase()));
    const candidates=active.length?active:rows;
    if(candidates.length===1){
      const row=candidates[0];
      const blockers=dependencyBlock(row,materialReadModel);
      if(blockers.length) return result('BLOCKED',{reason:'MATERIAL_DEPENDENCY_NOT_COMPLETED',material:row,blockers});
      return resolveApprovedLessonArtifact(row,input);
    }
    if(candidates.length>1) return result('AMBIGUOUS',{reason:'MULTIPLE_APPROVED_LESSONS',candidates});
    return result('NOT_FOUND',{reason:'NO_APPROVED_MATCHING_LESSON',subject:normalizeSubject(input.subject)});
  }

  return Object.freeze({
    searchMaterials,
    resolveCurrentMaterial,
    resolveApprovedLesson,
    resolveMaterialByIdentity
  });
}

export const MATERIAL_ACTION_PROFILES=ACTION_PROFILES;
