import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadmapSnapshot } from './index.mjs';

const target = {
  contract_version:'NTL6_TARGET_MODEL/1.0',
  target_model_id:'NTL6-2027-TARGET',
  version:'r1',
  unknowns:['OFFICIAL_2027_FORMAT']
};

function concept(subject, id, {
  demo='UNKNOWN',
  transfer='NOT_CHECKED',
  concern='NONE_OBSERVED',
  diagnosis='NO_SUPPORTED_PATTERN',
  need='DIAGNOSE',
  scheduled=need,
  rank=1,
  evidence=[id+'-e1'],
  trend='INSUFFICIENT_COMPARABLE_DATA'
} = {}) {
  return {
    display_name:id,
    state:{
      concept:{subject,concept_id:id},
      demonstration:{status:demo},
      transfer:{status:transfer},
      concern:{status:concern},
      decision_basis:{evidence_ids:evidence}
    },
    trend:{axes:{correctness:{status:trend}}},
    diagnosis:{status:diagnosis,hypothesis:diagnosis === 'REPEATED_PATTERN' ? 'CONCEPT_GAP' : 'UNKNOWN'},
    priority:{rank},
    decision:{need_action:need,scheduled_action:scheduled}
  };
}

function build(concepts, overrides={}) {
  return buildRoadmapSnapshot({
    snapshotId:'road-1',
    learnerId:'learner-demo',
    asOf:'2026-09-18',
    baselineRef:'baseline-v1',
    baselineSubjectStates:{
      MATH:{summary:'Nền Toán ban đầu'},
      VIETNAMESE:{summary:'Nền Tiếng Việt ban đầu'},
      ENGLISH:{summary:'Nền Tiếng Anh ban đầu'}
    },
    targetModel:target,
    concepts,
    policyVersion:'1.0',
    ...overrides
  });
}

test('roadmap always represents Math Vietnamese English and preserves baseline/current distinction', () => {
  const road=build([
    concept('MATH','MATH.FRACTION.COMPARE',{demo:'INDEPENDENT_CONFIRMED',transfer:'CONFIRMED_IN_SCOPE',need:'MAINTAIN',trend:'IMPROVING'}),
    concept('VIETNAMESE','VI.READING.INFERENCE',{demo:'ASSISTED_ONLY',need:'RECHECK'}),
  ]);
  assert.deepEqual(road.subject_states.map((x)=>x.subject),['MATH','VIETNAMESE','ENGLISH']);
  const math=road.subject_states.find((x)=>x.subject==='MATH');
  const vi=road.subject_states.find((x)=>x.subject==='VIETNAMESE');
  const en=road.subject_states.find((x)=>x.subject==='ENGLISH');
  assert.equal(math.start_state,'Nền Toán ban đầu');
  assert.equal(math.evidence_status,'SUFFICIENT');
  assert.equal(math.strategy,'GIU_NHIP');
  assert.equal(vi.evidence_status,'INSUFFICIENT');
  assert.equal(vi.current_state,'CHUA_DU_BANG_CHUNG_DOC_LAP');
  assert.equal(en.evidence_status,'INSUFFICIENT');
  assert.equal(en.current_state,'CHUA_DU_DU_LIEU');
});

test('conflicting evidence remains CONFLICT and is not forced to weak or strong state', () => {
  const road=build([
    concept('MATH','MATH.DECIMAL.COMPARE',{demo:'INDEPENDENT_CONFIRMED',concern:'CONFLICT',diagnosis:'CONFLICT',need:'DIAGNOSE'})
  ]);
  const math=road.subject_states.find((x)=>x.subject==='MATH');
  assert.equal(math.evidence_status,'CONFLICT');
  assert.equal(math.current_state,'DU_LIEU_MAU_THUAN');
  assert.equal(math.main_gap.reason,'CONFLICT');
});

test('roadmap carries no pass probability, mastery score, or aggregate percentage field', () => {
  const road=build([concept('MATH','MATH.X',{demo:'INDEPENDENT_OBSERVED',need:'RECHECK'})]);
  const raw=JSON.stringify(road).toLowerCase();
  for (const banned of ['pass_probability','probability_of_passing','mastery_score','mastery_percentage','readiness_percentage']) {
    assert.equal(raw.includes(banned),false,banned);
  }
});

test('target model revision changes target reference/unknowns but not learner evidence record ids', () => {
  const concepts=[
    concept('MATH','MATH.X',{demo:'INDEPENDENT_OBSERVED',need:'RECHECK',evidence:['ev-1','ev-2']})
  ];
  const r1=build(concepts);
  const target2={...target,version:'r2',unknowns:[]};
  const r2=build(concepts,{targetModel:target2});
  assert.notEqual(r1.target_model_ref,r2.target_model_ref);
  assert.deepEqual(r1.source_record_ids,r2.source_record_ids);
  assert.ok(r1.unknowns.includes('OFFICIAL_2027_FORMAT'));
  assert.equal(r2.unknowns.includes('OFFICIAL_2027_FORMAT'),false);
});

test('journey stage is derived from evidence and never from target status alone', () => {
  const road=build([
    concept('MATH','M1',{demo:'INDEPENDENT_CONFIRMED',transfer:'CONFIRMED_IN_SCOPE',need:'MAINTAIN'}),
    concept('VIETNAMESE','V1',{demo:'INDEPENDENT_CONFIRMED',transfer:'CONFIRMED_IN_SCOPE',need:'MAINTAIN'}),
    concept('ENGLISH','E1',{demo:'INDEPENDENT_CONFIRMED',transfer:'CONFIRMED_IN_SCOPE',need:'MAINTAIN'})
  ]);
  assert.equal(road.journey_stage,'VAN_DUNG');
  assert.ok(road.unknowns.includes('OFFICIAL_2027_FORMAT'));
});
