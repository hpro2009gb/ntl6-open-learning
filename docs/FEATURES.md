# NTL6 Learning Kit — Complete Public Feature Reference

[Home](../README.md) · [User guide (Vietnamese)](HUONG_DAN_SU_DUNG.vi.md) · [User guide (English)](USER_GUIDE.md) · [Privacy](../PRIVACY.md)

NTL6 is a **parent-guided learning R&D prototype**. This feature map reflects modules present in the public source snapshot, not a claim that private account integrations, content libraries, curriculum coverage or outcomes have been independently verified for every learner.

## Functional modules

| Module / public source | Capability and evidence | Public-edition readiness |
|---|---|---|
| **Evidence eligibility** — `core/evidence/`, `contracts/evidence-*.schema.json` | Separate eligible vs ambiguous evidence, grade/assistance provenance; avoid treating externally reported outcomes as proof of independent performance | Included; unit tested; demonstrable with synthetic manual pack |
| **Concept state** — `core/state/` | Build structured concept state from accepted evidence and explicit requirements | Included; not a psychometric/educational validation claim |
| **Trend and diagnosis** — `core/trend/`, `core/diagnosis/` | Identify signals, repeated patterns, conflicts and unknowns, rather than assuming every mistake is conceptual | Included; unit tested on synthetic fixtures |
| **Priority and workload** — `core/priority/`, `core/workload/` | Rank learning needs and limit proposed study burden using workload/readiness context | Included; requires appropriate parent-supplied inputs |
| **Strategy** — `core/strategy/` | Distinguish `DIAGNOSE`, `RETEACH`, `REPAIR`, `RECHECK`, `MAINTAIN`, `ADVANCE` recommendations | Included; actions are reviewable suggestions, not autonomous teaching decisions |
| **Outcome records** — `core/outcome/`, `contracts/strategy-outcome.schema.json` | Keep delivered interventions and subsequent observed outcomes distinct | Included; not proof of long-term effectiveness |
| **Question lifecycle** — `core/questions/`, `persistence/question-bank/`, `persistence/exposure/` | Question eligibility, structural fingerprints, generation candidates and exposure state | Core modules included; curriculum-specific item banks deliberately excluded |
| **Roadmap/target metadata** — `core/roadmap/`, `core/target/` | Structured target model and source-bounded pathway projection | Included; private district/school content and personalized plans excluded |
| **Evidence ledger and corrections** — `persistence/ledger/`, `contracts/ledger-*.schema.json` | Structured history/corrections with versioned evidence records | Code included; generated records remain local and should not be committed |
| **Manual-mode runner** — `tools/manual-mode/run.mjs` | Read prepared manifest + evidence JSONL; generate normalized evidence, analysis JSON and local parent-view HTML | **Executable synthetic demo**; tested locally without API key |
| **Parent report** — `ui/parent-view/` | Display current progress, uncertainty and next review actions from analyzed pack | Generated offline by demo; designed for parent interpretation |
| **Parent Console prototype** — `ui/parent-console/`, `application/parent-console/`, `tools/parent-console/server.mjs` | Local dashboard, assessment and question workflows, history/learning context, material lookup interfaces | Prototype on localhost; some routes require excluded content/source libraries; **not** an Internet-facing service |
| **Material/source integration interfaces** — `application/parent-console/material-*.mjs`, `source-fusion-service.mjs` | Interface code for source-aware context and material selection | Code present; original family/school content and private source registry **not** distributed |
| **Three educational Skills** — `skills/` | Lesson guide, assessment coach, parent progress review | Public instructions present; not a deployed tutoring product with a tested full curriculum |
| **Privacy gate** — `scripts/privacy-gate.mjs` | Validate tracked public files against a restricted path list and common sensitive signatures | Runs locally; targeted detection, **not** a guarantee that every possible PII value is detectable |

## Reusable public Skills

- `ntl6-lesson-guide`: parent-approved lesson explanation, one-hint-at-a-time help, independent check and parent summary.
- `ntl6-assessment-coach`: small formative assessment, separate student/parent materials, transparent rubric and recheck conditions.
- `ntl6-parent-review`: summarize topic-level evidence, distinguish independent and assisted results, propose reasonable review load.

Each public Skill has a `SKILL.md` and `agents/openai.yaml`. Using them with a cloud model can transmit content you enter to the service provider: use synthetic or pseudonymized examples and obtain parent authorization for any real data transfer.

## Manual demo: exact input and output

`examples/manual-pack/` contains a **synthetic** pack. The runner consumes `manifest.json` and `evidence.jsonl` and writes to `runtime-data/manual-runs/<run-id>/`:

```text
analysis.json
normalized-evidence.jsonl
parent-view.html
```

Run `npm run demo` from the project root. The demo is not a real child assessment and does not measure genuine learning improvements. Runtime records are excluded from Git publication.

## Local HTTP prototype

`node tools/parent-console/server.mjs --port 17661 --open` starts a localhost-only Parent Console (default port `17661`; `--open` launches a browser on Windows). Representative local API read paths in the source include `GET /api/dashboard`, `GET /api/progress`, `GET /api/baseline`, `GET /api/question-bank`, `GET /api/planning-context`, `GET /api/learning-context`, and `GET /api/materials`. Some routes require missing private curriculum/source files and must not be marketed as complete standalone functionality.

**No public authentication/security audit has been performed for exposing this server to external networks.** Do not bind it to public interfaces or forward its port.

## What the public edition intentionally omits

- Real child identities, school/class profiles, marks, transcripts, homework photos and audio.
- Private teacher/parent records and source-material registries.
- Copyrighted school textbooks and derivative teaching packs lacking distribution permission.
- Browser cookies, school integrations with actual accounts and all API/provider credentials.
- Internal execution/agent memory, private repo history and approval ledgers.
- Claims of established educational effectiveness, broad age coverage, commercial customers or production readiness.

## Verification at this snapshot

A previous local verification of the **sanitized public snapshot** reported `123/123` Node tests passing, the synthetic manual demo generating the expected local output, and the privacy gate reporting PASS over its configured restricted-pattern scope. These checks do **not** prove absence of all identifiers, curriculum correctness for every level, a tested school-provider integration, or lifelong learning outcomes.

See [the guide](HUONG_DAN_SU_DUNG.vi.md) and [PRIVACY.md](../PRIVACY.md) before adapting for actual families.
