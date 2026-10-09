import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EvidenceRegistry, deriveEligibility } from '../../core/evidence/index.mjs';
import { buildConceptState } from '../../core/state/index.mjs';
import { buildTrendReadModel } from '../../core/trend/index.mjs';
import { buildDiagnosisReadModel } from '../../core/diagnosis/index.mjs';
import { rankConceptPriorities } from '../../core/priority/index.mjs';
import { evaluateWorkloadGuard } from '../../core/workload/index.mjs';
import { buildStrategyDecision } from '../../core/strategy/index.mjs';
import { buildParentViewModel } from '../../ui/parent-view/view-model.mjs';
import { renderParentViewHtml } from '../../ui/parent-view/render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

function required(value, name) {
  if (value === undefined || value === null || value === '') throw new Error(`MISSING_REQUIRED:${name}`);
  return value;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try { return JSON.parse(line); }
      catch (error) { throw new Error(`INVALID_JSONL:${path.basename(file)}:${index + 1}:${error.message}`); }
    });
}

function safeName(value) {
  return String(value ?? 'run').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
}

function ensurePack(manifest, evidenceRows) {
  required(manifest.pack_id, 'manifest.pack_id');
  required(manifest.learner_id, 'manifest.learner_id');
  required(manifest.policy_version, 'manifest.policy_version');
  required(manifest.as_of, 'manifest.as_of');
  if (!Array.isArray(manifest.concepts) || manifest.concepts.length === 0) throw new Error('MISSING_REQUIRED:manifest.concepts');
  if (!Array.isArray(evidenceRows) || evidenceRows.length === 0) throw new Error('MISSING_REQUIRED:evidence.jsonl');
}

function conceptKey(conceptId, conceptVersion) {
  return `${conceptId}@@${conceptVersion}`;
}

function authorityOptions(conceptSpec) {
  const approved = conceptSpec?.rubric_authority?.status === 'PARENT_APPROVED';
  const options = { requireRubricAuthority: true };
  if (approved) {
    options.rubricAuthority = {
      concept_id: conceptSpec.concept_id,
      concept_version: conceptSpec.concept_version,
      rubric_ref: conceptSpec.rubric_authority.rubric_ref,
      rubric_version: conceptSpec.rubric_authority.rubric_version
    };
  }
  return options;
}

function workloadInput(manifest, supplementalEventsToday) {
  const w = manifest.workload ?? {};
  return {
    guardId: `guard-${manifest.pack_id}`,
    asOf: manifest.as_of,
    policyVersion: manifest.policy_version,
    dayType: w.day_type ?? 'WEEKDAY',
    readiness: w.readiness ?? 'UNKNOWN',
    externalLoad: w.external_load ?? 'UNKNOWN',
    scheduleKnown: w.schedule_known === true,
    unusualLoad: w.unusual_load ?? 'UNKNOWN',
    supplementalEventsToday,
    missedPriorMinutes: Number.isFinite(w.missed_prior_minutes) ? w.missed_prior_minutes : 0
  };
}

function makeRunId(manifest) {
  const stamp = String(manifest.as_of).replace(/[^0-9]/g, '').slice(0, 14) || Date.now().toString();
  return `${stamp}-${safeName(manifest.pack_id)}`;
}

export function runManualPack(packDir, options = {}) {
  const absolutePackDir = path.resolve(packDir);
  const manifestPath = path.join(absolutePackDir, 'manifest.json');
  const evidencePath = path.join(absolutePackDir, 'evidence.jsonl');
  if (!fs.existsSync(manifestPath)) throw new Error(`PACK_FILE_MISSING:${manifestPath}`);
  if (!fs.existsSync(evidencePath)) throw new Error(`PACK_FILE_MISSING:${evidencePath}`);

  const manifest = readJson(manifestPath);
  const evidenceRows = readJsonl(evidencePath);
  ensurePack(manifest, evidenceRows);

  const conceptSpecs = new Map();
  for (const spec of manifest.concepts) {
    required(spec.concept_id, 'manifest.concepts[].concept_id');
    required(spec.concept_version, 'manifest.concepts[].concept_version');
    required(spec.subject, 'manifest.concepts[].subject');
    required(spec.scope, 'manifest.concepts[].scope');
    conceptSpecs.set(conceptKey(spec.concept_id, spec.concept_version), spec);
  }

  const registry = new EvidenceRegistry();
  const records = [];
  const registryEvents = [];

  for (const row of evidenceRows) {
    const key = conceptKey(row?.target?.concept_id, row?.target?.concept_version);
    const spec = conceptSpecs.get(key);
    if (!spec) throw new Error(`UNDECLARED_CONCEPT:${row?.target?.concept_id ?? 'UNKNOWN'}@${row?.target?.concept_version ?? 'UNKNOWN'}`);

    const registration = registry.register({
      idempotencyKey: `${manifest.pack_id}:${required(row.evidence_id, 'evidence.evidence_id')}`,
      evidence: row
    });
    const evidence = registration.evidence;
    const eligibility = deriveEligibility(evidence, {
      duplicate: registration.duplicate,
      eligibilityId: `elig-${evidence.evidence_id}`,
      policyVersion: manifest.policy_version,
      evaluatedAt: manifest.as_of,
      ...authorityOptions(spec)
    });
    records.push({ evidence, eligibility });
    registryEvents.push({
      evidence_id: evidence.evidence_id,
      status: registration.status,
      duplicate: registration.duplicate,
      primary_evidence_id: registration.primary_evidence_id
    });
  }

  const models = [];
  for (const spec of manifest.concepts) {
    const concept = {
      concept_id: spec.concept_id,
      concept_version: spec.concept_version,
      subject: spec.subject,
      scope: spec.scope,
      rubric_ref: spec.rubric_authority?.rubric_ref ?? spec.rubric_ref ?? 'UNKNOWN',
      prerequisite_ids: spec.prerequisite_ids ?? []
    };
    const keyRecords = records.filter((r) =>
      r.evidence.target.concept_id === spec.concept_id &&
      r.evidence.target.concept_version === spec.concept_version
    );
    const token = safeName(spec.concept_id);
    const state = buildConceptState({
      learnerId: manifest.learner_id,
      concept,
      records: keyRecords,
      snapshotId: `snap-${manifest.pack_id}-${token}`,
      asOf: manifest.as_of,
      policyVersion: manifest.policy_version,
      conflictIds: [],
      retentionCheckPending: spec.planning?.retention_due === true,
      interveningPractice: spec.intervening_practice ?? 'UNKNOWN'
    });
    const trend = buildTrendReadModel({
      trendId: `trend-${manifest.pack_id}-${token}`,
      learnerId: manifest.learner_id,
      concept,
      records: keyRecords,
      conceptState: state,
      asOf: manifest.as_of,
      policyVersion: manifest.policy_version
    });
    const diagnosis = buildDiagnosisReadModel({
      diagnosisId: `diag-${manifest.pack_id}-${token}`,
      learnerId: manifest.learner_id,
      concept,
      records: keyRecords,
      asOf: manifest.as_of,
      policyVersion: manifest.policy_version
    });
    models.push({ spec, concept, records: keyRecords, state, trend, diagnosis });
  }

  const priorityModel = rankConceptPriorities({
    prioritySetId: `priority-${manifest.pack_id}`,
    asOf: manifest.as_of,
    policyVersion: manifest.policy_version,
    candidates: models.map((m) => ({
      concept: m.concept,
      state: m.state,
      trend: m.trend,
      diagnosis: m.diagnosis,
      meta: m.spec.planning ?? {}
    }))
  });
  const priorityByKey = new Map(priorityModel.ranked.map((p) => [conceptKey(p.concept_id, p.concept_version), p]));

  const initialEvents = Array.isArray(manifest.workload?.supplemental_events_today)
    ? [...manifest.workload.supplemental_events_today]
    : [];
  const plannedEvents = [...initialEvents];
  const initialWorkload = evaluateWorkloadGuard(workloadInput(manifest, initialEvents));

  const ordered = [...models].sort((a, b) => {
    const pa = priorityByKey.get(conceptKey(a.concept.concept_id, a.concept.concept_version))?.rank ?? Number.MAX_SAFE_INTEGER;
    const pb = priorityByKey.get(conceptKey(b.concept.concept_id, b.concept.concept_version))?.rank ?? Number.MAX_SAFE_INTEGER;
    return pa - pb || a.concept.concept_id.localeCompare(b.concept.concept_id);
  });

  for (const model of ordered) {
    const priority = priorityByKey.get(conceptKey(model.concept.concept_id, model.concept.concept_version));
    const liveWorkload = evaluateWorkloadGuard(workloadInput(manifest, plannedEvents));
    const decision = buildStrategyDecision({
      decisionId: `decision-${manifest.pack_id}-${safeName(model.concept.concept_id)}`,
      learnerId: manifest.learner_id,
      concept: model.concept,
      state: model.state,
      diagnosis: model.diagnosis,
      priority,
      workload: liveWorkload,
      policyVersion: manifest.policy_version,
      authorityScopeRef: model.spec.rubric_authority?.status === 'PARENT_APPROVED'
        ? `manifest://${manifest.pack_id}/approved/${model.concept.concept_id}`
        : `manifest://${manifest.pack_id}/unapproved/${model.concept.concept_id}`,
      createdAt: manifest.as_of
    });
    model.priority = priority;
    model.decision = decision;
    if (decision.scheduled_action !== 'PAUSE' && Number.isFinite(decision.dose?.minutes) && decision.dose.minutes > 0) {
      plannedEvents.push({
        kind: `NTL6_${decision.scheduled_action}`,
        subject: model.concept.subject,
        concept_id: model.concept.concept_id,
        minutes: decision.dose.minutes
      });
    }
  }

  const finalWorkload = evaluateWorkloadGuard(workloadInput(manifest, plannedEvents));
  const parentViewModel = buildParentViewModel({
    asOf: manifest.as_of,
    workload: initialWorkload,
    concepts: ordered.map((m) => ({
      display_name: m.spec.display_name ?? m.concept.concept_id,
      state: m.state,
      trend: m.trend,
      diagnosis: m.diagnosis,
      priority: m.priority,
      decision: m.decision,
      outcome: null
    }))
  });
  const parentHtml = renderParentViewHtml(parentViewModel);

  const runId = options.runId ?? makeRunId(manifest);
  const outputRoot = path.resolve(options.outputRoot ?? path.join(REPO_ROOT, 'runtime-data', 'manual-runs'));
  const outputDir = path.join(outputRoot, safeName(runId));
  fs.mkdirSync(outputDir, { recursive: true });

  const normalizedLines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const analysis = {
    contract_version: 'NTL6_MANUAL_ANALYSIS/1.0',
    run_id: runId,
    pack_id: manifest.pack_id,
    learner_id: manifest.learner_id,
    as_of: manifest.as_of,
    policy_version: manifest.policy_version,
    source_pack: absolutePackDir,
    registry_events: registryEvents,
    authority_summary: manifest.concepts.map((c) => ({
      concept_id: c.concept_id,
      authority_status: c.rubric_authority?.status ?? 'UNKNOWN'
    })),
    workload_initial: initialWorkload,
    workload_after_plan: finalWorkload,
    concepts: ordered.map((m) => ({
      concept: m.concept,
      state: m.state,
      trend: m.trend,
      diagnosis: m.diagnosis,
      priority: m.priority,
      decision: m.decision
    })),
    parent_view: parentViewModel,
    limitations: [
      'Manual Mode V1 consumes a prepared evidence pack; it does not parse raw chat/audio/reports itself.',
      'Synthetic/demo PASS proves software rule consistency, not educational effectiveness.',
      'Evidence without PARENT_APPROVED rubric authority is evaluated conservatively and cannot invent authority.'
    ]
  };

  fs.writeFileSync(path.join(outputDir, 'normalized-evidence.jsonl'), normalizedLines, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(outputDir, 'parent-view.html'), parentHtml, 'utf8');

  return {
    run_id: runId,
    output_dir: outputDir,
    parent_view: path.join(outputDir, 'parent-view.html'),
    analysis: path.join(outputDir, 'analysis.json'),
    normalized_evidence: path.join(outputDir, 'normalized-evidence.jsonl'),
    planned_minutes: plannedEvents.slice(initialEvents.length).reduce((n, e) => n + (Number(e.minutes) || 0), 0),
    initial_cap_minutes: initialWorkload.daily_cap_minutes,
    initial_remaining_minutes: initialWorkload.remaining_minutes
  };
}

function main() {
  const packArg = process.argv[2];
  if (!packArg || ['-h', '--help', '/?'].includes(packArg)) {
    console.log('Usage: node tools/manual-mode/run.mjs <pack-directory>');
    console.log('Example: node tools/manual-mode/run.mjs examples/manual-pack');
    process.exit(packArg ? 0 : 2);
  }
  const result = runManualPack(packArg);
  console.log(`NTL6 manual analysis complete\nRUN_ID=${result.run_id}\nOUTPUT_DIR=${result.output_dir}\nPARENT_VIEW=${result.parent_view}\nANALYSIS=${result.analysis}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
