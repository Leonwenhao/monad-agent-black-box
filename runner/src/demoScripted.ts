import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toBytes } from "viem";
import { runLocalChainSession } from "./chain.js";
import { fail, info, ok, step, warn } from "./log.js";
import { buildScenario } from "./scenario.js";
import { writeTraceSession } from "./traceStore.js";
import { buildSummary, writeSummary, type ChainCommitment } from "./summary.js";

async function main(): Promise<void> {
  const sessionId = readBytes32Env(
    "RUNNER_SESSION_ID",
    keccak256(toBytes(`agent-black-box:${Date.now()}:${process.pid}`))
  );
  const createdAt = process.env.RUNNER_CREATED_AT ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error(`RUNNER_CREATED_AT must be parseable as a date (got: ${createdAt})`);
  }

  const runnerRoot = resolve(fileURLToPath(import.meta.url), "../..");
  const repoRoot = resolve(runnerRoot, "..");
  const outDir = process.env.RUNNER_OUT_DIR
    ? resolve(process.cwd(), process.env.RUNNER_OUT_DIR)
    : resolve(runnerRoot, "out");
  const traceUriBase = process.env.RUNNER_TRACE_URI_BASE ?? `local://traces/${sessionId}`;
  const offline = process.env.RUNNER_OFFLINE === "1";

  info(`mode=${offline ? "scripted-offline" : "scripted-local-chain"} session=${sessionId}`);
  info(`out=${outDir}`);
  step("scripted mode does not require any LLM API key");

  const { scenario, chain } = offline
    ? runOffline({ sessionId, createdAt, traceUriBase })
    : await runLocalChainSession({ repoRoot, sessionId, createdAt, traceUriBase });

  step(`built ${scenario.traces.length} trace events`);
  if (chain.submitted) {
    ok(`local-chain session committed: registry=${chain.registryAddress} treasury=${chain.demoTreasuryAddress}`);
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

  process.stdout.write(`${JSON.stringify({ runnerSummary: summary })}\n`);
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

try {
  await main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? err.stack : undefined;
  fail(message);
  if (stack && process.env.RUNNER_DEBUG === "1") {
    process.stderr.write(`${stack}\n`);
  }
  process.exit(1);
}
