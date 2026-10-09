import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateWorkloadGuard } from './index.mjs';

function guard(overrides = {}) {
  return evaluateWorkloadGuard({
    guardId: 'guard-test',
    asOf: '2026-09-18T00:00:00+07:00',
    policyVersion: 'ntl6-policy-1.0',
    dayType: 'WEEKDAY',
    readiness: 'NORMAL',
    externalLoad: 'LOW',
    scheduleKnown: true,
    unusualLoad: 'NONE',
    supplementalEventsToday: [],
    missedPriorMinutes: 0,
    ...overrides
  });
}

test('normal weekday stays within 15-25 minute target', () => {
  const out = guard();
  assert.equal(out.capacity_band, 'NORMAL');
  assert.equal(out.daily_cap_minutes, 25);
  assert.equal(out.remaining_minutes, 25);
});

test('tired child gets MICRO light-day cap', () => {
  const out = guard({ readiness: 'TIRED' });
  assert.equal(out.base_capacity_band, 'MICRO');
  assert.equal(out.daily_cap_minutes, 10);
  assert.ok(out.constraints.includes('CHILD_TIRED'));
});

test('high external load also caps to MICRO', () => {
  const out = guard({ externalLoad: 'HIGH' });
  assert.equal(out.base_capacity_band, 'MICRO');
  assert.equal(out.daily_cap_minutes, 10);
});

test('healthy low-load known weekend may allow bounded DEEP capacity', () => {
  const out = guard({ dayType: 'WEEKEND', readiness: 'HEALTHY', externalLoad: 'LOW' });
  assert.equal(out.capacity_band, 'DEEP');
  assert.equal(out.daily_cap_minutes, 60);
});

test('unknown schedule never creates DEEP capacity', () => {
  const out = guard({ dayType: 'WEEKEND', readiness: 'HEALTHY', externalLoad: 'LOW', scheduleKnown: false });
  assert.notEqual(out.capacity_band, 'DEEP');
  assert.equal(out.daily_cap_minutes, 25);
  assert.ok(out.constraints.includes('CAPACITY_UNCERTAINTY'));
});

test('multiple capacity unknowns become MICRO rather than assuming free time', () => {
  const out = guard({ dayType: 'WEEKEND', readiness: 'UNKNOWN', externalLoad: 'UNKNOWN', scheduleKnown: false, unusualLoad: 'UNKNOWN' });
  assert.equal(out.capacity_band, 'MICRO');
  assert.equal(out.daily_cap_minutes, 10);
});

test('diagnostic and recheck events consume the same supplemental budget', () => {
  const out = guard({ supplementalEventsToday: [
    { kind: 'DIAGNOSTIC', subject: 'MATH', minutes: 7 },
    { kind: 'RECHECK', subject: 'ENGLISH', minutes: 6 }
  ] });
  assert.equal(out.consumed_supplemental_minutes, 13);
  assert.equal(out.remaining_minutes, 12);
  assert.equal(out.capacity_band, 'NORMAL');
});

test('all subjects share one budget instead of separate subject caps', () => {
  const out = guard({ supplementalEventsToday: [
    { kind: 'PRACTICE', subject: 'MATH', minutes: 8 },
    { kind: 'TEACHING', subject: 'VIETNAMESE', minutes: 7 },
    { kind: 'PRACTICE', subject: 'ENGLISH', minutes: 5 }
  ] });
  assert.equal(out.consumed_supplemental_minutes, 20);
  assert.equal(out.remaining_minutes, 5);
  assert.equal(out.capacity_band, 'MICRO');
  assert.deepEqual(out.subjects_consuming_shared_budget, ['ENGLISH', 'MATH', 'VIETNAMESE']);
});

test('exhausted cap becomes REST with zero remaining minutes', () => {
  const out = guard({ supplementalEventsToday: [{ kind: 'PRACTICE', subject: 'MATH', minutes: 25 }] });
  assert.equal(out.capacity_band, 'REST');
  assert.equal(out.remaining_minutes, 0);
  assert.ok(out.constraints.includes('DAILY_SUPPLEMENTAL_CAP_EXHAUSTED'));
});

test('missed prior work creates no automatic debt and cannot raise today cap', () => {
  const out = guard({ missedPriorMinutes: 90 });
  assert.equal(out.daily_cap_minutes, 25);
  assert.equal(out.debt.missed_prior_minutes, 90);
  assert.equal(out.debt.automatic_debt_minutes, 0);
  assert.equal(out.debt.carry_forward_required, false);
});

test('output contains capacity only, not concept scheduling or strategy action fields', () => {
  const out = guard();
  const keys = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      walk(child);
    }
  };
  walk(out);
  for (const forbidden of ['concept_id','scheduled_action','need_action','strategy_action','priority_score','calendar_slot']) {
    assert.equal(keys.has(forbidden), false, `forbidden field: ${forbidden}`);
  }
});
