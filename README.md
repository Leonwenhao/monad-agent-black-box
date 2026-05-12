# Monad Agent Black Box

Hackathon project workspace for Monad Blitz x The Mu V2: Agentic X.

> Agents are about to move money and make decisions on-chain. Monad Agent Black Box makes every agent decision inspectable, replayable, and accountable.

Live demo: <https://dist-indol-one-13.vercel.app>

The public demo loads the latest Monad testnet session from bundled static
assets and keeps the committed seeded replay fallback available in the UI.

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

# Run the deterministic Monad testnet deployment/session runner.
npm run runner:demo:monad

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

For Monad testnet deployment, copy `.env.example` to `.env`, set
`MONAD_RPC_URL` or `RUNNER_RPC_URL`, set `RUNNER_PRIVATE_KEY`, then run:

```sh
npm run runner:demo:monad
```

The Monad command refuses to use the default Anvil private key, verifies the
live chain ID is `10143` before submitting transactions, writes complete runner
output to `runner/out`, and writes public deployment evidence to
`deployments/monad-testnet/latest.json` and `docs/DEPLOYMENTS.md` on success.
It also refreshes `apps/web/public/session-data` for the frontend. Clean
deploys fall back to the committed Monad testnet session under
`apps/web/public/monad-testnet-session`, while the local seeded replay remains
available under `apps/web/public/seeded-session`.
If any deploy/run step fails, the command writes sanitized failure evidence to
`docs/dev/test_logs/goal8-monad-deploy.log`.

## Planning Artifacts

- [docs/AGENT_BLACK_BOX_BUILD_SPEC.md](docs/AGENT_BLACK_BOX_BUILD_SPEC.md)
- [tasks/GPT54_GOALS.md](tasks/GPT54_GOALS.md)
- [tasks/CLAUDE_CODE_OPUS_TASKS.md](tasks/CLAUDE_CODE_OPUS_TASKS.md)
- [design/CLAUDE_DESIGN_BRIEF.md](design/CLAUDE_DESIGN_BRIEF.md)
