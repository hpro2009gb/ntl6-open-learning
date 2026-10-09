import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParentViewModel } from './view-model.mjs';
import { renderParentViewHtml } from './render.mjs';

function state(id, overrides = {}) {
  return {
    state_id: `state-${id}`,
    concept: { concept_id: id, subject: 'MATH', scope: id, rubric_ref: 'rubric-main' },
    demonstration: { status: 'INDEPENDENT_CONFIRMED' },
    transfer: { status: 'CONFIRMED_IN_SCOPE' },
    retention: { status: 'NOT_CHECKED' },
    concern: { status: 'NONE_OBSERVED' },
    decision_basis: { evidence_ids: [`${id}-e1`, `${id}-e2`] },
    ...overrides
  };
}

function diagnosis(id, overrides = {}) {
  return {
    diagnosis_id: `diag-${id}`,
    status: 'NO_SUPPORTED_PATTERN',
    hypothesis: 'UNKNOWN',
    ...overrides
  };
}

function priority(id, rank, overrides = {}) {
  return {
    concept_id: id,
    rank,
    reasons: ['NO_SPECIAL_PRIORITY_SIGNAL'],
    flags: { prerequisite_blocker: false, retention_due: false, verification_due: false },
    ...overrides
  };
}

function decision(id, need, scheduled = need, minutes = 15) {
  return {
    decision_id: `decision-${id}`,
    concept_id: id,
    need_action: need,
    scheduled_action: scheduled,
    dose: { class: scheduled === 'PAUSE' ? 'REST' : 'NORMAL', minutes: scheduled === 'PAUSE' ? 0 : minutes },
    why: 'internal decision why'
  };
}

function sampleInput() {
  return {
    asOf: '2026-09-18T08:00:00+07:00',
    workload: {
      capacity_band: 'MICRO',
      remaining_minutes: 8,
      why: ['Tải học bắt buộc hôm nay cao nên phần bổ trợ cần nhẹ.']
    },
    concepts: [
      {
        display_name: 'Chuyển động gặp nhau',
        state: state('MATH.MOTION', { demonstration: { status: 'ASSISTED_ONLY' }, transfer: { status: 'NOT_CHECKED' }, concern: { status: 'REPEATED_PATTERN' } }),
        diagnosis: diagnosis('MATH.MOTION', { status: 'REPEATED_PATTERN', hypothesis: 'CONCEPT_GAP' }),
        priority: priority('MATH.MOTION', 1, { reasons: ['REPEATED_SUPPORTED_WEAKNESS'], flags: { prerequisite_blocker: false, retention_due: false, verification_due: false } }),
        trend: { axes: { correctness: { status: 'STABLE' }, support: { status: 'DECREASING_SUPPORT' }, independence: { status: 'MORE_INDEPENDENT_EVIDENCE' } } },
        decision: decision('MATH.MOTION', 'RETEACH', 'PAUSE'),
        outcome: { status: 'NO_OBSERVED_CHANGE' }
      },
      {
        display_name: 'Tỉ số phần trăm ngược',
        state: state('MATH.PERCENT', { concern: { status: 'CONFLICT' }, retention: { status: 'CHECK_PENDING' } }),
        diagnosis: diagnosis('MATH.PERCENT', { status: 'CONFLICT', hypothesis: 'UNKNOWN' }),
        priority: priority('MATH.PERCENT', 2, { reasons: ['UNRESOLVED_MATERIAL_CONFLICT'], flags: { unresolved_conflict: true, retention_due: true, verification_due: false } }),
        trend: { axes: { correctness: { status: 'MIXED' }, support: { status: 'STABLE_SUPPORT' }, independence: { status: 'STABLE_INDEPENDENT_EVIDENCE' } } },
        decision: decision('MATH.PERCENT', 'DIAGNOSE', 'DIAGNOSE', 8),
        outcome: { status: 'INCONCLUSIVE' }
      },
      {
        display_name: 'Đọc hiểu suy luận',
        state: { ...state('VIET.INFERENCE'), concept: { concept_id: 'VIET.INFERENCE', subject: 'VIETNAMESE', scope: 'inference', rubric_ref: 'rubric-vietnamese' } },
        diagnosis: diagnosis('VIET.INFERENCE'),
        priority: priority('VIET.INFERENCE', 3),
        trend: { axes: { correctness: { status: 'STABLE' }, support: { status: 'STABLE_SUPPORT' }, independence: { status: 'STABLE_INDEPENDENT_EVIDENCE' } } },
        decision: decision('VIET.INFERENCE', 'MAINTAIN', 'MAINTAIN', 8),
        outcome: { status: 'NOT_DELIVERED' }
      }
    ]
  };
}

test('parent view exposes exactly three surfaces in required order', () => {
  const model = buildParentViewModel(sampleInput());
  assert.deepEqual(model.surface_order, ['HOM_NAY', 'TIEN_DO', 'CHIEN_LUOC_TUAN']);
  assert.deepEqual(Object.keys(model.surfaces), ['HOM_NAY', 'TIEN_DO', 'CHIEN_LUOC_TUAN']);
});

test('HOM_NAY preserves underlying need when workload schedules PAUSE', () => {
  const model = buildParentViewModel(sampleInput());
  const item = model.surfaces.HOM_NAY.items[0];
  assert.equal(item.need_action, 'RETEACH');
  assert.equal(item.scheduled_action, 'PAUSE');
  assert.equal(item.need_label, 'Học lại phần cốt lõi');
  assert.equal(item.scheduled_label, 'Tạm hoãn hôm nay');
  assert.match(item.note, /Nhu cầu vẫn là/);
});

test('TIEN_DO makes conflict and unknown-style uncertainty visible with no aggregate mastery percentage', () => {
  const model = buildParentViewModel(sampleInput());
  const conflict = model.surfaces.TIEN_DO.items.find((x) => x.concept === 'Tỉ số phần trăm ngược');
  assert.match(conflict.uncertainty, /CONFLICT/);
  const text = JSON.stringify(model);
  assert.doesNotMatch(text, /mastery_score|mastery_percentage/i);
});

test('weekly strategy groups existing decisions without changing underlying actions', () => {
  const model = buildParentViewModel(sampleInput());
  assert.equal(model.surfaces.CHIEN_LUOC_TUAN.groups.HOC_LAI[0].need_action, 'RETEACH');
  assert.equal(model.surfaces.CHIEN_LUOC_TUAN.groups.TAM_HOAN_HOM_NAY[0].scheduled_action, 'PAUSE');
  assert.equal(model.surfaces.CHIEN_LUOC_TUAN.groups.LAM_RO[0].need_action, 'DIAGNOSE');
  assert.equal(model.surfaces.CHIEN_LUOC_TUAN.groups.DUY_TRI[0].need_action, 'MAINTAIN');
});

test('outcome wording stays observational and not-delivered is not called ineffective', () => {
  const model = buildParentViewModel(sampleInput());
  const maintain = model.surfaces.CHIEN_LUOC_TUAN.groups.DUY_TRI[0];
  assert.match(maintain.outcome, /chưa được thực hiện/);
  assert.doesNotMatch(JSON.stringify(model), /gây ra|do can thiệp này nên|chứng minh hiệu quả/i);
});

test('building parent view does not mutate upstream semantic inputs', () => {
  const input = sampleInput();
  const before = JSON.stringify(input);
  buildParentViewModel(input);
  assert.equal(JSON.stringify(input), before);
});

test('rendered HTML is card-based, responsive and does not dump raw schema/admin table', () => {
  const html = renderParentViewHtml(buildParentViewModel(sampleInput()));
  for (const id of ['HOM_NAY', 'TIEN_DO', 'CHIEN_LUOC_TUAN']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /font:18px/);
  assert.match(html, /@media\(max-width:760px\)/);
  assert.doesNotMatch(html, /<table/i);
  assert.doesNotMatch(html, /eligibility_ids|decision_basis|priority_score|mastery_percentage/i);
  assert.match(html, /Dữ liệu đang mâu thuẫn|CONFLICT/);
});
