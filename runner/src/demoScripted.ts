import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toBytes } from "viem";
import { MONAD_TESTNET_CHAIN_ID, MONAD_TESTNET_TARGET, runLocalChainSession, type ChainTarget } from "./chain.js";
import { fail, info, ok, step, warn } from "./log.js";
import { buildScenario } from "./scenario.js";
import { writeTraceSession } from "./traceStore.js";
import { buildSummary, writeSummary, type ChainCommitment, type RunnerSummary } from "./summary.js";

const runnerRoot = resolve(fileURLToPath(import.meta.url), "../..");
const repoRoot = resolve(runnerRoot, "..");
const runnerTargetName = process.env.RUNNER_TARGET ?? "local";
if (runnerTargetName === "monad-testnet") {
  loadDotEnv(resolve(repoRoot, ".env"));
}

async function main(): Promise<void> {
  const target = readRunnerTarget();
  validateTargetConfig(target);
  const sessionId = readBytes32Env(
    "RUNNER_SESSION_ID",
    keccak256(toBytes(`agent-black-box:${Date.now()}:${process.pid}`))
  );
  const createdAt = process.env.RUNNER_CREATED_AT ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error(`RUNNER_CREATED_AT must be parseable as a date (got: ${createdAt})`);
  }

  const outDir = process.env.RUNNER_OUT_DIR
    ? resolve(process.cwd(), process.env.RUNNER_OUT_DIR)
    : resolve(runnerRoot, "out");
  const traceUriBase = process.env.RUNNER_TRACE_URI_BASE ?? `local://traces/${sessionId}`;
  const offline = process.env.RUNNER_OFFLINE === "1";
  if (offline && target.kind === "monad-testnet") {
    throw new Error("RUNNER_OFFLINE=1 cannot be used with RUNNER_TARGET=monad-testnet");
  }

  info(`mode=${offline ? "scripted-offline" : `scripted-${target.kind}`} session=${sessionId}`);
  info(`out=${outDir}`);
  step("scripted mode does not require any LLM API key");

  const { scenario, chain } = offline
    ? runOffline({ sessionId, createdAt, traceUriBase })
    : await runLocalChainSession({ repoRoot, sessionId, createdAt, traceUriBase, target });

  step(`built ${scenario.traces.length} trace events`);
  if (chain.submitted) {
    ok(`${target.chainName} session committed: registry=${chain.registryAddress} treasury=${chain.demoTreasuryAddress}`);
  } else {
    warn(`offline mode: ${chain.note}`);
  }

  const { sessionDir, tracePaths } = writeTraceSession(outDir, sessionId, scenario.traces);
  step(`wrote ${tracePaths.length} trace files to ${sessionDir}`);

  const summaryPath = resolve(outDir, "summary.json");
  const summary = buildSummary({
    mode: chain.submitted ? "scripted-onchain" : "scripted-offline",
    sessionId,
    createdAt,
    traces: scenario.traces,
    chain,
    sessionDir,
    summaryPath,
    tracePaths
  });
  writeSummary(summary);
  ok(`summary written to ${summaryPath}`);
  if (target.kind === "monad-testnet" && summary.chain.chainId === MONAD_TESTNET_CHAIN_ID && summary.chain.submitted) {
    writeMonadDeploymentEvidence(summary);
  }

  process.stdout.write(`${JSON.stringify({ runnerSummary: summary })}\n`);
}

function readRunnerTarget(): ChainTarget {
  if (runnerTargetName === "local") return { kind: "local", chainName: "Local Anvil", requireProvidedRpc: false };
  if (runnerTargetName === "monad-testnet") return MONAD_TESTNET_TARGET;
  throw new Error(`RUNNER_TARGET must be "local" or "monad-testnet" (got: ${runnerTargetName})`);
}

function validateTargetConfig(target: ChainTarget): void {
  if (target.kind !== "monad-testnet") return;
  const missing: string[] = [];
  if (!hasEnv("MONAD_RPC_URL") && !hasEnv("RUNNER_RPC_URL")) {
    missing.push("MONAD_RPC_URL or RUNNER_RPC_URL");
  }
  if (!hasEnv("RUNNER_PRIVATE_KEY")) {
    missing.push("RUNNER_PRIVATE_KEY");
  }
  if (missing.length > 0) {
    throw new Error(`Missing required Monad deployment configuration: ${missing.join("; ")}`);
  }
}

function hasEnv(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && value.trim() !== "";
}

function runOffline(args: {
  sessionId: `0x${string}`;
  createdAt: string;
  traceUriBase: string;
}): { scenario: ReturnType<typeof buildScenario>; chain: ChainCommitment } {
  const scenario = buildScenario(args);
  return {
    scenario,
    chain: readOfflineCommitment(scenario.executionTxHash, scenario.calldataHash)
  };
}

function readBytes32Env(name: string, fallback: `0x${string}`): `0x${string}` {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 0x-prefixed 32-byte hex string (got: ${value})`);
  }
  return value as `0x${string}`;
}

function readOfflineCommitment(
  executionTxHash: `0x${string}`,
  calldataHash: `0x${string}`
): ChainCommitment {
  return {
    registryAddress: null,
    demoTreasuryAddress: null,
    rpcUrl: null,
    ownerAddress: null,
    chainId: null,
    deploymentTxHashes: {
      traceRegistry: null,
      demoTreasuryAction: null
    },
    sessionTxHash: null,
    traceRecordTxHashes: [],
    linkExecutionTxHash: null,
    closeSessionTxHash: null,
    executionTxHash,
    calldataHash,
    submitted: false,
    note: "RUNNER_OFFLINE=1 selected; trace hashes are deterministic and ready for replay without chain access"
  };
}

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquoteEnvValue(rawValue.trim());
  }
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function writeMonadDeploymentEvidence(summary: RunnerSummary): void {
  const explorerBase = (
    process.env.MONAD_EXPLORER_BASE_URL
    ?? process.env.VITE_MONAD_EXPLORER_BASE_URL
    ?? "https://testnet.monadexplorer.com"
  ).replace(/\/+$/, "");
  const deploymentDir = resolve(repoRoot, "deployments", "monad-testnet");
  mkdirSync(deploymentDir, { recursive: true });
  const evidence = {
    network: "Monad testnet",
    chainId: summary.chain.chainId,
    runTimestamp: summary.createdAt,
    command: "npm run runner:demo:monad",
    sessionId: summary.sessionId,
    contracts: {
      traceRegistry: {
        address: summary.chain.registryAddress,
        deploymentTxHash: summary.chain.deploymentTxHashes.traceRegistry,
        deploymentTxExplorerUrl: txEntry(explorerBase, summary.chain.deploymentTxHashes.traceRegistry).explorerUrl,
        explorerUrl: addressUrl(explorerBase, summary.chain.registryAddress)
      },
      demoTreasuryAction: {
        address: summary.chain.demoTreasuryAddress,
        deploymentTxHash: summary.chain.deploymentTxHashes.demoTreasuryAction,
        deploymentTxExplorerUrl: txEntry(explorerBase, summary.chain.deploymentTxHashes.demoTreasuryAction).explorerUrl,
        explorerUrl: addressUrl(explorerBase, summary.chain.demoTreasuryAddress)
      }
    },
    transactions: {
      startSession: txEntry(explorerBase, summary.chain.sessionTxHash),
      traceRecords: summary.chain.traceRecordTxHashes.map((tx) => ({
        step: tx.step,
        eventType: tx.eventType,
        ...txEntry(explorerBase, tx.txHash)
      })),
      execution: txEntry(explorerBase, summary.chain.executionTxHash),
      linkExecution: txEntry(explorerBase, summary.chain.linkExecutionTxHash),
      closeSession: txEntry(explorerBase, summary.chain.closeSessionTxHash)
    },
    runnerOutput: {
      summaryPath: "runner/out/summary.json",
      sessionDir: `runner/out/traces/${summary.sessionId}`
    },
    frontendBuildInput: {
      latestSessionPath: "apps/web/public/session-data",
      committedMonadSessionPath: "apps/web/public/monad-testnet-session",
      seededFallbackPath: "apps/web/public/seeded-session",
      note: "npm run runner:demo:monad refreshes runner/out, then npm run web:prepare-session copies the latest public session without deleting the committed Monad session or seeded fallback."
    }
  };
  writeFileSync(resolve(deploymentDir, "latest.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  writeFileSync(resolve(repoRoot, "docs", "DEPLOYMENTS.md"), deploymentMarkdown(evidence), "utf8");
  ok("Monad deployment evidence written to deployments/monad-testnet/latest.json and docs/DEPLOYMENTS.md");
}

function txEntry(explorerBase: string, txHash: string | null): { txHash: string | null; explorerUrl: string | null } {
  return {
    txHash,
    explorerUrl: txHash ? `${explorerBase}/tx/${txHash}` : null
  };
}

function addressUrl(explorerBase: string, address: string | null): string | null {
  return address ? `${explorerBase}/address/${address}` : null;
}

function deploymentMarkdown(evidence: ReturnType<typeof buildDeploymentEvidenceShape>): string {
  const traceRegistry = evidence.contracts.traceRegistry;
  const demoTreasury = evidence.contracts.demoTreasuryAction;
  return `# Deployments

## Monad Testnet

- Network: ${evidence.network}
- Chain ID: ${evidence.chainId}
- Run timestamp: ${evidence.runTimestamp}
- Command: \`${evidence.command}\`
- Session ID: \`${evidence.sessionId}\`
- TraceRegistry: \`${traceRegistry.address}\`
- TraceRegistry deploy tx: ${markdownLink(traceRegistry.deploymentTxHash, traceRegistry.deploymentTxExplorerUrl)}
- DemoTreasuryAction: \`${demoTreasury.address}\`
- DemoTreasuryAction deploy tx: ${markdownLink(demoTreasury.deploymentTxHash, demoTreasury.deploymentTxExplorerUrl)}
- Start session tx: ${markdownLink(evidence.transactions.startSession.txHash, evidence.transactions.startSession.explorerUrl)}
- Execution tx: ${markdownLink(evidence.transactions.execution.txHash, evidence.transactions.execution.explorerUrl)}
- Link execution tx: ${markdownLink(evidence.transactions.linkExecution.txHash, evidence.transactions.linkExecution.explorerUrl)}
- Close session tx: ${markdownLink(evidence.transactions.closeSession.txHash, evidence.transactions.closeSession.explorerUrl)}

Latest machine-readable evidence: [deployments/monad-testnet/latest.json](../deployments/monad-testnet/latest.json)

Frontend build input:

- Latest public session: \`${evidence.frontendBuildInput.latestSessionPath}\`
- Committed Monad session: \`${evidence.frontendBuildInput.committedMonadSessionPath}\`
- Seeded fallback: \`${evidence.frontendBuildInput.seededFallbackPath}\`
- Note: ${evidence.frontendBuildInput.note}
`;
}

function buildDeploymentEvidenceShape() {
  return {
    network: "",
    chainId: 0 as number | null,
    runTimestamp: "",
    command: "",
    sessionId: "",
    contracts: {
      traceRegistry: {
        address: "" as string | null,
        deploymentTxHash: "" as string | null,
        deploymentTxExplorerUrl: "" as string | null,
        explorerUrl: "" as string | null
      },
      demoTreasuryAction: {
        address: "" as string | null,
        deploymentTxHash: "" as string | null,
        deploymentTxExplorerUrl: "" as string | null,
        explorerUrl: "" as string | null
      }
    },
    transactions: {
      startSession: { txHash: "" as string | null, explorerUrl: "" as string | null },
      traceRecords: [] as Array<{ step: number; eventType: string; txHash: string | null; explorerUrl: string | null }>,
      execution: { txHash: "" as string | null, explorerUrl: "" as string | null },
      linkExecution: { txHash: "" as string | null, explorerUrl: "" as string | null },
      closeSession: { txHash: "" as string | null, explorerUrl: "" as string | null }
    },
    runnerOutput: { summaryPath: "", sessionDir: "" },
    frontendBuildInput: { latestSessionPath: "", committedMonadSessionPath: "", seededFallbackPath: "", note: "" }
  };
}

function markdownLink(label: string | null, href: string | null): string {
  if (!label) return "`null`";
  if (!href) return `\`${label}\``;
  return `[\`${label}\`](${href})`;
}

function writeGoal8FailureLog(message: string): void {
  if (runnerTargetName !== "monad-testnet") return;
  const logPath = resolve(repoRoot, "docs", "dev", "test_logs", "goal8-monad-deploy.log");
  mkdirSync(dirname(logPath), { recursive: true });
  const body = [
    "# Goal 8 Monad Deploy Failure",
    "",
    `timestamp: ${new Date().toISOString()}`,
    "command: npm run runner:demo:monad",
    `error: ${sanitizeSecretValues(message)}`,
    ""
  ].join("\n");
  writeFileSync(logPath, body, "utf8");
}

function sanitizeSecretValues(value: string): string {
  let sanitized = value;
  sanitized = sanitized.split(repoRoot).join("[repo]");
  for (const key of ["RUNNER_PRIVATE_KEY", "MONAD_RPC_URL", "RUNNER_RPC_URL"]) {
    const secret = process.env[key];
    if (secret) {
      sanitized = sanitized.split(secret).join(`[redacted ${key}]`);
      if (key === "RUNNER_PRIVATE_KEY") {
        sanitized = sanitized.replace(new RegExp(escapeRegExp(secret), "gi"), `[redacted ${key}]`);
      }
    }
  }
  return sanitized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

try {
  await main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? err.stack : undefined;
  writeGoal8FailureLog(message);
  fail(sanitizeSecretValues(message));
  if (stack && process.env.RUNNER_DEBUG === "1") {
    process.stderr.write(`${sanitizeSecretValues(stack)}\n`);
  }
  process.exit(1);
}
