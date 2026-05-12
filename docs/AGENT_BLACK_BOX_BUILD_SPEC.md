# Agent Black Box Master Build Spec

Date: 2026-05-12
Event: Monad Blitz x The Mu V2: Agentic X
Project codename: Monad Agent Black Box

## 1. Product Decision

Build an audit trail and replay layer for autonomous on-chain agents.

One-liner:

> Agents are about to move money on-chain. Agent Black Box makes every autonomous decision inspectable, replayable, and accountable on Monad.

The product is not a trading agent. It is the infrastructure layer that explains, records, and verifies what an agent did before and after touching the chain.

## 2. Why This Fits The Hackathon

The hackathon theme is Agentic X. The strongest stated fit is:

- agent behavior logs and auditable traces
- transaction simulation and explanation agents
- contract interaction risk warnings
- multi-agent debate, such as strategy versus risk
- on-chain data to reports and dashboards
- high-throughput agent workflows interacting with Monad

Agent Black Box should show that Monad can support many small agent trace writes cheaply and quickly enough that accountability can be native to the workflow, not a single after-the-fact summary.

## 3. Demo Promise

In five minutes, the demo must prove:

1. An agent receives a user goal.
2. A planner proposes candidate actions.
3. A risk agent challenges one unsafe path.
4. An executor performs a safe on-chain action.
5. Every major decision is committed to Monad as a trace event.
6. The UI lets judges inspect the timeline and verify hashes against on-chain events.

The exact demo scenario:

> A treasury agent is asked to rebalance a demo wallet. It considers two actions. The risk agent rejects one action because it requires an unsafe approval / excessive exposure. The executor performs the safer demo action. Agent Black Box records the goal, plan, risk objection, simulation result, policy decision, execution transaction, and final outcome.

## 4. Non-Goals

Do not build:

- a real yield optimizer
- a real trading bot
- a generic LangSmith clone
- a production compliance system
- zero-knowledge proofs
- complex attestation standards
- a big agent framework
- audience participation mechanics
- multi-chain support
- real custody of valuable funds

If a downstream coding agent is tempted to expand scope, it must choose the smallest implementation that satisfies the pass/fail criteria.

## 5. MVP Architecture

Components:

1. Contracts
   - `TraceRegistry.sol`: append-only trace session and trace event registry.
   - `DemoTreasuryAction.sol`: simple contract that the executor calls so the demo has a real final transaction.

2. Agent runner
   - Node/TypeScript service or script.
   - Runs the demo scenario.
   - Produces structured trace JSON.
   - Hashes each trace payload.
   - Writes trace events to Monad.
   - Executes the final demo action.
   - Links the execution tx hash back to the trace session.
   - Must support deterministic replay without a live LLM.

3. Frontend
   - Next.js or Vite app.
   - Session list.
   - Flight-recorder timeline.
   - Risk debate panel.
   - On-chain proof panel.
   - Final transaction card.
   - Demo mode that can replay a seeded session if RPC or LLM access fails.

4. Storage
   - MVP: local JSON files served by the app or API.
   - On-chain: hashes and URIs.
   - Optional later: IPFS / Arweave.

## 6. Contract Requirements

### 6.1 TraceRegistry

Primary purpose: record verifiable commitments to off-chain trace entries.

Suggested interface:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TraceRegistry {
    enum Severity {
        Info,
        Warning,
        Critical
    }

    enum TxStatus {
        Proposed,
        Submitted,
        Confirmed,
        Failed
    }

    struct Session {
        address owner;
        address agent;
        uint64 startedAt;
        uint32 eventCount;
        bytes32 goalHash;
        string goalUri;
        bool closed;
    }

    event SessionStarted(
        bytes32 indexed sessionId,
        address indexed owner,
        address indexed agent,
        bytes32 goalHash,
        string goalUri,
        string metadataUri
    );

    event TraceEventRecorded(
        bytes32 indexed sessionId,
        uint32 indexed step,
        string eventType,
        bytes32 contentHash,
        string uri,
        Severity severity
    );

    event ExecutionLinked(
        bytes32 indexed sessionId,
        uint32 indexed step,
        address indexed target,
        bytes32 calldataHash,
        bytes32 txHash,
        TxStatus status,
        string uri
    );

    event SessionClosed(
        bytes32 indexed sessionId,
        uint32 eventCount,
        bytes32 summaryHash,
        string summaryUri
    );

    function startSession(
        bytes32 sessionId,
        address agent,
        bytes32 goalHash,
        string calldata goalUri,
        string calldata metadataUri
    ) external;

    function recordTrace(
        bytes32 sessionId,
        uint32 step,
        string calldata eventType,
        bytes32 contentHash,
        string calldata uri,
        Severity severity
    ) external;

    function linkExecution(
        bytes32 sessionId,
        uint32 step,
        address target,
        bytes32 calldataHash,
        bytes32 txHash,
        TxStatus status,
        string calldata uri
    ) external;

    function closeSession(
        bytes32 sessionId,
        bytes32 summaryHash,
        string calldata summaryUri
    ) external;
}
```

Implementation constraints:

- Store only compact session metadata on-chain.
- Do not store long reasoning text on-chain.
- Only the session owner should write trace events for that session in the MVP.
- Prevent duplicate `sessionId`.
- Prevent recording to missing or closed sessions.
- Keep event fields stable so frontend/indexer can rely on them.
- It is acceptable for `step` order to be enforced off-chain for MVP, but contract should reject obviously repeated `(sessionId, step)` if cheap.

### 6.2 DemoTreasuryAction

Purpose: give the executor a real Monad transaction to perform.

Minimal behavior:

- `executeAction(bytes32 sessionId, uint8 actionType, uint256 amount, string calldata memo)`.
- Emits `DemoActionExecuted`.
- Stores last action per session or per caller.
- Does not need to move real assets.

The final demo transaction can be this action. The backend then calls `TraceRegistry.linkExecution` with the tx hash.

## 7. Trace JSON Schema

Each trace payload should be human-readable JSON and hashable.

Example:

```json
{
  "sessionId": "0x...",
  "step": 3,
  "eventType": "risk.rejection",
  "role": "risk-agent",
  "summary": "Rejected Strategy A because it requested an unlimited approval to an unverified target.",
  "input": {
    "candidateAction": "Strategy A",
    "target": "0x..."
  },
  "output": {
    "riskLevel": "critical",
    "reasonCodes": ["UNLIMITED_APPROVAL", "UNVERIFIED_TARGET"],
    "recommendation": "reject"
  },
  "model": {
    "provider": "deterministic-demo",
    "model": "scripted-v1"
  },
  "contentHash": "0x...",
  "createdAt": "2026-05-12T..."
}
```

Hashing rule:

- Canonicalize JSON before hashing.
- Use `keccak256(bytes(canonicalJson))` or a clearly documented equivalent.
- Store the JSON at a URI that the UI can fetch.
- For MVP, URI may be `/api/traces/{sessionId}/{step}` or `local://traces/...`.

## 8. Required Trace Event Types

Minimum event set for the demo:

1. `goal.received`
2. `plan.created`
3. `tool.simulation`
4. `risk.rejection`
5. `policy.approved`
6. `execution.submitted`
7. `execution.confirmed`
8. `session.summary`

Optional event types:

- `memory.retrieved`
- `debate.argument`
- `human.override`
- `policy.denied`
- `execution.failed`

## 9. Agent Runner Requirements

The runner must have two modes.

### 9.1 Deterministic Demo Mode

This is mandatory.

It uses a scripted set of trace events, sends them to the registry, executes the demo action, and writes trace JSON locally.

Pass condition:

- Demo can run even if OpenAI/Claude API access fails.

### 9.2 LLM-Assisted Mode

This is optional but desirable.

Roles:

- Planner: converts user goal into 2-3 candidate actions.
- Risk agent: evaluates each candidate.
- Executor: picks the approved action and submits the tx.

LLM output must be normalized into the same trace schema as deterministic mode.

Pass condition:

- If LLM output is malformed, the runner falls back to deterministic demo mode and logs a visible warning.

## 10. Frontend Requirements

The frontend is the judge-facing product. It must be more polished than the backend.

Screens:

1. Home / Session List
   - Shows available trace sessions.
   - Primary CTA: "Run Demo Session".
   - Secondary CTA: "Replay Seeded Session".

2. Live Session
   - Large timeline.
   - Current status.
   - Agent role badges.
   - Trace events appear as they are written.

3. Trace Detail Drawer
   - Summary.
   - Role.
   - Content hash.
   - URI.
   - On-chain event link.
   - Raw JSON view.

4. Risk Debate Panel
   - Candidate A rejected.
   - Candidate B approved.
   - Clear reason codes.
   - Policy outcome.

5. Proof Panel
   - Registry address.
   - Session ID.
   - Event count.
   - Execution tx hash.
   - Explorer links.
   - "Hash matches JSON" indicator.

Design direction:

- Think flight recorder / incident review / cybernetic console.
- Dense enough for developers.
- Polished enough for judges.
- Avoid generic AI chatbot UI.
- Avoid landing page fluff.

## 11. Demo Script

Target length: 4 minutes 30 seconds, with 30 seconds buffer.

Script:

1. Problem, 20 seconds
   - "Everyone is building agents that can move assets. The missing layer is accountability."

2. Product, 20 seconds
   - "Agent Black Box records what the agent saw, decided, rejected, executed, and proved on-chain."

3. Start session, 40 seconds
   - Open app.
   - Click "Run Demo Session".
   - Show `goal.received` and `plan.created`.

4. Risk moment, 60 seconds
   - Show two candidate actions.
   - Risk agent rejects unsafe action.
   - Explain reason codes.

5. Execution, 60 seconds
   - Executor submits safe demo tx.
   - Show tx hash.
   - Link execution back to the session.

6. Proof, 60 seconds
   - Click trace event.
   - Show JSON payload.
   - Show content hash.
   - Show on-chain event / explorer link.

7. Monad close, 40 seconds
   - "Agent workflows create many small decisions. Monad makes these traces cheap and fast enough to be first-class on-chain records."

8. Business close, 30 seconds
   - "This becomes audit infrastructure for treasuries, agent wallets, DAO operators, and autonomous protocols."

## 12. Pass/Fail Criteria

### P0: Contract

Pass if:

- Foundry or Hardhat contract tests pass.
- `TraceRegistry.startSession` works.
- At least 8 trace events can be recorded for one session.
- Each trace event includes `sessionId`, `step`, `eventType`, `contentHash`, `uri`, and `severity`.
- A final execution tx can be linked to a session.
- Duplicate session IDs are rejected.
- Missing sessions cannot receive trace events.
- Closed sessions cannot receive new trace events.

Fail if:

- Long reasoning text is stored directly on-chain.
- Anyone can write to someone else's session.
- The final tx hash is not visible in the UI.
- The demo depends on an untested contract path.

### P0: Agent Runner

Pass if:

- `npm run demo:scripted` or equivalent creates a complete session.
- Deterministic mode works with no LLM keys.
- Runner writes local JSON trace payloads.
- Runner computes hashes matching what is recorded on-chain.
- Runner emits or returns deployed addresses and tx hashes.
- Runner can be rerun without manual cleanup.

Fail if:

- A missing API key blocks the core demo.
- Trace hashes in the UI do not match recorded hashes.
- The runner silently drops failed txs.

### P0: Frontend

Pass if:

- App shows at least one completed session.
- App can start or replay a demo session.
- Timeline renders all required trace event types.
- Trace detail view shows raw JSON and hash match status.
- Proof panel shows registry address, session ID, event count, and tx hash.
- UI is usable on laptop projector resolution.

Fail if:

- The app looks like a generic chat app.
- The product cannot be understood without a long verbal explanation.
- The main demo requires refreshing or manually pasting tx hashes.

### P0: Deployment

Pass if:

- Contracts are deployed to Monad testnet.
- Frontend is deployed publicly.
- Demo works against Monad testnet.
- There is a seeded fallback/replay path.
- README contains exact demo instructions.

Fail if:

- Only localhost works.
- Deployed app cannot find contract addresses.
- Demo requires private local files that judges cannot access.

### P1: Polish

Pass if:

- Visual design feels like a flight recorder.
- Timeline has status colors and role badges.
- Risk rejection is visually memorable.
- Demo has screenshots or a screen recording fallback.

Fail if:

- UI is cluttered, unreadable, or visually generic.

## 13. Recommended Repo Structure

Use a monorepo.

```text
monad-agent-black-box/
  apps/
    web/
      src/
        app/
        components/
        lib/
  contracts/
    src/
      TraceRegistry.sol
      DemoTreasuryAction.sol
    test/
    script/
  packages/
    trace-schema/
      src/
  runner/
    src/
      demoScripted.ts
      runLiveAgent.ts
      traceStore.ts
      hashTrace.ts
      chain.ts
  docs/
  tasks/
  design/
```

If time is short, collapse `packages/trace-schema` into `runner/src` and `apps/web/src/lib`.

## 14. Tooling Recommendation

Preferred:

- Next.js or Vite for frontend.
- Foundry for contracts.
- Viem for chain interaction.
- TypeScript everywhere outside Solidity.
- Tailwind for fast design.
- SQLite or JSON files for local trace store.

Avoid:

- complex subgraphs
- custom indexer infrastructure unless necessary
- wallet connection as a core requirement
- account abstraction unless it is already available and easy

## 15. Model Usage Plan

### GPT-5.5

Use for:

- product decisions
- architecture changes
- acceptance criteria updates
- final security/design review
- demo story sharpening

Do not use for:

- repetitive implementation loops
- ordinary lint/test fixes
- large low-judgment file editing

### GPT-5.4 with `/goals`

Use for:

- sustained execution against task files
- implementing bounded modules
- running tests repeatedly
- fixing failures until pass criteria are satisfied

Important local caveat:

- Verify `/goal` is available in an interactive persisted Codex thread before depending on it.
- If `/goal` is missing despite feature flag enablement, restart in the interactive TUI and confirm persisted thread support.

### Claude Code Opus 4.7

Use for:

- high-quality frontend implementation
- contract review
- integration review
- refactors with clear ownership boundaries
- second-opinion bug hunting

Do not give Claude vague product authority. Give bounded tickets and require it to preserve this spec unless explicitly told otherwise.

### Claude Design

Use for:

- visual identity
- layout and interaction design
- demo page polish
- final screenshot/video fallback framing

## 16. Build Order

1. Scaffold repo.
2. Implement contracts and tests.
3. Implement deterministic runner.
4. Implement trace schema/hash utility.
5. Implement frontend seeded replay.
6. Wire frontend to runner/API.
7. Deploy contracts.
8. Run real Monad demo.
9. Polish UI.
10. Record fallback demo video.
11. Final GPT-5.5 gate.

## 17. Final Gate Checklist

Before submission:

- `TraceRegistry` deployed to Monad testnet.
- `DemoTreasuryAction` deployed to Monad testnet.
- At least one complete session exists on testnet.
- Frontend deployed publicly.
- Frontend displays testnet session and proof links.
- README includes deployment addresses.
- Demo can run live.
- Demo can replay if live path fails.
- Five-minute script rehearsed.
- Screenshots/video captured.
- GitHub repo is public.
- Code committed during hackathon window.

