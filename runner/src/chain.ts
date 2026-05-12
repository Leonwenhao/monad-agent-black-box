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
  webSocket,
  type Abi,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildScenario, type ScenarioResult } from "./scenario.js";
import type { ChainCommitment } from "./summary.js";

const DEFAULT_ANVIL_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const LOCAL_ANVIL_CHAIN_ID = 31337;
export const MONAD_MAINNET_CHAIN_ID = 143;

export type ChainTarget = {
  kind: "local" | "monad-mainnet";
  chainName: string;
  expectedChainId?: number;
  requireProvidedRpc: boolean;
};

export const LOCAL_CHAIN_TARGET: ChainTarget = {
  kind: "local",
  chainName: "Local Anvil",
  requireProvidedRpc: false
};

export const MONAD_MAINNET_TARGET: ChainTarget = {
  kind: "monad-mainnet",
  chainName: "Monad mainnet",
  expectedChainId: MONAD_MAINNET_CHAIN_ID,
  requireProvidedRpc: true
};

export type LocalChainSessionArgs = {
  repoRoot: string;
  sessionId: `0x${string}`;
  createdAt: string;
  traceUriBase: string;
  target?: ChainTarget;
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
  provided: boolean;
  stop: () => Promise<void>;
};

export async function runLocalChainSession(args: LocalChainSessionArgs): Promise<LocalChainSessionResult> {
  const target = args.target ?? LOCAL_CHAIN_TARGET;
  const anvil = await getAnvilRuntime(target);
  try {
    const publicClient = createPublicClient({
      chain: defineChain({
        id: target.expectedChainId ?? LOCAL_ANVIL_CHAIN_ID,
        name: target.chainName,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: rpcUrlsFor(anvil.rpcUrl)
      }),
      transport: transportFor(anvil.rpcUrl)
    });
    const chainId = await publicClient.getChainId();
    assertExpectedChain(target, chainId);
    const chain = defineChain({
      id: chainId,
      name: chainNameFor(target, chainId),
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: rpcUrlsFor(anvil.rpcUrl)
    });
    const account = privateKeyToAccount(readPrivateKey({ chainId, rpcProvided: anvil.provided }));
    await assertFundedAccount({
      publicClient,
      address: account.address,
      chainId,
      target
    });
    const walletClient = createWalletClient({ account, chain, transport: transportFor(anvil.rpcUrl) });

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
        note: completionNoteFor(target, chainId)
      }
    };
  } finally {
    await anvil.stop();
  }
}

function readPrivateKey(args: { chainId: number; rpcProvided: boolean }): Hex {
  const configured = process.env.RUNNER_PRIVATE_KEY;
  const value = configured === undefined || configured === "" ? DEFAULT_ANVIL_PRIVATE_KEY : configured;
  if ((configured === undefined || configured === "") && (args.rpcProvided || args.chainId !== LOCAL_ANVIL_CHAIN_ID)) {
    throw new Error(
      `RUNNER_PRIVATE_KEY is required for non-local RPC chain ID ${args.chainId}; refusing to use the default Anvil private key`
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("RUNNER_PRIVATE_KEY must be a 0x-prefixed 32-byte private key");
  }
  if (args.chainId !== LOCAL_ANVIL_CHAIN_ID && value.toLowerCase() === DEFAULT_ANVIL_PRIVATE_KEY.toLowerCase()) {
    throw new Error(`Refusing to use the default Anvil private key on non-local chain ID ${args.chainId}`);
  }
  return value as Hex;
}

async function assertFundedAccount(args: {
  publicClient: ReturnType<typeof createPublicClient>;
  address: `0x${string}`;
  chainId: number;
  target: ChainTarget;
}): Promise<void> {
  if (args.target.kind === "local" && args.chainId === LOCAL_ANVIL_CHAIN_ID) return;
  const balance = await args.publicClient.getBalance({ address: args.address });
  if (balance === 0n) {
    throw new Error(
      `RUNNER_PRIVATE_KEY account has zero native-token balance on chain ID ${args.chainId}; fund it before deployment`
    );
  }
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

async function getAnvilRuntime(target: ChainTarget): Promise<AnvilRuntime> {
  const providedRpcUrl = firstNonEmpty(process.env.RUNNER_RPC_URL, process.env.MONAD_RPC_URL);
  if (providedRpcUrl) {
    await waitForRpc(providedRpcUrl);
    return { rpcUrl: providedRpcUrl, provided: true, stop: async () => undefined };
  }

  if (target.requireProvidedRpc) {
    throw new Error("MONAD_RPC_URL or RUNNER_RPC_URL is required for Monad deployment");
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

  return { rpcUrl, provided: false, stop: () => stopChild(child) };
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function transportFor(rpcUrl: string) {
  return isWebSocketRpc(rpcUrl) ? webSocket(rpcUrl) : http(rpcUrl);
}

function rpcUrlsFor(rpcUrl: string) {
  if (isWebSocketRpc(rpcUrl)) return { default: { http: [], webSocket: [rpcUrl] } };
  return { default: { http: [rpcUrl] } };
}

function isWebSocketRpc(rpcUrl: string): boolean {
  return rpcUrl.startsWith("ws://") || rpcUrl.startsWith("wss://");
}

async function waitForRpc(rpcUrl: string, tick?: () => void): Promise<void> {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < 10_000) {
    tick?.();
    try {
      await pingRpc(rpcUrl);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`RPC not ready at ${rpcUrl}: ${lastError}`);
}

async function pingRpc(rpcUrl: string): Promise<void> {
  if (isWebSocketRpc(rpcUrl)) {
    const client = createPublicClient({
      chain: defineChain({
        id: MONAD_MAINNET_CHAIN_ID,
        name: "RPC health check",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: rpcUrlsFor(rpcUrl)
      }),
      transport: transportFor(rpcUrl)
    });
    await client.getChainId();
    return;
  }

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] })
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
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

function assertExpectedChain(target: ChainTarget, chainId: number): void {
  if (target.expectedChainId !== undefined && chainId !== target.expectedChainId) {
    throw new Error(
      `RPC chain ID ${chainId} does not match expected ${target.expectedChainId} for ${target.chainName}; refusing to submit transactions`
    );
  }
}

function chainNameFor(target: ChainTarget, chainId: number): string {
  if (chainId === MONAD_MAINNET_CHAIN_ID) return "Monad mainnet";
  if (chainId === LOCAL_ANVIL_CHAIN_ID) return "Local Anvil";
  return target.chainName;
}

function completionNoteFor(target: ChainTarget, chainId: number): string {
  if (target.kind === "monad-mainnet") {
    return `Monad mainnet deterministic run completed on chain ID ${chainId}`;
  }
  return "local-chain deterministic run completed against Anvil-compatible RPC";
}
