import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { estimateMinutes } from '../../content/assessments/weekly/compose-weekly-check.mjs';
import { evaluateQuestionEligibility } from '../../core/questions/eligibility.mjs';
import { exactQuestionFingerprint, structuralQuestionSignature } from '../../core/questions/fingerprint.mjs';
import { generateFamilyCandidate } from '../../core/questions/generator.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'..','..');

const BANK_FILES=[
  'content/items/math-decimal-compare.items.json',
  'content/items/vi5-core.items.json',
  'content/items/en5-core.items.json'
];

const FAMILY_FILES=[
  'content/items/math-decimal-compare.families.json',
  'content/items/vi5-core.families.json',
  'content/items/en5-core.families.json'
];

const PURPOSES=new Set(['DIAGNOSTIC','PRACTICE','REPAIR','FRESH_RECHECK','WEEKLY_CHECK','MOCK']);

function req(ok,message) {
  if (!ok) throw new Error(message);
}

function subjectOf(item) {
  const id=String(item?.concept_id??'');
  if (id.startsWith('MATH.')) return 'MATH';
  if (id.startsWith('VI.')) return 'VIETNAMESE';
  if (id.startsWith('EN.')) return 'ENGLISH';
  return 'UNKNOWN';
}

function familyMatchesPurpose(family,purpose) {
  const id=String(family?.family_id??'');
  if (purpose==='DIAGNOSTIC') return family?.purpose==='DIAGNOSTIC'||id.includes('.DIAG');
  if (purpose==='REPAIR') return id.includes('.REPAIR')||family?.purpose==='REPAIR';
  if (purpose==='FRESH_RECHECK') return id.includes('.RECHECK');
  if (purpose==='PRACTICE') return family?.purpose==='PRACTICE'||id.includes('.REPAIR')||id.includes('.RECHECK');
  if (purpose==='MOCK') return !id.includes('.REPAIR');
  return false;
}

function itemMatchesPurpose(item,purpose) {
  const role=String(item?.assessment_role??'');
  const family=String(item?.family_id??'');
  if (purpose==='DIAGNOSTIC') return item?.purpose==='DIAGNOSTIC'||role==='DIAGNOSTIC'||family.includes('.DIAG');
  if (purpose==='REPAIR') return role==='REPAIR_PRACTICE'||family.includes('.REPAIR');
  if (purpose==='FRESH_RECHECK') return role==='FRESH_RECHECK'||family.includes('.RECHECK');
  if (purpose==='PRACTICE') return item?.purpose==='PRACTICE'||role==='REPAIR_PRACTICE'||role==='FRESH_RECHECK';
  if (purpose==='MOCK') return role!=='REPAIR_PRACTICE';
  return false;
}

function validateGeneratedItem(item) {
  const errors=[];
  if (!item?.item_id) errors.push('ITEM_ID_MISSING');
  if (!item?.concept_id) errors.push('CONCEPT_ID_MISSING');
  if (!item?.family_id) errors.push('FAMILY_ID_MISSING');
  if (!item?.rubric_ref||item.rubric_ref==='UNKNOWN') errors.push('RUBRIC_REF_MISSING');
  if (!item?.prompt_or_artifact_ref) errors.push('PROMPT_MISSING');
  if (!item?.answer_or_scoring_ref) errors.push('ANSWER_OR_SCORING_REF_MISSING');
  if (!item?.item_fingerprint) errors.push('FINGERPRINT_MISSING');
  return {valid:errors.length===0,errors};
}

function targetConcepts(request) {
  return new Set(request.target_concepts??[]);
}

function difficultyMatches(item,request) {
  const wanted=request.difficulty_band;
  return !wanted||wanted==='ANY'||item?.difficulty_band===wanted;
}

function stableSort(items) {
  return [...items].sort((a,b)=>
    String(a.concept_id).localeCompare(String(b.concept_id))||
    String(a.family_id).localeCompare(String(b.family_id))||
    String(a.item_id).localeCompare(String(b.item_id))
  );
}

export function loadQuestionAssets(root=ROOT) {
  const items=[];
  const families=[];
  for (const rel of BANK_FILES) {
    const bank=JSON.parse(fs.readFileSync(path.join(root,rel),'utf8'));
    req(Array.isArray(bank.items),`BANK_ITEMS_INVALID:${rel}`);
    for (const item of bank.items) items.push({...item,_bank_ref:rel,_bank_source_basis:bank.source_basis??[]});
  }
  for (const rel of FAMILY_FILES) {
    const catalog=JSON.parse(fs.readFileSync(path.join(root,rel),'utf8'));
    req(Array.isArray(catalog.families),`FAMILY_CATALOG_INVALID:${rel}`);
    for (const family of catalog.families) families.push({...family,_catalog_ref:rel});
  }
  return {items,families};
}

export function buildQuestionPreview(item) {
  const {
    answer_or_scoring_ref,
    _bank_source_basis,
    _bank_ref,
    ...student
  }=item;
  return {
    student_item:student,
    parent_key:{
      item_id:item.item_id,
      concept_id:item.concept_id,
      rubric_ref:item.rubric_ref,
      rubric_version:item.rubric_version??'UNKNOWN',
      answer_or_scoring_ref:answer_or_scoring_ref??null,
      source_ref:_bank_ref??item.provenance_ref??'UNKNOWN'
    }
  };
}

export function selectQuestionsForAssessment(request,options={}) {
  req(PURPOSES.has(request?.purpose),'ASSESSMENT_PURPOSE_INVALID');
  req(request.purpose!=='WEEKLY_CHECK','WEEKLY_CHECK_HANDLED_BY_WEEKLY_COMPOSER');
  req(Array.isArray(request.target_concepts)&&request.target_concepts.length>0,'TARGET_CONCEPTS_REQUIRED');
  req(Number.isInteger(request.max_items)&&request.max_items>0,'MAX_ITEMS_INVALID');

  const root=options.root??ROOT;
  const assets=options.assets??loadQuestionAssets(root);
  const exposures=Array.isArray(options.exposures)?options.exposures:[];
  const exposureKnowledge=options.exposureKnowledge??'KNOWN';
  const asOf=options.asOf??request.requested_at;
  const target=targetConcepts(request);
  const explicitBlocked=new Set(request.parent_constraints?.excluded_item_ids??[]);
  const selected=[];
  const generated=[];
  const exposureChecks=[];
  const validationRefs=[];
  const usedFingerprints=new Set();
  let estimatedMinutes=0;
  const familyById=new Map(assets.families.map((family)=>[family.family_id,family]));

  const candidates=stableSort(assets.items.filter((item)=>
    subjectOf(item)===request.subject &&
    target.has(item.concept_id) &&
    difficultyMatches(item,request) &&
    itemMatchesPurpose(item,request.purpose) &&
    !explicitBlocked.has(item.item_id)
  ));

  for (const item of candidates) {
    if (selected.length>=request.max_items) break;
    const fingerprint=exactQuestionFingerprint(item);
    if (usedFingerprints.has(fingerprint)) continue;
    const family=familyById.get(item.family_id)??null;
    const familySignature=family ? structuralQuestionSignature({},family) : structuralQuestionSignature(item);
    const eligibility=evaluateQuestionEligibility({
      candidate:{...item,family_signature:familySignature},
      purpose:request.purpose,
      exposures,
      exposureKnowledge,
      asOf,
      policy:{sameFamilyCooldownDays:request.parent_constraints?.same_family_cooldown_days??7}
    });
    exposureChecks.push(`${item.item_id}:${eligibility.status}${eligibility.reason_codes.length?':'+eligibility.reason_codes.join(','):''}`);
    if (!eligibility.eligible) continue;
    const minutes=estimateMinutes(item);
    if (estimatedMinutes+minutes>request.time_budget_minutes) {
      validationRefs.push(`${item.item_id}:BLOCKED_TIME_BUDGET`);
      continue;
    }
    selected.push({...item,item_fingerprint:fingerprint,family_signature:familySignature});
    usedFingerprints.add(fingerprint);
    estimatedMinutes+=minutes;
  }

  const shortage=[];
  let remaining=request.max_items-selected.length;
  if (remaining>0) {
    const families=stableSort(assets.families.filter((family)=>
      subjectOf(family)===request.subject &&
      target.has(family.concept_id) &&
      difficultyMatches(family,request) &&
      familyMatchesPurpose(family,request.purpose)
    ));

    const blockedFingerprints=[
      ...assets.items.map(exactQuestionFingerprint),
      ...usedFingerprints,
      ...(request.parent_constraints?.blocked_fingerprints??[])
    ];

    for (const family of families) {
      if (remaining<=0) break;
      for (let ordinal=0;ordinal<remaining;ordinal++) {
        const result=generateFamilyCandidate({
          family,
          seed:`${request.request_id}:${request.learner_id}:${request.purpose}`,
          startIndex:ordinal,
          blockedFingerprints:[...blockedFingerprints,...generated.map((x)=>x.item_fingerprint)],
          maxAttempts:8
        });
        if (result.status!=='GENERATED_CANDIDATE') {
          validationRefs.push(`${family.family_id}:GENERATOR_${result.status}:${result.reason??'UNKNOWN'}`);
          break;
        }
        const item=result.item;
        const validation=validateGeneratedItem(item);
        validationRefs.push(`${item.item_id}:${validation.valid?'VALIDATED':'REJECTED'}${validation.errors.length?':'+validation.errors.join(','):''}`);
        if (!validation.valid) continue;
        const eligibility=evaluateQuestionEligibility({
          candidate:item,
          purpose:request.purpose,
          exposures,
          exposureKnowledge,
          asOf,
          policy:{sameFamilyCooldownDays:request.parent_constraints?.same_family_cooldown_days??7}
        });
        exposureChecks.push(`${item.item_id}:${eligibility.status}${eligibility.reason_codes.length?':'+eligibility.reason_codes.join(','):''}`);
        if (!eligibility.eligible) continue;
        const minutes=estimateMinutes(item);
        if (estimatedMinutes+minutes>request.time_budget_minutes) {
          validationRefs.push(`${item.item_id}:BLOCKED_TIME_BUDGET`);
          continue;
        }
        generated.push(item);
        estimatedMinutes+=minutes;
        remaining--;
        break;
      }
    }
  }

  const total=selected.length+generated.length;
  if (total<request.max_items) {
    shortage.push(`REQUESTED_${request.max_items}_AVAILABLE_${total}`);
  }
  if (total===0) shortage.push('NO_ELIGIBLE_ITEMS');

  return {
    selected,
    generated,
    shortage,
    exposure_checks:exposureChecks,
    validation_refs:validationRefs,
    estimated_minutes:estimatedMinutes
  };
}
