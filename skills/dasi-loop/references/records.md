# Execution records

Use JSON files as inputs, and report the run directory returned by `start`. No file in the project root is required. The run directory can also be explicitly selected with `start --root <directory>`.

`start` requires nonempty `goal`, `workspace`, and `criteria` (an array of nonempty strings); optional fields include `base_revision`, `scope`, and `limits`. Example:

```json
{"goal":"Fix login validation","workspace":"/work/app","base_revision":"abc123","criteria":["Invalid input shows an error"],"limits":{"attempts":3}}
```

`add` requires `summary` and `verification`, both nonempty strings. Record the actual command, exit code, evidence location, or manual check in `verification`; note failures and what changed in `summary`.

```json
{"summary":"Added invalid-input test","verification":"npm test: exit 0; invalid-input test passed"}
```

`finish` requires `status` and `summary`. Valid statuses are `completed`, `needs_review`, `blocked`, `budget_exhausted`, and `cancelled`. Include criterion-level evidence and unverified items in `summary`. The helper does not validate the truth of those claims. Finished runs cannot be modified; start a new run referencing the prior run if more work is needed.

```json
{"status":"needs_review","summary":"Automated tests passed; visual check remains."}
```

`status` prints the original task, events and final result. Files are local and may contain project details; apply the storage and retention rules appropriate to the environment.
