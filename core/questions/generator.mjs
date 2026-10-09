import crypto from 'node:crypto';
import { exactQuestionFingerprint, structuralQuestionSignature } from './fingerprint.mjs';

function seedInt(seed) {
  return parseInt(crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0,12),16);
}
function pick(seed,mod,offset=0) { return offset + (seedInt(seed)%mod); }
function decimal(value) { return String(value).replace('.',','); }
function relation(a,b) { return a===b ? '=' : a<b ? '<' : '>'; }

function rubricFromFamily(family) {
  const hit=(family.source_basis??[]).find((x)=>String(x).startsWith('RUBRIC.'));
  if (!hit) return {ref:'UNKNOWN',version:'UNKNOWN'};
  const [ref,version='UNKNOWN']=String(hit).split('@');
  return {ref,version};
}

function generateDecimalCompare(family,seed,index) {
  const token=`${seed}:${family.family_id}:${index}`;
  let left,right;
  if (family.family_id.includes('.ZERO')) {
    const whole=pick(token+':whole',8,1);
    const digit=pick(token+':digit',9,1);
    left=Number(`${whole}.${digit}`);
    right=left;
    const leftText=`${whole},${digit}`;
    const rightText=`${whole},${digit}0`;
    return {left,leftText,right,rightText};
  }
  if (family.family_id.includes('.INTEGER')) {
    const whole=pick(token+':whole',7,2);
    const frac=pick(token+':frac',80,10);
    left=Number(`${whole}.${frac}`);
    right=Number(`${whole+1}.${pick(token+':frac2',80,10)}`);
  } else {
    const whole=pick(token+':whole',8,1);
    const a=pick(token+':a',890,105);
    let b=pick(token+':b',890,105);
    if (b===a) b=(b+37)%890+105;
    left=Number(`${whole}.${a}`);
    right=Number(`${whole}.${b}`);
  }
  return {left,leftText:decimal(left),right,rightText:decimal(right)};
}

function generateDecimalOrder(family,seed,index) {
  const token=`${seed}:${family.family_id}:${index}`;
  const whole=pick(token+':whole',7,1);
  const raw=[pick(token+':a',90,5),pick(token+':b',90,5),pick(token+':c',90,5),pick(token+':d',90,5)];
  const values=raw.map((x,i)=>Number(`${whole}.${x+i*101}`));
  return [...new Set(values)].slice(0,4);
}

export function generateFamilyCandidateOnce({family,seed='ntl6',index=0}) {
  if (!family?.family_id || !family?.concept_id) return {status:'UNSUPPORTED_FAMILY',reason:'MISSING_FAMILY_ID_OR_CONCEPT'};
  const rubric=rubricFromFamily(family);
  const base={
    family_id:family.family_id,
    concept_id:family.concept_id,
    concept_version:family.concept_version ?? 'UNKNOWN',
    rubric_ref:rubric.ref,
    rubric_version:rubric.version,
    purpose:family.purpose ?? 'PRACTICE',
    difficulty_band:family.difficulty_band ?? 'UNKNOWN',
    source_kind:'ORIGINAL_GENERATED',
    provenance_ref:'PC-T3-DETERMINISTIC-FAMILY-GENERATOR/1.0',
    generation_policy_version:'PC-T3-1.0',
    review_status:'GENERATED_CANDIDATE',
    copyright_handling:'ORIGINAL_GENERATED',
    family_signature:structuralQuestionSignature({},family)
  };

  let item;
  if (family.concept_id==='MATH.DECIMAL.COMPARE' && family.representation==='SYMBOL_RELATION') {
    const x=generateDecimalCompare(family,seed,index);
    item={
      ...base,
      item_id:`GEN-${crypto.createHash('sha256').update(`${family.family_id}:${seed}:${index}`).digest('hex').slice(0,16)}`,
      prompt_or_artifact_ref:`Điền dấu <, > hoặc = thích hợp: ${x.leftText} ? ${x.rightText}`,
      response_format:'RELATION_SYMBOL',
      answer_or_scoring_ref:{type:'DECIMAL_COMPARE',left:String(x.left),right:String(x.right),relation:relation(x.left,x.right)}
    };
  } else if (family.concept_id==='MATH.DECIMAL.ORDER' && family.representation==='ORDERED_SEQUENCE') {
    const values=generateDecimalOrder(family,seed,index);
    if (values.length<4) return {status:'UNSUPPORTED_FAMILY',reason:'FAILED_TO_BUILD_DISTINCT_ORDER_VALUES'};
    const sequence=[...values].sort((a,b)=>a-b);
    item={
      ...base,
      item_id:`GEN-${crypto.createHash('sha256').update(`${family.family_id}:${seed}:${index}`).digest('hex').slice(0,16)}`,
      prompt_or_artifact_ref:`Sắp xếp các số sau theo thứ tự tăng dần: ${values.map(decimal).join('; ')}`,
      response_format:'ORDERED_SEQUENCE',
      answer_or_scoring_ref:{type:'DECIMAL_ORDER',values:values.map(String),direction:'ASC',sequence:sequence.map(String)}
    };
  } else {
    return {status:'UNSUPPORTED_FAMILY',reason:'NO_DETERMINISTIC_TEMPLATE_FOR_FAMILY'};
  }

  item.item_fingerprint=exactQuestionFingerprint(item);
  return {status:'GENERATED_CANDIDATE',item};
}

export function generateFamilyCandidate({family,seed='ntl6',startIndex=0,blockedFingerprints=[],maxAttempts=8}) {
  const blocked=new Set(blockedFingerprints);
  for (let offset=0;offset<maxAttempts;offset++) {
    const result=generateFamilyCandidateOnce({family,seed,index:startIndex+offset});
    if (result.status!=='GENERATED_CANDIDATE') return result;
    if (!blocked.has(result.item.item_fingerprint)) return {...result,attempt_index:startIndex+offset};
  }
  return {status:'SHORTAGE',reason:'ALL_GENERATED_CANDIDATES_BLOCKED_BY_FINGERPRINT',attempts:maxAttempts};
}
