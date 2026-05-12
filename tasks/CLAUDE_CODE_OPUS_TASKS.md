# Claude Code Opus 4.7 Task Briefs

Use Opus for high-judgment implementation and review tasks. Each task has a bounded ownership area. Claude Code should not rewrite product scope or add new major concepts without approval.

Primary source of truth:

- `docs/AGENT_BLACK_BOX_BUILD_SPEC.md`

## Task A: Contract Implementation Review

Ownership:

- `contracts/src/TraceRegistry.sol`
- `contracts/src/DemoTreasuryAction.sol`
- `contracts/test/*`

Ask:

> Review the contracts for correctness, event schema usefulness, authorization gaps, and demo reliability. Implement fixes only inside the contract and test folders. Preserve the P0 interface unless a change is necessary and documented.

Pass criteria:

- All contract tests pass.
- Non-owner trace writes are impossible.
- Closed sessions are immutable.
- Event fields are enough for frontend proof UI.
- No real-asset custody complexity is introduced.

Output required:

- Files changed.
- Security/correctness issues found.
- Remaining risks.

## Task B: Frontend Timeline Implementation

Ownership:

- `apps/web/src/app/*`
- `apps/web/src/components/*`
- `apps/web/src/lib/*`

Ask:

> Implement the Agent Black Box frontend as a flight-recorder timeline, not a chatbot. Use seeded data first, then support loading runner-generated sessions.

Pass criteria:

- Timeline is the primary visual.
- Role badges exist for planner, risk, executor, and system.
- Risk rejection is visually prominent.
- Trace detail drawer shows summary, raw JSON, content hash, URI, and on-chain proof fields.
- Proof panel is visible without scrolling on laptop demo layout.
- UI is responsive enough for projector and laptop screen.

Output required:

- Files changed.
- Local run command.
- Screenshot path if captured.

## Task C: Runner Reliability Review

Ownership:

- `runner/src/*`
- shared trace schema files if present

Ask:

> Review and harden the deterministic demo runner. It must be reliable without LLM keys and must produce trace hashes that match on-chain commitments.

Pass criteria:

- Missing API keys do not break scripted demo.
- Failed txs are surfaced loudly.
- Runner writes a machine-readable summary.
- Runner can be rerun safely.
- Hashing logic is deterministic and tested.

Output required:

- Files changed.
- Failure modes addressed.
- Manual smoke test result.

## Task D: Final Integration Review

Ownership:

- Read-only by default across repo.
- Edit only if explicitly asked after findings.

Ask:

> Review the finished repo against `docs/AGENT_BLACK_BOX_BUILD_SPEC.md`. Prioritize demo blockers, broken proof claims, security issues, and inconsistencies between contract, runner, and UI.

Findings format:

- Severity.
- File and line.
- Why it matters.
- Minimal fix.

Do not spend time on broad refactors.

