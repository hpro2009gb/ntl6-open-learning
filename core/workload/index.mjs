const ALLOWED_DAY_TYPES = new Set(['WEEKDAY', 'WEEKEND']);
const ALLOWED_READINESS = new Set(['HEALTHY', 'NORMAL', 'TIRED', 'UNKNOWN']);
const ALLOWED_LOAD = new Set(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']);
const ALLOWED_UNUSUAL = new Set(['NONE', 'TEST', 'HOMEWORK_HEAVY', 'UNKNOWN']);

function required(value, name) {
  if (value === undefined || value === null || value === '') throw new Error(`MISSING_REQUIRED:${name}`);
  return value;
}

function enumValue(value, allowed, name) {
  required(value, name);
  if (!allowed.has(value)) throw new Error(`INVALID_${name.toUpperCase()}:${value}`);
  return value;
}

function minutes(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`INVALID_MINUTES:${name}`);
  return value;
}

function chooseBaseCapacity({ dayType, readiness, externalLoad, scheduleKnown, unusualLoad }) {
  const constraints = [];
  const why = [];

  if (readiness === 'TIRED') {
    constraints.push('CHILD_TIRED');
    why.push('Child self-report is TIRED, so supplemental load is capped to a light day.');
    return { band: 'MICRO', cap: 10, constraints, why };
  }

  if (externalLoad === 'HIGH' || ['TEST', 'HOMEWORK_HEAVY'].includes(unusualLoad)) {
    constraints.push(externalLoad === 'HIGH' ? 'HIGH_EXTERNAL_LOAD' : `UNUSUAL_${unusualLoad}`);
    why.push('Mandatory/school load is high, so supplemental work stays within a light-day budget.');
    return { band: 'MICRO', cap: 10, constraints, why };
  }

  const unknowns = [
    readiness === 'UNKNOWN',
    externalLoad === 'UNKNOWN',
    scheduleKnown === false,
    unusualLoad === 'UNKNOWN'
  ].filter(Boolean).length;

  if (unknowns >= 2) {
    constraints.push('MULTIPLE_CAPACITY_UNKNOWNS');
    why.push('Multiple capacity inputs are unknown; unknown schedule/load is not treated as free time.');
    return { band: 'MICRO', cap: 10, constraints, why };
  }

  if (unknowns === 1) {
    constraints.push('CAPACITY_UNCERTAINTY');
    why.push('One capacity input is unknown; DEEP work is blocked and the day is capped conservatively.');
    return { band: 'NORMAL', cap: 25, constraints, why };
  }

  if (dayType === 'WEEKEND' && readiness === 'HEALTHY' && externalLoad === 'LOW' && unusualLoad === 'NONE') {
    why.push('Weekend, healthy readiness, known low external load: bounded DEEP capacity is available.');
    return { band: 'DEEP', cap: 60, constraints, why };
  }

  if (dayType === 'WEEKEND') {
    why.push('Weekend capacity is available, but conditions do not justify a DEEP session.');
    return { band: 'NORMAL', cap: 35, constraints, why };
  }

  why.push('Known weekday conditions allow a normal supplemental window within the 15–25 minute target.');
  return { band: 'NORMAL', cap: 25, constraints, why };
}

function remainingBand(baseBand, remaining) {
  if (remaining <= 0) return 'REST';
  if (remaining <= 10) return 'MICRO';
  if (baseBand === 'DEEP' && remaining > 25) return 'DEEP';
  return 'NORMAL';
}

export function evaluateWorkloadGuard(input) {
  const guardId = required(input.guardId, 'guardId');
  const asOf = required(input.asOf, 'asOf');
  const policyVersion = required(input.policyVersion, 'policyVersion');
  const dayType = enumValue(input.dayType, ALLOWED_DAY_TYPES, 'dayType');
  const readiness = enumValue(input.readiness, ALLOWED_READINESS, 'readiness');
  const externalLoad = enumValue(input.externalLoad, ALLOWED_LOAD, 'externalLoad');
  const unusualLoad = enumValue(input.unusualLoad, ALLOWED_UNUSUAL, 'unusualLoad');
  const scheduleKnown = input.scheduleKnown === true;
  const events = Array.isArray(input.supplementalEventsToday) ? input.supplementalEventsToday : [];

  let consumed = 0;
  const subjects = new Set();
  for (const event of events) {
    const eventMinutes = minutes(event.minutes, 'supplementalEventsToday.minutes');
    consumed += eventMinutes;
    if (event.subject) subjects.add(event.subject);
  }

  const missedPriorMinutes = Number.isFinite(input.missedPriorMinutes) && input.missedPriorMinutes > 0 ? input.missedPriorMinutes : 0;
  const base = chooseBaseCapacity({ dayType, readiness, externalLoad, scheduleKnown, unusualLoad });
  const remaining = Math.max(0, base.cap - consumed);
  const band = remainingBand(base.band, remaining);
  const constraints = [...base.constraints];
  const why = [...base.why];

  if (consumed > 0) why.push(`Already-consumed supplemental work (${consumed} min) reduces the same shared daily budget.`);
  if (remaining === 0) constraints.push('DAILY_SUPPLEMENTAL_CAP_EXHAUSTED');
  if (missedPriorMinutes > 0) why.push('Missed prior work is recorded but creates zero automatic debt and does not raise today’s cap.');

  return {
    contract_version: 'WORKLOAD_GUARD/1.0',
    guard_id: guardId,
    as_of: asOf,
    policy_version: policyVersion,
    inputs: {
      day_type: dayType,
      readiness,
      external_load: externalLoad,
      schedule_known: scheduleKnown,
      unusual_load: unusualLoad
    },
    capacity_band: band,
    base_capacity_band: base.band,
    daily_cap_minutes: base.cap,
    consumed_supplemental_minutes: consumed,
    remaining_minutes: remaining,
    subjects_consuming_shared_budget: [...subjects].sort(),
    debt: {
      missed_prior_minutes: missedPriorMinutes,
      automatic_debt_minutes: 0,
      carry_forward_required: false
    },
    policy_guards: {
      diagnostics_and_checks_count_against_budget: true,
      budget_shared_across_subjects: true,
      unknown_schedule_is_not_free_time: true,
      missed_work_creates_no_automatic_debt: true
    },
    constraints,
    why
  };
}
