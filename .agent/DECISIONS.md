# Decisions

## 2026-08-22: Keep initialization technology-neutral

Status: Accepted

The repository starts with documentation and collaboration workflow files only. No language, framework, package manager, service, data source, hosting provider, or infrastructure is selected until an approved product task requires a choice.

Reason: The current product boundary is intentionally broad, so an early technical commitment would create unsupported scope.

## 2026-08-22: Use repository handoff files as shared state

Status: Accepted

Agents will use `AGENTS.md`, `.agent/TASK.md`, `.agent/STATUS.md`, `.agent/DECISIONS.md`, `.agent/BLOCKERS.md`, and Git history as the shared source of truth.

Reason: Small, versioned handoffs make progress, decisions, validation, and blockers visible across agents.
