import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getContract,
  http,
  keccak256,
  type Abi,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildScenario, type ScenarioResult } from "./scenario.js";
import type { ChainCommitment } from "./summary.js";

const DEFAULT_ANVIL_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

export type LocalChainSessionArgs = {
  repoRoot: string;
  sessionId: `0x${string}`;
  createdAt: string;
  traceUriBase: string;
};

export type LocalChainSessionResult = {
  scenario: ScenarioResult;
  chain: ChainCommitment;
};

type Artifact = {
  abi: Abi;
  bytecode: Hex;
};

type AnvilRuntime = {
  rpcUrl: string;
  stop: () => Promise<void>;
};

export async function runLocalChainSession(args: LocalChainSessionArgs): Promise<LocalChainSessionResult> {
  const anvil = await getAnvilRuntime();
  try {
    const publicClient = createPublicClient({
      chain: defineChain({
        id: 31337,
        name: "Local Anvil",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [anvil.rpcUrl] } }
      }),
      transport: http(anvil.rpcUrl)
    });
    const chainId = await publicClient.getChainId();
    const chain = defineChain({
      id: chainId,
      name: "Local Anvil",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [anvil.rpcUrl] } }
    });
    const account = privateKeyToAccount(readPrivateKey());
    const walletClient = createWalletClient({ account, chain, transport: http(anvil.rpcUrl) });

    const traceRegistryArtifact = readArtifact(args.repoRoot, "TraceRegistry.sol", "TraceRegistry");
    const demoTreasuryArtifact = readArtifact(args.repoRoot, "DemoTreasuryAction.sol", "DemoTreasuryAction");

    const traceRegistryDeployTx = await walletClient.deployContract({
      abi: traceRegistryArtifact.abi,
      bytecode: traceRegistryArtifact.bytecode,
      account
    });
    const traceRegistryReceipt = await publicClient.waitForTransactionReceipt({ hash: traceRegistryDeployTx });
    if (!traceRegistryReceipt.contractAddress) throw new Error("TraceRegistry deployment did not return an address");

    const demoTreasuryDeployTx = await walletClient.deployContract({
      abi: demoTreasuryArtifact.abi,
      bytecode: demoTreasuryArtifact.bytecode,
      account
    });
    const demoTreasuryReceipt = await publicClient.waitForTransactionReceipt({ hash: demoTreasuryDeployTx });
    if (!demoTreasuryReceipt.contractAddress) throw new Error("DemoTreasuryAction deployment did not return an address");

    const registry = getContract({
      address: traceRegistryReceipt.contractAddress,
      abi: traceRegistryArtifact.abi,
      client: { public: publicClient, wallet: walletClient }
    });
    const demoTreasury = getContract({
      address: demoTreasuryReceipt.contractAddress,
      abi: demoTreasuryArtifact.abi,
      client: { public: publicClient, wallet: walletClient }
    });

    const initialScenario = buildScenario({
      sessionId: args.sessionId,
      createdAt: args.createdAt,
      traceUriBase: args.traceUriBase
    });
    const goalTrace = initialScenario.traces[0];

    const sessionTxHash = await registry.write.startSession([
      args.sessionId,
      account.address,
      goalTrace.contentHash,
      goalTrace.uri,
      `${args.traceUriBase.replace(/\/+$/, "")}/metadata.json`
    ]);
    await publicClient.waitForTransactionReceipt({ hash: sessionTxHash });

    const traceRecordTxHashes: ChainCommitment["traceRecordTxHashes"] = [];
    for (const trace of initialScenario.traces.slice(0, 5)) {
      const txHash = await registry.write.recordTrace([
        args.sessionId,
        trace.step,
        trace.eventType,
        trace.contentHash,
        trace.uri,
        severityFor(trace.eventType)
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      traceRecordTxHashes.push({ step: trace.step, eventType: trace.eventType, txHash });
    }

    const actionArgs = [args.sessionId, 0, 1000n, "scripted-demo"] as const;
    const actionCalldata = encodeFunctionData({
      abi: demoTreasuryArtifact.abi,
      functionName: "executeAction",
      args: actionArgs
    });
    const calldataHash = keccak256(actionCalldata);
    const executionTxHash = await demoTreasury.write.executeAction(actionArgs);
    const executionReceipt = await publicClient.waitForTransactionReceipt({ hash: executionTxHash });

    const finalScenario = buildScenario({
      sessionId: args.sessionId,
      createdAt: args.createdAt,
      traceUriBase: args.traceUriBase,
      execution: {
        target: demoTreasuryReceipt.contractAddress,
        calldataHash,
        txHash: executionTxHash,
        blockNumber: Number(executionReceipt.blockNumber)
      }
    });

    for (const trace of finalScenario.traces.slice(5)) {
      const txHash = await registry.write.recordTrace([
        args.sessionId,
        trace.step,
        trace.eventType,
        trace.contentHash,
        trace.uri,
        severityFor(trace.eventType)
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      traceRecordTxHashes.push({ step: trace.step, eventType: trace.eventType, txHash });
    }

    const executionTrace = finalScenario.traces.find((trace) => trace.eventType === "execution.confirmed");
    const summaryTrace = finalScenario.traces.find((trace) => trace.eventType === "session.summary");
    if (!executionTrace || !summaryTrace) {
      throw new Error("final scenario missing execution or summary trace");
    }

    const linkExecutionTxHash = await registry.write.linkExecution([
      args.sessionId,
      9,
      demoTreasuryReceipt.contractAddress,
      calldataHash,
      executionTxHash,
      2,
      executionTrace.uri
    ]);
    await publicClient.waitForTransactionReceipt({ hash: linkExecutionTxHash });

    const closeSessionTxHash = await registry.write.closeSession([
      args.sessionId,
      summaryTrace.contentHash,
      summaryTrace.uri
    ]);
    await publicClient.waitForTransactionReceipt({ hash: closeSessionTxHash });

    return {
      scenario: finalScenario,
      chain: {
        registryAddress: traceRegistryReceipt.contractAddress,
        demoTreasuryAddress: demoTreasuryReceipt.contractAddress,
        rpcUrl: anvil.rpcUrl,
        ownerAddress: account.address,
        chainId,
        deploymentTxHashes: {
          traceRegistry: traceRegistryDeployTx,
          demoTreasuryAction: demoTreasuryDeployTx
        },
        sessionTxHash,
        traceRecordTxHashes,
        linkExecutionTxHash,
        closeSessionTxHash,
        executionTxHash,
        calldataHash,
        submitted: true,
        note: "local-chain deterministic run completed against Anvil-compatible RPC"
      }
    };
  } finally {
    await anvil.stop();
  }
}

function readPrivateKey(): Hex {
  const value = process.env.RUNNER_PRIVATE_KEY ?? DEFAULT_ANVIL_PRIVATE_KEY;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("RUNNER_PRIVATE_KEY must be a 0x-prefixed 32-byte private key");
  }
  return value as Hex;
}

function readArtifact(repoRoot: string, sourceFile: string, contractName: string): Artifact {
  const artifactPath = resolve(repoRoot, "contracts", "out", sourceFile, `${contractName}.json`);
  const raw = JSON.parse(readFileSync(artifactPath, "utf8")) as {
    abi: Abi;
    bytecode: { object?: string } | string;
  };
  const bytecode = typeof raw.bytecode === "string" ? raw.bytecode : raw.bytecode.object;
  if (!bytecode || !bytecode.startsWith("0x")) {
    throw new Error(`artifact ${artifactPath} is missing 0x bytecode`);
  }
  return { abi: raw.abi, bytecode: bytecode as Hex };
}

async function getAnvilRuntime(): Promise<AnvilRuntime> {
  const providedRpcUrl = process.env.RUNNER_RPC_URL ?? process.env.MONAD_RPC_URL;
  if (providedRpcUrl) {
    await waitForRpc(providedRpcUrl);
    return { rpcUrl: providedRpcUrl, stop: async () => undefined };
  }

  const port = process.env.RUNNER_ANVIL_PORT ?? "8545";
  const rpcUrl = `http://127.0.0.1:${port}`;
  const child = spawn("anvil", ["--host", "127.0.0.1", "--port", port, "--silent"], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stderr: string[] = [];
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  child.on("exit", (code) => {
    if (code !== null && code !== 0) stderr.push(`anvil exited with code ${code}`);
  });

  try {
    await waitForRpc(rpcUrl, () => {
      if (child.exitCode !== null) {
        throw new Error(`anvil failed to start: ${stderr.join("").trim()}`);
      }
    });
  } catch (err) {
    await stopChild(child);
    throw err;
  }

  return { rpcUrl, stop: () => stopChild(child) };
}

async function waitForRpc(rpcUrl: string, tick?: () => void): Promise<void> {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < 10_000) {
    tick?.();
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] })
      });
      if (res.ok) return;
      lastError = `${res.status} ${res.statusText}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`RPC not ready at ${rpcUrl}: ${lastError}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolveStop) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolveStop();
    }, 1000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
  });
}

function severityFor(eventType: string): number {
  if (eventType === "risk.rejection") return 2;
  if (eventType === "tool.simulation") return 1;
  return 0;
}
