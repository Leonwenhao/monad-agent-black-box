# Handoff Prompts

Use these prompts to start downstream model/tool sessions without losing the product lock.

## GPT-5.4 Codex `/goal` Prompt Template

Paste this after starting a persisted interactive Codex thread in the project repo:

```text
/goal Read docs/AGENT_BLACK_BOX_BUILD_SPEC.md, agent-context/DOWNSTREAM_AGENT_INSTRUCTIONS.md, and tasks/GPT54_GOALS.md. Execute Goal <N>: <goal title>. Keep working until every pass criterion for that goal is satisfied. Do not reinterpret the product, do not expand scope, and do not move to the next goal. Run the relevant tests/commands and report exact evidence. If blocked, report the exact command, exact error, affected pass/fail criterion, and smallest proposed fix.
```

Recommended order:

```text
/goal Execute Goal 0: Verify Local Goal Loop.
/goal Execute Goal 1: Scaffold The Monorepo.
/goal Execute Goal 2: Implement TraceRegistry Contract.
/goal Execute Goal 3: Implement DemoTreasuryAction Contract.
/goal Execute Goal 4: Implement Trace Schema And Hashing.
/goal Execute Goal 5: Implement Deterministic Demo Runner.
/goal Execute Goal 6: Implement Frontend Seeded Replay.
/goal Execute Goal 7: Wire Frontend To Runner Data.
/goal Execute Goal 8: Deploy To Monad Testnet.
/goal Execute Goal 9: Deploy Public Frontend.
/goal Execute Goal 10: Final Smoke Test And Submission Readiness.
```

## Claude Code Opus Prompt: Contract Review

```text
You are working in the Monad Agent Black Box repo. Read docs/AGENT_BLACK_BOX_BUILD_SPEC.md, agent-context/DOWNSTREAM_AGENT_INSTRUCTIONS.md, and tasks/CLAUDE_CODE_OPUS_TASKS.md.

Execute Task A: Contract Implementation Review.

You are not alone in the codebase. Do not revert changes made by others. Own only contracts/src/TraceRegistry.sol, contracts/src/DemoTreasuryAction.sol, and contracts/test/*. Preserve the P0 interface unless a change is necessary and documented. Prioritize authorization, event schema usefulness, closed-session immutability, duplicate session safety, and demo reliability.

Return files changed, tests run, issues found, fixes made, and remaining risks.
```

## Claude Code Opus Prompt: Frontend Timeline

```text
You are working in the Monad Agent Black Box repo. Read docs/AGENT_BLACK_BOX_BUILD_SPEC.md, design/CLAUDE_DESIGN_BRIEF.md, agent-context/DOWNSTREAM_AGENT_INSTRUCTIONS.md, and tasks/CLAUDE_CODE_OPUS_TASKS.md.

Execute Task B: Frontend Timeline Implementation.

You are not alone in the codebase. Do not revert changes made by others. Own only apps/web/src/app/*, apps/web/src/components/*, and apps/web/src/lib/*. Build a flight-recorder timeline, not a chatbot or landing page. Start with seeded trace data if live runner data is not ready. Keep all critical proof fields visible in the main demo viewport.

Return files changed, local run command, visual notes, and any screenshot path if captured.
```

## Claude Code Opus Prompt: Runner Reliability

```text
You are working in the Monad Agent Black Box repo. Read docs/AGENT_BLACK_BOX_BUILD_SPEC.md, agent-context/DOWNSTREAM_AGENT_INSTRUCTIONS.md, and tasks/CLAUDE_CODE_OPUS_TASKS.md.

Execute Task C: Runner Reliability Review.

You are not alone in the codebase. Do not revert changes made by others. Own only runner/src/* and shared trace schema files if present. The deterministic scripted demo is mandatory and must work without LLM keys. Verify trace hashing matches on-chain commitments.

Return files changed, commands run, failure modes addressed, and manual smoke test result.
```

## Claude Design Prompt

```text
Design the primary demo UI for Monad Agent Black Box. Read design/CLAUDE_DESIGN_BRIEF.md and docs/AGENT_BLACK_BOX_BUILD_SPEC.md.

Create a polished developer-facing flight-recorder interface for an autonomous on-chain agent. The primary screen must show a timeline, risk debate panel, proof panel, and trace detail drawer. Avoid generic chatbot UI, landing-page hero treatment, and decorative gradient/orb styling. Critical proof fields must be visible in the first viewport.

Deliver a concrete visual spec that an implementation agent can build: layout, components, states, color tokens, typography, spacing, and interaction notes.
```

## GPT-5.5 Final Gate Prompt

```text
Review the finished Monad Agent Black Box repo against docs/AGENT_BLACK_BOX_BUILD_SPEC.md. Take a code-review and demo-readiness stance.

Prioritize:
1. Any mismatch with the Agentic X theme.
2. Any dishonest or unverifiable on-chain proof claim.
3. Any P0 pass/fail criterion not actually satisfied.
4. Any demo path likely to fail live.
5. Contract authorization or trace integrity issues.
6. UI clarity issues that will confuse technical judges.

Return findings first, ordered by severity, with file/line references and minimal fixes. Then give a final go/no-go and the exact 5-minute demo script edits needed.
```

