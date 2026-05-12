# Monad Agent Black Box

Agent Black Box is accountability infrastructure for autonomous on-chain agents on Monad.

Instead of asking users to trust an agent's final transaction, the project records the agent's decision path as a verifiable flight recorder: goal, plan, simulation, risk rejection, policy approval, execution request, execution receipt, and final reputation evidence. Each trace event is canonicalized, hashed, and designed to be committed to a Solidity registry so the frontend can prove that the readable JSON matches the on-chain commitment.

Live demo: <https://dist-indol-one-13.vercel.app>

## What It Demos

- A judge-facing flight recorder UI for autonomous agent executions.
- A trace schema that makes every agent step inspectable and replayable.
- Solidity contracts for anchoring trace hashes and linking execution transactions.
- A deterministic runner that can execute the demo locally or against Monad.
- ERC-8004 framing for agent identity, endpoints, trace sessions, and reputation evidence.
- A bundled 8004scan catalog snapshot so the UI can show Monad-native agent context without depending on a live indexer during the demo.

The current committed public trace bundle includes the prior Monad testnet session and a seeded local replay fallback. The `dev` branch also contains the mainnet runner path for Monad chain ID `143`; fresh mainnet evidence is written after a successful `npm run runner:demo:monad`.

## Architecture

- `contracts/`: Foundry contracts.
  - `TraceRegistry.sol` records sessions, per-step content hashes, and execution links.
  - `DemoTreasuryAction.sol` is the bounded action used by the demo scenario.
- `packages/trace-schema/`: Canonical trace payload validation and hashing.
- `runner/`: TypeScript runner that creates trace events, deploys/contracts if needed, submits trace commitments, and writes public session artifacts.
- `apps/web/`: Vite/React frontend for the Agent Black Box viewer.
- `apps/web/public/catalog/`: Static ERC-8004/8004scan catalog snapshot used by the UI.

## Demo Flow

1. The agent receives a treasury goal.
2. The planner proposes both an unsafe unlimited approval and a bounded safe action.
3. The simulator evaluates both candidates before execution.
4. The risk agent rejects the unsafe path.
5. Policy approves only the bounded action.
6. The executor submits the approved action.
7. The runner links the execution receipt to the trace session.
8. The UI recomputes each trace hash and shows whether it matches the stored commitment.

## Prerequisites

- Node.js `>=20.19.0`
- npm `>=10.0.0`
- Foundry for contract builds: <https://book.getfoundry.sh/getting-started/installation>

## Setup

```sh
npm install
cp .env.example .env
```

## Common Commands

```sh
# Compile the Solidity contracts.
npm run contracts:build

# Run the deterministic local-chain demo and refresh frontend session data.
npm run runner:demo

# Run the Monad deployment/session runner.
npm run runner:demo:monad

# Refresh the bundled 8004scan catalog snapshot.
npm run web:scrape-8004scan-catalog

# Start the frontend locally.
npm run web:dev

# Build the frontend.
npm run web:build
```

For no-chain replay only:

```sh
RUNNER_OFFLINE=1 npm run runner:demo
```

## Monad Deployment

Copy `.env.example` to `.env`, then configure:

```sh
MONAD_RPC_URL=
RUNNER_PRIVATE_KEY=
TRACE_REGISTRY_ADDRESS=
DEMO_TREASURY_ACTION_ADDRESS=
```

`npm run runner:demo:monad` refuses to use the default Anvil private key on Monad, checks the live chain ID before submitting transactions, writes complete runner output to `runner/out`, and writes deployment evidence under `deployments/` plus `docs/DEPLOYMENTS.md`.

The frontend build uses this priority order for public session data:

1. `runner/out` from the latest local or Monad run.
2. A committed Monad session bundle when present.
3. `apps/web/public/seeded-session` as a fallback replay.

## Vercel

Build command:

```sh
npm run web:build
```

Output directory:

```sh
apps/web/dist
```

The app is static after build. It does not require server-side secrets in Vercel because public session artifacts and catalog data are bundled under `apps/web/public`.

## Planning Artifacts

- [docs/AGENT_BLACK_BOX_BUILD_SPEC.md](docs/AGENT_BLACK_BOX_BUILD_SPEC.md)
- [tasks/GPT54_GOALS.md](tasks/GPT54_GOALS.md)
- [tasks/CLAUDE_CODE_OPUS_TASKS.md](tasks/CLAUDE_CODE_OPUS_TASKS.md)
- [design/CLAUDE_DESIGN_BRIEF.md](design/CLAUDE_DESIGN_BRIEF.md)
