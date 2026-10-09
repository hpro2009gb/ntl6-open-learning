# NTL6 Learning Kit — User Guide

[Home](../README.md) · [Feature reference](FEATURES.md) · [Hướng dẫn tiếng Việt](HUONG_DAN_SU_DUNG.vi.md) · [Privacy](../PRIVACY.md)

**Purpose:** run an offline *synthetic* demonstration of the NTL6 learning-evidence engine and inspect its parent-facing output. The public edition is a technical preview, not a turnkey deployed learning platform.

## Prerequisites

- Node.js 20 or newer.
- A terminal and web browser.
- Git to clone the source, or a downloaded source archive.
- No AI-provider API key or real child record for the demo.

## Quick start

```bash
git clone https://github.com/hpro2009gb/ntl6-open-learning.git
cd ntl6-open-learning
npm run privacy
npm test
npm run demo
```

The example input is under `examples/manual-pack/` and is explicitly **synthetic**. The demo prints paths labelled `OUTPUT_DIR`, `PARENT_VIEW`, and `ANALYSIS`. Open `PARENT_VIEW` in your browser; generated files reside in the Git-ignored `runtime-data/manual-runs/` directory.

### What the input format means

A manual pack has a `manifest.json` and an `evidence.jsonl`. The manifest supplies `pack_id`, `learner_id`, `as_of`, `policy_version`, `concepts[]`, rubric authority and workload. Each evidence JSONL row represents an `EVIDENCE_OPPORTUNITY/1.0`. To try a different **synthetic** pack:

```bash
node tools/manual-mode/run.mjs path/to/synthetic-pack
```

The output contains `analysis.json`, `normalized-evidence.jsonl`, and `parent-view.html`. Keep all individual learner data outside the public repository; see [PRIVACY.md](../PRIVACY.md).

## Run the local Parent Console prototype

On Windows:

```powershell
node tools/parent-console/server.mjs --port 17661 --open
```

Or start without `--open` and browse to `http://127.0.0.1:17661/`. Stop with Ctrl+C. Some optional materials, source library, school-context and assessment flows depend on files deliberately excluded from the public edition. Expect gaps in unsupported advanced workflows.

**Do not expose this local server via a public port or tunnel.** It is not a production authenticated web service.

## Three public education Skills

The `skills/` directory contains `ntl6-lesson-guide`, `ntl6-assessment-coach`, and `ntl6-parent-review`. They teach workflows for guided lessons, formative assessments and cautious parent reviews. These Skills do not automatically connect to your Parent Console or store private learner records.

If using cloud AI, text entered into the provider may leave your machine. Use synthetic examples when experimenting; review provider access and parental permission before any real learner data transfer.

## Read results with appropriate caution

The engine separates independent evidence, assisted attempts, unknown/conflicted observations, and proposed next actions. A recommendation like `RETEACH`, `RECHECK`, or `ADVANCE` is a **parent-review proposal**, not proof of mastery or an autonomous decision to promote a child.

## Validate a public contribution

1. Work in a separate branch.
2. Add meaningful tests for changed behavior.
3. Run `npm test` and `npm run privacy`.
4. Inspect `git diff --cached --name-only` and every staged diff before publishing.
5. Never commit child identities, homework, assessment records, school logins, raw chats, recordings, copyrighted textbooks or internal orchestration data.
6. Do not rely solely on `.gitignore`; committed history can retain leaked values.

A green targeted privacy scan is **not** a guarantee against all forms of personal data. The educational, age-coverage, curriculum and security claims require separate independent validation.

See the [Vietnamese step-by-step guide](HUONG_DAN_SU_DUNG.vi.md) for more troubleshooting and explanation.
