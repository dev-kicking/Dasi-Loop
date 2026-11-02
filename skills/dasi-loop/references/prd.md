# Persistent PRD

For a full planning task, author a readable Markdown PRD automatically. Reuse the relevant existing document and the project's document conventions. Otherwise create `docs/prd/<feature-name>.md` in the project. Do not overwrite unrelated documents. If project writes are unavailable or the user requires another location, preserve the draft in an allowed persistent location and report the actual path and limitation.

Include the information needed to resume and judge later work:

- Status (`draft`, `awaiting_decisions`, or `agreed`), revision, and related run path when available.
- Original request, problem, users and expected outcome.
- Scope, user flow, functional requirements, relevant constraints, errors and recovery.
- Acceptance criteria with stable IDs; agreed scoring criteria or a reference to the fixed run contract.
- Open questions with options and recommendations; clearly distinguish assumptions from decisions.
- Decision history: what the user selected, why when provided, and actual conversation evidence. Record agreement explicitly without inventing consent.
- Remaining work and observed verification results, distinguished from planned verification.

Adapt the length to the feature. Present the draft and ask the user about material unresolved decisions rather than only announcing that a document exists. Keep it current as answers arrive. Before implementation, reflect agreed scope and completion criteria in both the PRD and the helper contract. After agreement, changes to product behavior require renewed discussion; do not silently edit the PRD to match an implementation drift.

For each material decision, explain the problem, realistic options, their effects on the user's workflow or scope, and your recommendation with its reason. Give enough context for a user unfamiliar with the technology to choose. Avoid handing routine implementation decisions back to the user. Mark a recommendation as pending until the user resolves it; agreement to one item does not approve unrelated open items or the entire PRD.

The PRD and run state serve different purposes: the PRD explains the product agreement; state.json preserves reviews, fixed criteria and execution evidence. Keep them consistent. Read both when resuming after interruption or context loss. Writing or updating the PRD is part of the workspace change and must precede the independent review snapshot for that revision.
