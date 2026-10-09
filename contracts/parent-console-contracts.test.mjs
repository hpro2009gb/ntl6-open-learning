import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSchemaSubset } from './validate-json-schema-subset.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(fs.readFileSync(path.join(HERE, name), 'utf8'));

const fixtures = {
  'parent-dashboard.schema.json': {
    contract_version:'PARENT_DASHBOARD/1.0', learner_id:'learner-demo', as_of:'2026-09-18', goal:'Đỗ NTL6 2027',
    journey_stage:'XAY_NEN', target_model:{version:'r1',status:'PROVISIONAL'},
    subjects:['MATH','VIETNAMESE','ENGLISH'].map((subject) => ({
      subject,start_state:'Chưa đủ dữ liệu',current_state:'Đang đánh giá',achievements:[],main_gap:'UNKNOWN',
      trend:'UNKNOWN',strategy:'GIỮ NHỊP',next_action:'Chẩn đoán',evidence_status:'INSUFFICIENT'
    })),
    priority_action:{},warnings:[]
  },
  'assessment-request.schema.json': {
    contract_version:'ASSESSMENT_REQUEST/1.0',request_id:'req-1',learner_id:'learner-demo',subject:'MATH',
    target_concepts:['MATH.DECIMAL.COMPARE'],purpose:'FRESH_RECHECK',max_items:5,time_budget_minutes:20,
    difficulty_band:'MEDIUM',requested_at:'2026-09-18T12:00:00+07:00',parent_constraints:{}
  },
  'assessment-candidate.schema.json': {
    contract_version:'ASSESSMENT_CANDIDATE/1.0',assessment_id:'a-1',request_ref:'req-1',selected_items:['i-1'],
    generated_items:[],shortage:[],exposure_checks:['exp-check-1'],validation_refs:['val-1'],estimated_minutes:10,status:'PARENT_PREVIEW'
  },
  'question-exposure.schema.json': {
    contract_version:'QUESTION_EXPOSURE/1.0',exposure_id:'exp-1',learner_id:'learner-demo',assessment_id:'a-1',
    item_id:'i-1',family_signature:'fam-1',purpose:'FRESH_RECHECK',exposure_type:'ASSIGNED_TO_LEARNER',
    help_level:'NONE_OBSERVED',answer_exposure:'NONE_OBSERVED',occurred_at:'2026-09-18T12:00:00+07:00',source_ref:'assessment:a-1'
  },
  'question-lifecycle-event.schema.json': {
    contract_version:'QUESTION_LIFECYCLE_EVENT/1.0',event_id:'qev-1',item_id:'i-1',previous_state:'NONE',
    new_state:'GENERATED_CANDIDATE',actor:'SYSTEM',validation_refs:[],reason:'generated',occurred_at:'2026-09-18T12:00:00+07:00',
    item_fingerprint:'sha256:abc',family_signature:'fam-1'
  },
  'roadmap-snapshot.schema.json': {
    contract_version:'ROADMAP_SNAPSHOT/1.0',snapshot_id:'road-1',learner_id:'learner-demo',as_of:'2026-09-18',
    baseline_ref:'baseline-1',target_model_ref:'target-r1',journey_stage:'XAY_NEN',subject_states:[],gaps:[],
    achievements:[],strategy_summary:[],unknowns:['NTL6_2027_OFFICIAL_FORMAT'],source_record_ids:[],policy_version:'1.0'
  },
  'target-model.schema.json': {
    contract_version:'NTL6_TARGET_MODEL/1.0',target_model_id:'ntl6-target',version:'r1',as_of:'2026-09-18',
    target_school:'Sample Middle School',target_year:'2027',status:'PROVISIONAL',official_facts:[],
    historical_pattern_evidence:[],subject_requirements:[],skill_item_family_matrix:[],
    unknowns:['OFFICIAL_2027_FORMAT'],source_refs:['NTL-OFFICIAL-2026-EVENT'],authority_ceiling:'PROVISIONAL'
  }
};

for (const [name, fixture] of Object.entries(fixtures)) {
  test(`${name} accepts representative valid fixture and rejects missing required field`, () => {
    const schema = load(name);
    assert.deepEqual(validateSchemaSubset(schema, fixture), []);
    const invalid = structuredClone(fixture);
    delete invalid.contract_version;
    assert.ok(validateSchemaSubset(schema, invalid).length > 0);
  });
}

test('contracts manifest registers all Parent Console contracts', () => {
  const manifest = load('manifest.json');
  const ids = new Set(manifest.contracts.map((x) => x.id));
  for (const id of ['PARENT_DASHBOARD/1.0','ASSESSMENT_REQUEST/1.0','ASSESSMENT_CANDIDATE/1.0','QUESTION_EXPOSURE/1.0','QUESTION_LIFECYCLE_EVENT/1.0','ROADMAP_SNAPSHOT/1.0','NTL6_TARGET_MODEL/1.0']) {
    assert.ok(ids.has(id), `missing ${id}`);
  }
});
