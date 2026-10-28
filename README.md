# Dasi Loop

**Build. Verify. Dasi.** “Dasi” (다시) means “again” in Korean. Dasi Loop helps a coding agent implement a task, verify observable acceptance criteria, and improve the result within a bounded number of rounds.

Use the same skill in personal and team projects. The agent discovers the project's existing instructions and verification tools. No project-root YAML is required.

## Install from GitHub

Node.js 18+ is required for the installer and record helper.

```sh
npm install --global git+https://github.com/dev-kicking/loop-engineering-skill.git
dasi-loop install --agent codex
# Claude Code: dasi-loop install --agent claude
```

Use `--scope project` to install only in the current project. User installations go to `~/.codex/skills` or `~/.claude/skills`; project installations go to `.agents/skills` or `.claude/skills`. Existing installations are never overwritten: back up or move the existing skill directory before installing an update. Old run records are preserved separately. Start a new agent session if the skill is not discovered immediately.

You can also clone this repository and run `npm install --global .`, or install a local tarball. The package name is `dasi-loop`; it has not been published to the npm registry by this project. Bare `npm install dasi-loop` or `npx dasi-loop` should not be used until an official registry release is announced.

## Use

Invoke `$dasi-loop` in Codex, or `/dasi-loop` in a Claude Code environment that supports skill commands. Include the task and meaningful constraints:

> Use $dasi-loop to fix blank usernames being accepted. Preserve valid-login behavior, add regression coverage, and use at most three verification rounds. Leave unrelated changes alone.

The agent will establish criterion IDs and verification methods, implement a correction, inspect actual checks, and record every criterion as passed, failed, or unverified. If a fixable failure remains, it diagnoses the next correction and tries again within the agreed budget. Unavailable tools or required human checks remain explicit gaps.

To resume an interrupted task:

> Use $dasi-loop to resume the run at /path/to/run. Check the current workspace and remaining budget before continuing.

A result includes its outcome (`completed`, `needs_review`, `blocked`, `budget_exhausted`, or `cancelled`), changes, verification evidence, remaining gaps, and a run path. Non-completed outcomes include a concrete next action.

## What the helper checks

Records live outside the project in `~/.dasi-loop/runs`. Read the [record format and commands](skills/dasi-loop/references/records.md) for direct helper use.

- A complete verification round must report every criterion. Required failed or unverified criteria block completion; optional polish does not.
- Command checks claimed as passed require command details and exit code 0. The latest round replaces earlier results.
- Further records are refused after attempt/time limits (defaults: three rounds and 45 minutes). The agent must also stop its work at those limits.
- Git snapshots detect changes to HEAD and tracked/untracked non-ignored file content after a verification round. Stale evidence blocks completion. Non-Git workspaces require explicit review.
- State writes are atomic under a per-run writer lock. Finished runs cannot be changed through the helper.

The helper validates agent-supplied records. It does not execute tests, authenticate claimed human approval, interrupt agent processes, enforce provider spending, or automatically restart sessions. The agent remains responsible for running appropriate verification and interpreting its results. Git snapshots exclude ignored files, submodule contents, external services, and environment changes.

Version 0.2 introduces structured version-2 records. Version-0.1 files remain readable as JSON, but are not imported as verified evidence; start a new run referencing the old one. See the record reference for compatibility and crash recovery.

## Development

```sh
npm test
npm pack --dry-run
```

Tests exercise installation, false-completion rejection, failed-to-passing regression evidence, stale workspaces, budgets, non-Git review, and concurrent-writer protection. They validate the helper's behavior, not the quality of arbitrary agent decisions.
