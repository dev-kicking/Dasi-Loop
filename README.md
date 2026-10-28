# Loop engineering skill

An installable skill for a bounded implementation → verification → improvement loop. It works with the project's existing instructions and verification commands; no root-level YAML or project configuration is required.

## Install

Node.js 18+ is required. From this package directory, install for the current user:

```sh
npm install --global .
loop-engineering-skill install --agent codex
# or: loop-engineering-skill install --agent claude
```

To install from the GitHub repository, clone it first:

```sh
git clone https://github.com/dev-kicking/loop-engineering-skill.git
cd loop-engineering-skill
npm install --global .
loop-engineering-skill install --agent codex
```

Use `--scope project` to install for only the current project. User installations go to `~/.codex/skills` or `~/.claude/skills`; project installations go to `.agents/skills` or `.claude/skills`. The installer refuses to overwrite an existing installation. Restart the agent session if it does not discover the skill immediately.

For a packaged tarball, replace `.` with its path. After publishing to an npm registry, the corresponding package can be run via `npx`; this repository does not publish it automatically. Verify the chosen package name is available and trusted before publishing or installing from a registry.

## Use

Ask the agent: `Use $loop-engineering to implement this task, verify the acceptance criteria, and record the result.` Claude Code users can invoke the installed `loop-engineering` skill using their environment's skill mechanism.

The agent chooses task-specific verification and records a bounded loop. The optional helper saves records to `~/.loop-engineering/runs`, outside the target project. It records supplied information; it is not an autonomous scheduler, command runner, policy enforcer, or independent verifier. A session interruption requires a user or agent to resume using the saved record. No model, API key, or background service is bundled.

## Development

Run `npm test` to test installation and record lifecycle. Run `npm pack --dry-run` to inspect the distributable contents.
