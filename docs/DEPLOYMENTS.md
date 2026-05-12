# Deployments

## Monad Testnet

- Network: Monad testnet
- Chain ID: 10143
- Run timestamp: 2026-05-12T06:18:29.908Z
- Command: `npm run runner:demo:monad`
- Session ID: `0x84977d7b9a44a67f3feaef0373c12c67c3f5dfae46aaca18a2efde293a6a3602`
- TraceRegistry: `0x8cac8a133c703a9048adfd7ef6cbf878efa4ed38`
- TraceRegistry deploy tx: [`0x976caf53e25d198fc74d9e701dd81cde1c1ee7907048b16f93c3fd6fc6721105`](https://testnet.monadexplorer.com/tx/0x976caf53e25d198fc74d9e701dd81cde1c1ee7907048b16f93c3fd6fc6721105)
- DemoTreasuryAction: `0x4197dde02b9531495d3cc83dbea2d2156c557fe7`
- DemoTreasuryAction deploy tx: [`0xa41cb5deeab2e71f852aa04bea51dc45de950dc90e3df75c5dcb32254b30526b`](https://testnet.monadexplorer.com/tx/0xa41cb5deeab2e71f852aa04bea51dc45de950dc90e3df75c5dcb32254b30526b)
- Start session tx: [`0xd8916cc39d5f91d91c4df7b540f3dda0aeec072317b31c065d62c312b4647508`](https://testnet.monadexplorer.com/tx/0xd8916cc39d5f91d91c4df7b540f3dda0aeec072317b31c065d62c312b4647508)
- Execution tx: [`0xae057ea7934064be906414ab5c1abd3630adf057343a48278c0a4354cb893374`](https://testnet.monadexplorer.com/tx/0xae057ea7934064be906414ab5c1abd3630adf057343a48278c0a4354cb893374)
- Link execution tx: [`0xbd278987c0b37921f8e6363b80b02ab72d052c5908defcfaef8dc67d6fc27153`](https://testnet.monadexplorer.com/tx/0xbd278987c0b37921f8e6363b80b02ab72d052c5908defcfaef8dc67d6fc27153)
- Close session tx: [`0x5f13c9aa1d1487c359fe6798a51bfd45df893f691f16cd830e348707361f5151`](https://testnet.monadexplorer.com/tx/0x5f13c9aa1d1487c359fe6798a51bfd45df893f691f16cd830e348707361f5151)

Latest machine-readable evidence: [deployments/monad-testnet/latest.json](../deployments/monad-testnet/latest.json)

Frontend build input:

- Latest public session: `apps/web/public/session-data`
- Committed Monad session: `apps/web/public/monad-testnet-session`
- Seeded fallback: `apps/web/public/seeded-session`
- Note: npm run runner:demo:monad refreshes runner/out, then npm run web:prepare-session copies the latest public session without deleting the committed Monad session or seeded fallback.
