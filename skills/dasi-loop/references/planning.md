# Planning review and user agreement

The full loop applies to `feature` (default), `change`, and planning-only `plan` tasks. `fix` and `simple` require a written `impact_review` justifying their bounded scope; use full planning if intended behavior or product choices are uncertain. Classification is the agent's responsibility, not inferred from source code by the helper.

## Draft and independent review

Create or update the persistent PRD first, following [prd.md](prd.md). Present its link and the decisions needing the user's input. Update the document after each material discussion and before recording the matching proposal with `start` or `revise-plan`, so the workspace snapshot includes the current PRD. After independent review, discuss findings with the user and revise the PRD and proposal together. Do not label a draft as agreed until the user actually agrees.

Use the contract structure in [records.md](records.md). For full planning, include `kind`, the original user `request`, and a `proposal` describing users, flows, exceptions, assumptions, constraints and verification. Criteria and the rubric are provisional until agreement. Keep the original request faithful; don't rewrite it to justify scope expansion.

```sh
node <helper> start --input /tmp/draft.json
node <helper> review-plan --run /path/to/run
```

`review-plan` starts a fresh read-only Codex evaluator or the fixed trusted command adapter using `dasi-plan/v1`. Its response schema has `request_id`, `summary`, and `findings`. Each finding has unique `id`, `category` (`required_defect`, `optional_improvement`, `user_decision`), `description` and `recommendation`. Planning returns no implementation scores and consumes no implementation rounds.

Present the findings and concrete options to the user. Discuss actual product decisions; resolve routine implementation choices autonomously. User agreement is about the current proposal, scope and acceptance criteria, not a generic permission to act. Already-recorded approval of that exact proposal can be used without asking again.

## Revision

```sh
node <helper> revise-plan --run /path/to/run --input /tmp/revised-draft.json
node <helper> review-plan --run /path/to/run
```

The revision input is the complete updated contract. Required defects must be corrected or rebutted with evidence in the proposal and independently reviewed again. A proposal change made to resolve a user decision also needs review before agreement. Optional suggestions are adopted only if the user includes them in scope. Drafts and reviews are preserved in `planning.drafts` and `planning.reviews`.

The reviewer, workspace and planning call budget remain fixed. `limits.plan_reviews` defaults to three calls (range 1–20); failed calls count too. Each invocation is bounded by `reviewer.timeout_seconds`. An already-reviewed draft/workspace cannot be re-rolled. A new review is allowed after a substantive draft revision or relevant workspace change; the helper cannot judge semantic importance. At the limit, finish with a non-completed status and a concrete next action instead of silently restarting.

## Agreement and implementation

Obtain the current `contract_hash` from `status`. Example agreement record:

```json
{
  "contract_hash": "current-draft-hash",
  "summary": "Agreed to email sign-in with explicit retry behavior",
  "user_confirmation": "User message approving this proposal and the recovery option; include the actual quote or message reference",
  "resolutions": [{"id":"D-1","decision":"User selected recovery by email"}]
}
```

Use an empty `resolutions` array when there are no `user_decision` findings. Every current user decision needs exactly one resolution. Do not invent a user statement. Like other local records, these fields are evidence supplied by the agent, not authenticated human approval.

```sh
node <helper> agree-plan --run /path/to/run --input /tmp/agreement.json
```

Agreement is refused while required defects remain, the plan/workspace lacks a current independent review, or decision resolutions are incomplete. Agreement freezes the implementation contract and starts its elapsed-time budget. Waiting for user discussion before agreement does not consume the implementation clock. `add`, implementation `evaluate`, and completion are blocked before agreement.

For `feature`/`change`, proceed through development checks → `add` → independent `evaluate` → score and corrections, as described in [records.md](records.md). Required behavior and target score must both pass. If implementation exposes a product-plan defect, return to user discussion and start a linked run for an agreed replacement contract; don't relax the current rubric.

For a `plan` request, deliver the agreed plan and `finish` as completed without code changes or implementation scores. Agreement does not authorize implementing a planning-only request.

Version-3 runs created before planning support keep their original contract and behavior. To use planning for old work, start a new run with `previous_run`; do not pretend earlier self-checks are planning review or user agreement. Git fingerprints do not cover ignored files, external systems or non-Git content; explicitly review relevant changes outside that coverage before recording agreement.
