# Dasi Loop

**Build. Evaluate. Dasi.** “Dasi” (다시) means “again” in Korean. Dasi Loop helps a coding agent review a plan with the user, agree on what to build, and improve the implementation through independent evaluation and fixed scoring criteria.

Use the same skill in personal and team projects. The agent follows each project's existing instructions and verification tools. No project-root YAML is required.

## Install

Node.js 18+ is required for the installer and helper.

```sh
npm install --global dasi-loop
dasi-loop install --agent codex
# Claude Code: dasi-loop install --agent claude
```

Use `--scope project` to install only in the current project. User installations go to `~/.codex/skills` or `~/.claude/skills`; project installations go to `.agents/skills` or `.claude/skills`. `install` refuses an existing skill; use `update` to replace it with a backup. Run records are preserved separately. Start a new agent session if the skill is not discovered immediately.

You can also install directly from GitHub with `npm install --global git+https://github.com/dev-kicking/Dasi-Loop.git`, clone this repository and run `npm install --global .`, or install a local tarball.

## Update

After the one-time npm 11+ script approval below, update the global npm package and its existing user-level Codex/Claude skills together:

```sh
npm config set allow-scripts=dasi-loop --location=user
npm update -g dasi-loop
```

The approval is needed once because npm 11 blocks install scripts by default. On older npm versions, skip the config command. The package's postinstall syncs only existing user-level skills under `~/.codex/skills` and `~/.claude/skills`; it does not create a skill or touch project-level copies. Project installations still need an explicit update from that project's root:

```sh
dasi-loop update --agent codex --scope project
```

To update manually, or if npm skipped the postinstall script, use `dasi-loop update --agent codex` (or `--agent claude`). `update` uses the skill bundled with your installed npm package; it does not fetch a release itself. Check the CLI package version with `dasi-loop --version`. The installed version and installation date are recorded in `.dasi-loop-install.json` inside the skill directory.

Before replacing an installed skill, `update` backs up its entire directory, including local edits and extra files. It prints the backup path under `dasi-loop-backups`, beside the `skills` directory (outside skill discovery). Local edits remain in the backup for you to reapply. Installations from 0.3.0 without version metadata are supported. Updating a missing skill fails with instructions to install it first. Start a new agent session after updating.

## Use

Invoke `$dasi-loop` in Codex, or `/dasi-loop` in a Claude Code environment that supports skill commands. Include the task and constraints:

> Use $dasi-loop to reject blank usernames while preserving valid logins. Define task-specific scoring anchors, use at most three rounds, and independently rerun regression checks. Leave unrelated work alone.

New features and intended behavior changes start with a planning loop:

The agent automatically writes a persistent Markdown PRD using the project's document conventions, or `docs/prd/<feature-name>.md` by default. It presents the document and unresolved questions to the user, updates decisions and agreement as discussion progresses, and rereads the PRD with the run record when resuming. The PRD is a readable product agreement; execution records retain independent reviews and scoring evidence.

```text
Request / existing plan → draft → independent planning review
                                 ↓
             discuss defects, optional ideas and decisions with the user
                                 ↓
                     revise and re-review as needed
                                 ↓
                agree on scope and completion criteria
```

Planning reviews report issues and recommendations, without implementation scores. Required planning defects must be cleared and user decisions recorded before implementation can start. Optional additions require agreement; they are not automatically added to scope. A clear bug restoring intended behavior or a simple edit uses a short impact review instead. Planning-only requests end with the agreed plan, without code changes or code scores.

At agreement the agent fixes acceptance criteria, rubric dimensions and anchors, weights totaling 100, target score and implementation budget. Planning review calls have a separate limit (default three), and user discussion does not spend the implementation clock. The reviewer remains fixed across both stages. See the [planning commands and agreement records](skills/dasi-loop/references/planning.md).

Each implementation round follows:

```text
Implement → development checks → record candidate → independent evaluation
    ↑                                               ↓
    └──── fix critical failures and rubric gaps ← assessment + scores
```

The evaluator receives the task contract and workspace, without the implementer's self-checks or prior scores. The helper calculates `Σ(weight × rating / 4)` from anchored integer ratings 0–4. A high score cannot override a required failure or critical blocker. Score history shows total and dimension deltas, best round, regressions and plateaus. Example scores such as `50 → 75 → 90` are possible outcomes, not guaranteed improvement.

To resume:

> Use $dasi-loop to resume /path/to/run. Review the latest independent assessment, current workspace, score trend and remaining budget before continuing.

A result includes outcome (`completed`, `needs_review`, `blocked`, `budget_exhausted`, `cancelled`), changes, criterion evidence, scores, remaining gaps, and run path. Non-completed outcomes include a concrete next action.

## Independent evaluators

The default evaluator launches a fresh `codex exec` process with a read-only sandbox, ephemeral session and structured JSON response. It needs an installed, authenticated Codex CLI with the required flags; a model or API key is not bundled. It can use the same model as the implementer, with an independent context. The helper never resumes the implementation conversation.

A `command` adapter can launch another agent or a deterministic grader using JSON stdin/stdout. Select an explicitly trusted executable when starting the run. The runner records the actual invocation; the adapter is responsible for a fresh evaluation context and its own execution sandbox. See the [evaluator protocol and boundaries](skills/dasi-loop/references/evaluation.md).

When no independent evaluator is available, the agent reports `needs_review` or `blocked`; self-reported success cannot mark the task complete. Installing the skill for Claude Code does not also install a verifier: use the Codex route if available, or supply a compatible command adapter.

## What the helper enforces

Records live in `~/.dasi-loop/runs`, outside the project. See the [record format and commands](skills/dasi-loop/references/records.md) for direct helper use.

- Full planning blocks implementation until a current independent planning review, no required planning defects, complete user-decision resolutions and recorded user agreement.
- Scope, criteria and scoring stay fixed after agreement; lightweight contracts are fixed at start. The reviewer stays fixed throughout planning and implementation.
- Implementer observations and independent assessments are separate. Only a spawned evaluator's accepted output can populate a review; `add` cannot submit scores or approval.
- Every criterion and scoring dimension must be assessed. Totals are computed by the helper. Required failures, missing review, critical blockers and scores below target block completion.
- Accepted rounds cannot be re-evaluated, and Git candidates whose fingerprint was already assessed in the run cannot be submitted again. After a correction, record a changed candidate and obtain a fresh assessment.
- Git snapshots reject stale evidence and detected evaluator changes to the workspace. Non-Git completion requires explicit review of current state.
- Attempt/time budgets and configured score plateaus block further rounds. Evaluation invocation is bounded by its timeout and remaining run time.
- State writes are atomic under a per-run writer lock. Finished records cannot be changed through the helper.

These are execution/protocol checks, not proof of grader honesty or human approval. Git snapshots exclude ignored files, submodules, external services and environment changes. Custom commands are not OS-sandboxed by this package. The helper cannot interrupt the parent agent, enforce provider spending, guarantee a grader's quality, or automatically improve a model's weights. Evaluate effectiveness on representative tasks before claiming general performance gains.

Version 0.4 extends version-3 records with planning drafts, independent reviews and user agreement. New helper inputs default to full planning and require `request` and `proposal`; lightweight tasks must specify `kind: "fix"` or `"simple"` and `impact_review`. Existing version-3 runs retain their original behavior; start a linked run to add planning. Version-2 (0.2) state is available for read-only inspection; start a new run with rubric/reviewer and `previous_run`. Version-1 (0.1) files remain untouched. Old self-checks are never imported as independent evidence.

## Development

```sh
npm test
npm pack --dry-run
```

Tests cover planning gates, revisions, decision resolution, planning-only outcomes, separate budgets, scoring arithmetic and trends, independent process execution, false-positive implementer claims, completion gates, stale evidence, evaluator failures/mutations, fixed contracts, budgets, legacy records and installation. A real failing regression is independently rerun before and after a correction. Tests validate the harness, not the quality of every model or custom adapter.
