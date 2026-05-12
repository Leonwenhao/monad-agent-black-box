# Monad Agent Black Box

Hackathon project workspace for Monad Blitz x The Mu V2: Agentic X.

> Agents are about to move money and make decisions on-chain. Monad Agent Black Box makes every agent decision inspectable, replayable, and accountable.

## Workspaces

- `contracts/`: Foundry Solidity workspace with `TraceRegistry.sol` and `DemoTreasuryAction.sol`.
- `runner/`: TypeScript runner workspace for deterministic local-chain demo execution.
- `apps/web/`: Vite/React frontend workspace for the judge-facing flight-recorder UI.

## Prerequisites

- Node.js `>=20.19.0`
- npm `>=10.0.0`
- Foundry for contract builds: <https://book.getfoundry.sh/getting-started/installation>

Foundry is an external toolchain dependency. Install it before running `npm run contracts:build`; the Node workspaces install through npm.

## Setup

```sh
npm install
cp .env.example .env
```

## Commands

```sh
# Compile the Foundry contracts.
npm run contracts:build

# Run the deterministic local-chain runner.
npm run runner:demo

# Start the frontend locally.
npm run web:dev

# Build the frontend.
npm run web:build
```

`npm run runner:demo` compiles the schema and contracts, starts a local Anvil
chain when no `RUNNER_RPC_URL` is provided, deploys `TraceRegistry` and
`DemoTreasuryAction`, records the scripted trace session, executes the demo
action, links the final transaction, and writes `runner/out/summary.json`.

For no-chain replay only:

```sh
RUNNER_OFFLINE=1 npm run runner:demo
```

## Planning Artifacts

- [docs/AGENT_BLACK_BOX_BUILD_SPEC.md](docs/AGENT_BLACK_BOX_BUILD_SPEC.md)
- [tasks/GPT54_GOALS.md](tasks/GPT54_GOALS.md)
- [tasks/CLAUDE_CODE_OPUS_TASKS.md](tasks/CLAUDE_CODE_OPUS_TASKS.md)
- [design/CLAUDE_DESIGN_BRIEF.md](design/CLAUDE_DESIGN_BRIEF.md)
