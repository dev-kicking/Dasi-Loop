# Record helper, version 3

Run `node <skill-directory>/scripts/record.mjs ...`. Input JSON files are agent-created task records, not project-root configuration. Avoid shell-interpolated task text and credentials. Records default to `~/.dasi-loop/runs`; `start --root <directory>` changes the root. The helper requires storage outside the workspace directory. Prefer a location outside its entire Git repository as well, to avoid mixing execution records into project history.

## 1. Start with a fixed rubric

```sh
node <helper> start --input /tmp/task.json
```

The command prints the run directory. Example contract:

```json
{
  "goal":"Reject empty usernames and preserve valid logins",
  "workspace":"/absolute/project/path",
  "scope":["username validation", "regression coverage"],
  "criteria":[
    {"id":"AC-1","description":"node regression.cjs passes empty and valid username assertions"}
  ],
  "rubric":{
    "target":85,
    "plateau_rounds":2,
    "min_delta":1,
    "dimensions":[
      {
        "id":"behavior",
        "description":"Independently observed username validation behavior",
        "criteria":["AC-1"],
        "weight":100,
        "anchors":{
          "0":"Validation is absent or cannot be assessed",
          "1":"Implementation exists but required runtime checks fail",
          "2":"Only empty or only valid username behavior works",
          "3":"Both cases look correct but independent runtime evidence is missing",
          "4":"Both assertions pass when independently executed"
        }
      }
    ]
  },
  "reviewer":{"kind":"codex","timeout_seconds":300},
  "limits":{"attempts":3,"minutes":45}
}
```

Multiple dimensions enable separate functional correctness, failure handling, regression coverage or task-specific quality scores; choose concrete anchors rather than copying a universal scoring template. Weights must be positive and sum to 100. Dimension IDs must be unique and link known criterion IDs. Every required criterion must be covered. Ratings are integers 0–4. `total = Σ(weight × rating / 4)`, rounded to two decimals. A high total never overrides required failures.

Criteria need unique IDs and descriptions; `required` defaults to true and at least one is required. Optional criteria still need a check each round. Strings are accepted as criteria with generated IDs `AC-1`, etc. `attempts` is a positive integer; `minutes` is in (0,525600]. Defaults are 3/45. Time includes pauses and evaluation. Reviewer defaults to `codex` with a 300-second invocation timeout, also capped by remaining run time. See [evaluation.md](evaluation.md) for custom reviewers and execution boundaries.

The helper stores a contract digest and rejects accidental task/rubric/reviewer changes. This is not tamper-resistant storage: a process with write access to records can alter them. To change the contract deliberately, start a new run with `previous_run` pointing to the earlier run, respecting the user's scope and budget.

## 2. Record implementer observations

```sh
node <helper> add --run /path/to/run --input /tmp/attempt.json
```

```json
{
  "summary":"Added blank-username validation",
  "checks":[
    {"criterion":"AC-1","status":"passed","method":"command","command":"node regression.cjs","exit_code":0,"evidence":"Development tests passed"}
  ],
  "diagnosis":"Original validation accepted empty input",
  "next_action":"Independent evaluator should rerun the regression checks"
}
```

Every criterion needs exactly one check. Status is `passed`, `failed`, or `unverified`; each needs evidence or the reason it is unavailable. Verified checks require `command`, `inspection`, or `human` as method. Command checks need command text and integer `exit_code`; passing requires 0. Human checks need an actual `confirmed_by`. These observations never count as independent approval. `add` rejects reviewer scores and review objects.

Each new round consumes an attempt. The helper refuses rounds after attempt/time limits or a configured score plateau. It cannot stop agent work done outside the helper.

## 3. Independently evaluate

```sh
node <helper> evaluate --run /path/to/run
```

The runner invokes the selected evaluator in a separate process. No `--input` review import is supported. The response is bound to a fresh request ID and the current contract; the helper validates checks and computes weighted scores. It stores the independent checks, dimension feedback, score, invocation provenance, timestamp and Git snapshot. An implementer cannot approve a task by supplying self-reported checks to `finish`.

If the Git workspace differs from the last `add`, record a fresh round first. If it changes during evaluation, no assessment is accepted. Once an assessment is recorded, evaluating that same round again is rejected, even if its score is low. Submitting any already-assessed Git fingerprint as a new candidate is also rejected. Fix the work and start a changed round. External verification-context changes without code changes require a new explicitly authorized run; non-Git projects rely on the agent to establish that a correction occurred. A transient evaluator failure can be retried within the remaining time budget, with no invented score.

## 4. Inspect scores and resume

```sh
node <helper> status --run /path/to/run
node <helper> resume --run /path/to/run
```

Both are read-only and print:

- Task, rounds, accepted independent assessments, errors and result.
- Remaining budget and required criteria not passed by the latest independent assessment.
- `evidence_current`: whether the latest accepted review matches current Git content (otherwise null if unavailable).
- `scoring.history`: totals, deltas from the preceding evaluated round, and per-dimension point deltas.
- `scoring.best_score`, `best_attempt`, `regression`, and `plateau`.

Only accepted assessments appear in history. Initial delta is null. Regression means the latest total decreased. Plateau means the best score across the last `plateau_rounds` evaluations improved by less than `min_delta` points compared with the best score before that window. At least one earlier evaluation is required. Defaults: 2 rounds/1 point. A plateau stops further `add` calls; record a human review/strategy action. Best score is informational; completion always uses the latest assessment, and code is never automatically rolled back.

Git snapshots hash HEAD and tracked/untracked non-ignored files under the workspace, including deletions and symlink targets without following symlinks. They exclude ignored files, submodule contents, external dependencies/services and environment variables. They cannot prove a grader actually ran the claimed command. Non-Git projects require explicit review of current state.

## 5. Finish

```sh
node <helper> finish --run /path/to/run --input /tmp/result.json
```

```json
{"status":"completed","summary":"Independent regression tests passed; score 100/100"}
```

Completion requires the latest independent review, all required criteria passed, no `must_fix` blockers, total at least the fixed target, and current evidence. A non-Git workspace additionally needs `"workspace_reviewed": true`. A passing assessment recorded within budget may be closed after the deadline.

Other outcomes are `needs_review`, `blocked`, `budget_exhausted`, and `cancelled`. Each needs a summary and specific `next_action` (`"none"` is allowed for cancellation):

```json
{"status":"needs_review","summary":"Evaluator unavailable or score plateau reached","next_action":"Restore the evaluator or review the failing strategy before a new run"}
```

## Storage and compatibility

The helper atomically replaces `state.json` under a per-run writer lock. Reads see a complete old/new state; validation failures do not approve work. Evaluation failures update only diagnostic metadata, never a score. If a process crashes holding `.lock`, confirm it is stopped before removing the lock. Finished runs cannot be modified through the helper.

Version-2 (0.2) state can be inspected with `status`/`resume` but is read-only; start a v3 run with rubric/reviewer and `previous_run`. Version-1 (0.1) `task.json`, `attempts.jsonl`, and `result.json` remain untouched and can be inspected manually. Old self-assessments are never imported as independent evidence. Do not store secrets in goals, argv or evidence; use existing authentication/environment mechanisms and appropriate retention policies.
