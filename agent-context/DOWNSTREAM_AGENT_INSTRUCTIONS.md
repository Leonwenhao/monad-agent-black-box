# Downstream Agent Instructions

You are implementing Monad Agent Black Box for Monad Blitz x The Mu V2: Agentic X.

Before editing, read:

1. `docs/AGENT_BLACK_BOX_BUILD_SPEC.md`
2. `tasks/GPT54_GOALS.md` if running a Codex `/goal`
3. `tasks/CLAUDE_CODE_OPUS_TASKS.md` if running Claude Code
4. `design/CLAUDE_DESIGN_BRIEF.md` if working on frontend visuals

Hard rules:

- Do not change product scope without explicit approval.
- Build the smallest thing that satisfies the pass/fail criteria.
- Deterministic demo mode is mandatory.
- LLM-assisted mode is optional.
- Do not store long reasoning text on-chain.
- Do not build a trading bot.
- Do not build an audience participation demo.
- Do not add real asset custody.
- Preserve public demo reliability over technical ambition.

If blocked, report:

- exact command run
- exact error
- affected pass/fail criterion
- smallest proposed fix

