# Project Collaboration Rules

## Working relationship

This project is being developed collaboratively with Hermes Agent and Codex.
Hermes coordinates priorities, reviews progress, checks requirements, and verifies
results. Codex is responsible for implementation inside the repository.

Do not invent product requirements or assume the project theme. Follow the current
task specification in `.agent/TASK.md`.

## Before starting work

1. Read this file.
2. Read `.agent/TASK.md`.
3. Read `.agent/STATUS.md`, `.agent/DECISIONS.md`, and `.agent/BLOCKERS.md` if they exist.
4. Inspect the current Git status and recent commit history.
5. State a short implementation plan before making changes.

## Task discipline

- Work in small, independently verifiable milestones.
- Do not make broad changes without explaining why.
- Do not silently change product scope, architecture, APIs, or requirements.
- If a requirement is ambiguous, record the assumption in `.agent/DECISIONS.md`.
- If blocked, record the blocker in `.agent/BLOCKERS.md` instead of guessing.
- Prefer a working narrow MVP over unfinished breadth.

## Git workflow

- Make meaningful, frequent commits after each coherent milestone.
- Never leave a large batch of unrelated changes uncommitted.
- Use Conventional Commit messages:
  - `feat: ...`
  - `fix: ...`
  - `test: ...`
  - `docs: ...`
  - `refactor: ...`
  - `chore: ...`
- Do not rewrite history, force-push, or delete branches unless explicitly asked.
- Before each commit, review the diff and run relevant tests.
- Never claim a task is complete without reporting the actual test result.

## Progress tracking

After every meaningful milestone:

1. Update `.agent/STATUS.md` with:
   - what changed
   - what was tested
   - current Git commit
   - what remains
   - any risks or blockers
2. Commit the implementation and progress update together.

Use this status format:

- Current milestone:
- Completed:
- Tests run:
- Result:
- Current commit:
- Next step:
- Blockers:
- Decisions needed:

## Handoff protocol

At the end of each task, report:

- Files changed
- Commits created
- Tests run and their real results
- Known limitations
- Suggested next task

Do not modify secrets, credentials, or unrelated files.

Public repository rule:
All tracked documentation must be safe for public viewing. Never place secrets,
private conversation context, personal notes, or credentials in tracked files.
Use .agent/private/ for local-only notes, and keep that directory ignored.
