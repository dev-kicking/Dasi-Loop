# Dasi Loop

**Build. Evaluate. Dasi.** “Dasi” (다시) means “again” in Korean. Dasi Loop helps a coding agent implement a task, obtain an independent assessment, and improve the work against a fixed scoring rubric.

Use the same skill in personal and team projects. The agent follows each project's existing instructions and verification tools. No project-root YAML is required.

## Install from GitHub

Node.js 18+ is required for the installer and helper.

```sh
npm install --global git+https://github.com/dev-kicking/loop-engineering-skill.git
dasi-loop install --agent codex
# Claude Code: dasi-loop install --agent claude
```

Use `--scope project` to install only in the current project. User installations go to `~/.codex/skills` or `~/.claude/skills`; project installations go to `.agents/skills` or `.claude/skills`. Existing skills are never overwritten: back up or move the existing `dasi-loop` skill directory before installing an update. Run records are preserved separately. Start a new agent session if the skill is not discovered immediately.

You can also clone this repository and run `npm install --global .`, or install a local tarball. This project has not published `dasi-loop` to the npm registry; use the GitHub URL until an official registry release is announced.

## Use

Invoke `$dasi-loop` in Codex, or `/dasi-loop` in a Claude Code environment that supports skill commands. Include the task and constraints:

> Use $dasi-loop to reject blank usernames while preserving valid logins. Define task-specific scoring anchors, use at most three rounds, and independently rerun regression checks. Leave unrelated work alone.

The agent fixes a contract before implementation: acceptance criteria, rubric dimensions and anchors, weights totaling 100, target score, reviewer and budget. Each round follows:

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

- Acceptance criteria, scoring anchors, weights and reviewer stay fixed within a run.
- Implementer observations and independent assessments are separate. Only a spawned evaluator's accepted output can populate a review; `add` cannot submit scores or approval.
- Every criterion and scoring dimension must be assessed. Totals are computed by the helper. Required failures, missing review, critical blockers and scores below target block completion.
- Accepted rounds cannot be re-evaluated, and Git candidates whose fingerprint was already assessed in the run cannot be submitted again. After a correction, record a changed candidate and obtain a fresh assessment.
- Git snapshots reject stale evidence and detected evaluator changes to the workspace. Non-Git completion requires explicit review of current state.
- Attempt/time budgets and configured score plateaus block further rounds. Evaluation invocation is bounded by its timeout and remaining run time.
- State writes are atomic under a per-run writer lock. Finished records cannot be changed through the helper.

These are execution/protocol checks, not proof of grader honesty or human approval. Git snapshots exclude ignored files, submodules, external services and environment changes. Custom commands are not OS-sandboxed by this package. The helper cannot interrupt the parent agent, enforce provider spending, guarantee a grader's quality, or automatically improve a model's weights. Evaluate effectiveness on representative tasks before claiming general performance gains.

Version 0.3 uses structured version-3 records. Version-2 (0.2) state is available for read-only inspection; start a new run with rubric/reviewer and `previous_run`. Version-1 (0.1) files remain untouched. Old self-checks are never imported as independent evidence.

## Development

```sh
npm test
npm pack --dry-run
```

Tests cover scoring arithmetic and trends, independent process execution, false-positive implementer claims, completion gates, stale evidence, evaluator failures/mutations, fixed contracts, budgets, legacy records and installation. A real failing regression is independently rerun before and after a correction. Tests validate the harness, not the quality of every model or custom adapter.
