# Watchtower Agent Collaboration Guide

This repository is shared by the user, Hermes Agent, and other coding agents. Treat the repository, Git history, and `.agent/` handoff files as the source of truth.

## Before starting work

1. Read this file and all files in `.agent/`.
2. Inspect the repository and current Git status before making changes.
3. Confirm the active task and respect the scope recorded in `.agent/TASK.md`.
4. Check `.agent/BLOCKERS.md` before starting implementation.

## Working agreement

- Work in small, verified milestones.
- Keep the structure simple and maintainable. Add services or infrastructure only when the task requires them.
- Do not invent product scope or claim completion without real validation results.
- Preserve unrelated work already present in the repository.
- Use Conventional Commits for meaningful milestones.
- Never rewrite Git history or force-push without explicit permission.
- Never commit secrets. Keep local credentials in ignored environment files and document variable names in `.env.example`.
- Record durable technical or product choices in `.agent/DECISIONS.md`.
- Record active impediments in `.agent/BLOCKERS.md`.
- Update `.agent/STATUS.md` after each milestone with completed work, validation results, and the next step.

## Handoff expectations

Before handing work to another agent:

- Make the working tree state clear.
- Update `.agent/STATUS.md` with the current state, setup or run instructions, checks performed, and remaining work.
- Update `.agent/TASK.md`, `.agent/DECISIONS.md`, and `.agent/BLOCKERS.md` when their contents have changed.
- Commit completed milestones unless the user asks otherwise.

## Current product boundary

Watchtower will eventually be an evidence-backed Base incident monitoring agent. The final feature set, architecture, data sources, and user experience have not been decided. Do not assume them without an approved task or recorded decision.
