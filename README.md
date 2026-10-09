# NTL6 Learning Kit

[Tiếng Việt](README.vi.md) · [Full features](docs/FEATURES.md) · [English user guide](docs/USER_GUIDE.md) · [Hướng dẫn sử dụng](docs/HUONG_DAN_SU_DUNG.vi.md)

**Learning support, grounded in evidence. Private learner records stay private.**

NTL6 is a parent-guided AI education research-and-development project from HungLab. The public technical preview shares selected learning decision modules, a parent-console prototype, an offline manual-mode demo, and public educational Skills. The longer-term direction is to support learners as their needs change over many years.

**Status: Early open-source technical preview.** We do not claim that every module is production-ready, that AI accurately measures a child's ability, or that lifelong educational effectiveness has been established.

## What it does

- Distinguishes independent learning evidence from assisted attempts.
- Tracks concepts, trends and gaps with cautious, explainable decision rules.
- Recommends bounded RETEACH, RECHECK, MAINTAIN or ADVANCE actions, always subject to adult review.
- Generates a local parent-facing report from a prepared evidence pack.
- Provides a prototype Parent Console and reusable teaching/assessment Skills.

## Architecture

~~~text
SYNTHETIC EVIDENCE PACK
        |
    Eligibility
        |
   Concept state ----- Trends
        |               |
        +---- Diagnosis -+
                 |
          Workload guard
                 |
           Parent review
                 |
         Local HTML report
~~~

## Try locally

Requires Node.js 20 or later. The manual-mode demonstration requires **no API key** and uses **only synthetic records**.

~~~bash
npm run privacy
npm test
npm run demo
~~~

Open the generated parent-view.html file under runtime-data/manual-runs. Runtime output is Git-ignored.

## Repository layout

- **core/**: evidence, state, diagnosis, workload and strategy modules.
- **contracts/**: selected structured schemas (internal release metadata intentionally excluded).
- **application/, persistence/, tools/, ui/**: prototype Parent Console and supporting local components.
- **examples/manual-pack/**: entirely synthetic, labeled evidence. Not real child data.
- **skills/**: three public teaching Skills; does not include family-specific or internal orchestration Skills.
- **scripts/privacy-gate.mjs**: basic publication hygiene validation.

Some advanced integrations depend on content/source libraries and private local configuration deliberately excluded from this public edition.

## Learning philosophy

1. **Understanding before answers:** protect the child's thinking instead of supplying shortcuts.
2. **Evidence over impressions:** assisted attempts cannot silently become proof of independent mastery.
3. **Human judgment:** parent or teacher reviews rubrics, learning interventions and changes to tracked progress.
4. **Sustainable practice:** favor manageable learning plans and short rechecks.
5. **Continuity by design:** aim to support curiosity and learning over time; this is a roadmap, not a proven outcome.

## Privacy

No actual learner names, school records, photographs, scores, uploaded textbooks, login data or family learning history are authorized for the public repository.

Do not confuse a publicly safe source repository with a fully offline AI service. Submitting a real learner record to a cloud model or an external connector can still transmit that content to its provider. Read PRIVACY.md and SECURITY.md before adapting the prototype to real children.

## Project

HungLab — independent AI and engineering initiative.

- Website: https://hunglab.xyz
- Public GitHub: https://github.com/hpro2009gb
- Email: founder@hunglab.xyz

This is a curated fresh public snapshot, **not** a publication of the complete private development tree or its Git history. The public snapshot includes a synthetic demonstration and a deliberately limited subset of project functionality.

Licensed under MIT for the original content published in this repository. Third-party assets and copyrighted school materials are not included in the license grant.

## Publish guard
Before working with this public repository, run: git config core.hooksPath scripts
The local pre-push hook runs the privacy gate. This is not a guarantee of perfect detection; review each release manually. No hosted CI billing is required.
