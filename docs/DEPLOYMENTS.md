# Deployments

## Monad Mainnet

- Network: Monad mainnet
- Chain ID: 143
- Command: `npm run runner:demo:monad`
- Status: no mainnet deployment evidence has been generated in this repository yet.

Latest machine-readable evidence will be written to `deployments/monad-mainnet/latest.json` after a successful run.

Frontend build input:

- Latest public session: `apps/web/public/session-data`
- Committed Monad session: `apps/web/public/monad-mainnet-session`
- Seeded fallback: `apps/web/public/seeded-session`
- Note: `npm run runner:demo:monad` refreshes `runner/out`, then `npm run web:prepare-session` copies the latest public session without deleting the committed Monad mainnet session or seeded fallback.
