import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readLedgerRecords } from '../../persistence/ledger/reader.mjs';
import { buildConceptState } from '../../core/state/index.mjs';
import { buildTrendReadModel } from '../../core/trend/index.mjs';
import { buildDiagnosisReadModel } from '../../core/diagnosis/index.mjs';
import { rankConceptPriorities } from '../../core/priority/index.mjs';
import { evaluateWorkloadGuard } from '../../core/workload/index.mjs';
import { buildStrategyDecision } from '../../core/strategy/index.mjs';
import { buildRoadmapSnapshot } from '../../core/roadmap/index.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT=path.resolve(HERE,'..','..');

function subjectOf(conceptId) {
  const id=String(conceptId);
  if (id.startsWith('MATH.')||id.startsWith('MATH4.')) return 'MATH';
  if (id.startsWith('VI.')||id.startsWith('VI4.')) return 'VIETNAMESE';
  if (id.startsWith('EN.')||id.startsWith('EN4.')) return 'ENGLISH';
  return 'UNKNOWN';
}

function correctionState(rows) {
  const states=new Map();
  for (const row of rows) {
    if (row.record_type!=='LEDGER_CORRECTION') continue;
    const c=row.payload??{};
    if (!c.target_record_id) continue;
    if (c.action==='RELEASE_HOLD') states.delete(c.target_record_id);
    else states.set(c.target_record_id,c.action);
  }
  return states;
}

function acceptedRows(rows) {
  const corrections=correctionState(rows);
  return rows.filter((row)=>{
    const state=corrections.get(row.record_id);
    return !['HOLD','RETRACT','SUPERSEDE'].includes(state);
  });
}

function pairEvidence(rows) {
  const active=acceptedRows(rows);
  const eligibility=new Map(active.filter((r)=>r.record_type==='EVIDENCE_ELIGIBILITY').map((r)=>[r.payload?.evidence_id,r.payload]));
  return active
    .filter((r)=>r.record_type==='EVIDENCE_OPPORTUNITY')
    .map((r)=>({evidence:r.payload,eligibility:eligibility.get(r.payload?.evidence_id)??null}))
    .filter((r)=>r.evidence&&r.eligibility);
}

function workload(asOf, policyVersion, context={}) {
  return evaluateWorkloadGuard({
    guardId:`guard-parent-console-${String(asOf).replace(/[^0-9]/g,'').slice(0,14)}`,
    asOf,
    policyVersion,
    dayType:context.day_type??'WEEKDAY',
    readiness:context.readiness??'UNKNOWN',
    externalLoad:context.external_load??'UNKNOWN',
    scheduleKnown:context.schedule_known===true,
    unusualLoad:context.unusual_load??'UNKNOWN',
    supplementalEventsToday:Array.isArray(context.supplemental_events_today)?context.supplemental_events_today:[],
    missedPriorMinutes:Number.isFinite(context.missed_prior_minutes)?context.missed_prior_minutes:0
  });
}

function conceptFromEvidence(evidence) {
  const t=evidence.target??{};
  return {
    concept_id:t.concept_id,
    concept_version:t.concept_version??'1.0',
    subject:subjectOf(t.concept_id),
    scope:t.scope??t.concept_id??'UNKNOWN',
    rubric_ref:t.rubric_ref??'UNKNOWN',
    prerequisite_ids:[]
  };
}

export function buildCurrentLearningModels(options={}) {
  const root=path.resolve(options.root??DEFAULT_ROOT);
  const ledgerPath=path.join(root,'runtime-data','ledger','evidence.jsonl');
  const outcomePath=path.join(root,'runtime-data','ledger','outcomes.jsonl');
  const rows=fs.existsSync(ledgerPath)?readLedgerRecords(ledgerPath):[];
  const outcomeRows=fs.existsSync(outcomePath)?readLedgerRecords(outcomePath):[];
  const latestOutcomeByConcept=new Map();
  for(const row of outcomeRows){
    if(row.record_type!=='STRATEGY_OUTCOME'||row.payload?.learner_id!==options.learnerId) continue;
    latestOutcomeByConcept.set(row.payload.concept_id,row.payload);
  }
  const paired=pairEvidence(rows).filter((r)=>r.evidence?.learner_id===options.learnerId);
  const asOf=options.asOf??new Date().toISOString();
  const policyVersion=options.policyVersion??paired.at(-1)?.eligibility?.policy_version??'PARENT_CONSOLE_R1';
  const concepts=new Map();
  for (const record of paired) {
    const c=conceptFromEvidence(record.evidence);
    if (!c.concept_id||c.subject==='UNKNOWN') continue;
    concepts.set(`${c.concept_id}@@${c.concept_version}`,c);
  }

  const base=[];
  for (const concept of concepts.values()) {
    const records=paired.filter((r)=>r.evidence?.target?.concept_id===concept.concept_id&&r.evidence?.target?.concept_version===concept.concept_version);
    const token=concept.concept_id.replace(/[^A-Za-z0-9._-]+/g,'-');
    const state=buildConceptState({
      learnerId:options.learnerId,concept,records,
      snapshotId:`pc-${token}`,asOf,policyVersion,
      conflictIds:[],retentionCheckPending:false,interveningPractice:'UNKNOWN'
    });
    const trend=buildTrendReadModel({
      trendId:`pc-trend-${token}`,learnerId:options.learnerId,concept,records,conceptState:state,asOf,policyVersion
    });
    const diagnosis=buildDiagnosisReadModel({
      diagnosisId:`pc-diag-${token}`,learnerId:options.learnerId,concept,records,asOf,policyVersion
    });
    base.push({concept,state,trend,diagnosis,records,meta:{}});
  }

  const ranked=rankConceptPriorities({
    prioritySetId:`pc-priority-${options.learnerId}`,
    asOf,policyVersion,
    candidates:base.map((x)=>({concept:x.concept,state:x.state,trend:x.trend,diagnosis:x.diagnosis,meta:x.meta}))
  });
  const priorityById=new Map(ranked.ranked.map((p)=>[`${p.concept_id}@@${p.concept_version}`,p]));
  const load=workload(asOf,policyVersion,options.workloadContext);

  return base.map((x)=>{
    const key=`${x.concept.concept_id}@@${x.concept.concept_version}`;
    const priority=priorityById.get(key);
    const decision=buildStrategyDecision({
      decisionId:`pc-decision-${x.concept.concept_id.replace(/[^A-Za-z0-9._-]+/g,'-')}`,
      learnerId:options.learnerId,
      concept:x.concept,
      state:x.state,
      diagnosis:x.diagnosis,
      priority,
      workload:load,
      policyVersion,
      authorityScopeRef:`parent-console://derived/${x.concept.concept_id}`,
      createdAt:asOf
    });
    const outcome=latestOutcomeByConcept.get(x.concept.concept_id)??null;
    const fuse=outcome?.third_repeat_fuse;
    const strategy_review=outcome ? {
      change_required:fuse?.automatic_repeat_allowed===false,
      next_required_action:fuse?.next_required_action??'NONE',
      outcome_status:outcome.status,
      outcome_id:outcome.outcome_id
    } : null;
    return {...x,priority,decision,strategy_review,display_name:x.concept.concept_id};
  });
}

export function buildCurrentRoadmap(options={}) {
  const models=buildCurrentLearningModels(options);
  return buildRoadmapSnapshot({
    snapshotId:options.snapshotId??`roadmap-${options.learnerId}-${String(options.asOf??new Date().toISOString()).replace(/[^0-9]/g,'').slice(0,14)}`,
    learnerId:options.learnerId,
    asOf:options.asOf??new Date().toISOString(),
    baselineRef:options.baselineRef??'UNKNOWN',
    baselineSubjectStates:options.baselineSubjectStates??{},
    targetModel:options.targetModel,
    concepts:models,
    policyVersion:options.policyVersion??'PARENT_CONSOLE_R1',
    milestoneContext:options.milestoneContext??{}
  });
}
