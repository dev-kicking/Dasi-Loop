# Record helper, version 2

Run `node <skill-directory>/scripts/record.mjs ...`. Inputs are JSON files created with file tools; do not interpolate task text or credentials into shell commands. The helper only records and validates supplied evidence. Verification commands are run by the agent separately.

## Start

```sh
node <helper> start --input /tmp/task.json
```

The command prints an absolute run directory under `~/.dasi-loop/runs`. `--root <directory>` changes the storage root; keep it outside the workspace, including any Git repository containing it, so the journal does not invalidate its own snapshot. No project-root config is created.

```json
{
  "goal": "Reject empty usernames without breaking valid logins",
  "workspace": "/absolute/path/to/project",
  "scope": ["login validation", "regression tests"],
  "criteria": [
    {"id": "AC-1", "description": "Empty usernames return a validation error"},
    {"id": "AC-2", "description": "Valid usernames retain existing behavior"},
    {"id": "AC-3", "description": "Error styling reviewed on a device", "required": false}
  ],
  "limits": {"attempts": 3, "minutes": 45}
}
```

Criterion IDs must be unique, at least one criterion must be required, and `required` defaults to true. String criteria are accepted and assigned IDs `AC-1`, `AC-2`, etc. `attempts` is a positive integer; `minutes` is a positive number. Defaults are 3 and 45, measured from run creation, including time away from the session. Optional context fields such as `scope`, `previous_run`, and `base_revision` are preserved, not enforced.

## Record a verification round

```sh
node <helper> add --run /path/to/run --input /tmp/attempt.json
```

```json
{
  "summary": "Added empty-username validation and checked existing valid inputs",
  "checks": [
    {"criterion": "AC-1", "status": "passed", "method": "command", "command": "npm test -- login", "exit_code": 0, "evidence": "Empty-username test passed; output reviewed"},
    {"criterion": "AC-2", "status": "passed", "method": "command", "command": "npm test -- login", "exit_code": 0, "evidence": "Existing valid-input tests passed"},
    {"criterion": "AC-3", "status": "unverified", "evidence": "Device unavailable; optional styling check deferred"}
  ]
}
```

Each round must contain exactly one check per criterion, including optional criteria. Status is `passed`, `failed`, or `unverified`. Every check needs nonempty `evidence`. Verified checks require a `method`:

- `command`: include the actual `command` and integer `exit_code`; a passed check requires exit code 0. An exit code alone does not prove the criterion; describe the relevant observed result.
- `inspection`: describe what was inspected and the observed behavior. Do not use this to substitute for a test that was required by the task.
- `human`: include `confirmed_by` and the actual confirmation. The helper cannot authenticate it.

Additional details such as `diagnosis`, `next_action`, and evidence file paths may be included in the round. Do not save secrets or raw sensitive output. A new round replaces the previous round for completion purposes. The helper refuses records beyond the attempt or time limit; it cannot interrupt the agent or a running command. A final passing round recorded within the budget can be closed after the deadline.

## Inspect or resume

```sh
node <helper> status --run /path/to/run
node <helper> resume --run /path/to/run
```

Both commands print the task, attempts, result, remaining budget, `unverified_required`, and `evidence_current` without modifying state or launching an agent. `evidence_current` is true/false when a previous round and current Git snapshot are available, otherwise null.

The Git snapshot hashes HEAD plus tracked and untracked non-ignored files in the workspace, including deleted files and symlink targets (without following symlinks). It does not cover ignored files, submodule contents, dependencies outside the workspace, environment variables, or external services. It also does not prove tests ran on the recorded snapshot: the agent must run checks before `add` and avoid intervening changes. When Git is unavailable, review the current workspace manually before completing.

## Finish

```sh
node <helper> finish --run /path/to/run --input /tmp/result.json
```

```json
{"status": "completed", "summary": "AC-1 and AC-2 passed the login regression tests; optional styling check deferred"}
```

`completed` requires all required checks in the latest round to pass and its Git snapshot to match. For non-Git workspaces, additionally supply `"workspace_reviewed": true` after reviewing the current state. A summary alone cannot mark a run complete.

Other valid statuses are `needs_review`, `blocked`, `budget_exhausted`, and `cancelled`. Each requires `summary` and `next_action` (`"none"` is allowed for cancellation):

```json
{"status": "blocked", "summary": "Cannot access required test service", "next_action": "Restore the service and start a new run referencing this one"}
```

## Storage and compatibility

A run stores one `state.json` with schema version 2, written by atomic replacement under a per-run writer lock. Status reads see either the old or new complete state. Failed input validation leaves state unchanged. Finished runs cannot be changed through this helper. If a process crashes while holding `.lock`, confirm it has stopped before removing that lock manually.

Version 0.1 used `task.json`, `attempts.jsonl`, and `result.json` with unstructured evidence. Those files remain untouched; inspect them manually and start a version-2 run with `previous_run` rather than treating their summaries as verified checks. Files are local and may include project details; use storage and retention rules appropriate to the environment.
