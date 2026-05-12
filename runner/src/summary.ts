import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TraceEntry } from "@agent-black-box/trace-schema";

export type AgentEndpoint = {
  type: "mcp" | "http" | "x402" | "a2a";
  label: string;
  uri: string;
};

export type AgentIdentity = {
  standard: "ERC-8004";
  agentId: string;
  name: string;
  description: string;
  identityRegistry: string;
  reputationRegistry: string;
  agentWallet: string | null;
  agentCardUri: string;
  endpoints: AgentEndpoint[];
  trustModels: string[];
};

export type ChainCommitment = {
  registryAddress: string | null;
  demoTreasuryAddress: string | null;
  rpcUrl: string | null;
  ownerAddress: string | null;
  chainId: number | null;
  deploymentTxHashes: {
    traceRegistry: `0x${string}` | null;
    demoTreasuryAction: `0x${string}` | null;
  };
  sessionTxHash: `0x${string}` | null;
  traceRecordTxHashes: Array<{ step: number; eventType: string; txHash: `0x${string}` }>;
  linkExecutionTxHash: `0x${string}` | null;
  closeSessionTxHash: `0x${string}` | null;
  executionTxHash: `0x${string}`;
  calldataHash: `0x${string}`;
  submitted: boolean;
  note: string;
};

export type RunnerSummary = {
  mode: "scripted-offline" | "scripted-onchain";
  runner: { name: string; version: string };
  sessionId: string;
  createdAt: string;
  eventCount: number;
  traces: Array<{ step: number; eventType: string; contentHash: string; uri: string; role: string }>;
  agentIdentity: AgentIdentity;
  chain: ChainCommitment;
  outputs: { sessionDir: string; summaryPath: string; tracePaths: string[] };
};

export function buildSummary(args: {
  mode: RunnerSummary["mode"];
  sessionId: string;
  createdAt: string;
  traces: TraceEntry[];
  chain: ChainCommitment;
  sessionDir: string;
  summaryPath: string;
  tracePaths: string[];
}): RunnerSummary {
  return {
    mode: args.mode,
    runner: { name: "@agent-black-box/runner", version: "0.1.0" },
    sessionId: args.sessionId,
    createdAt: args.createdAt,
    eventCount: args.traces.length,
    traces: args.traces.map((t) => ({
      step: t.step,
      eventType: t.eventType,
      contentHash: t.contentHash,
      uri: t.uri,
      role: t.role
    })),
    agentIdentity: buildAgentIdentity(args.chain.ownerAddress),
    chain: args.chain,
    outputs: {
      sessionDir: args.sessionDir,
      summaryPath: args.summaryPath,
      tracePaths: args.tracePaths
    }
  };
}

export function writeSummary(summary: RunnerSummary): void {
  mkdirSync(dirname(summary.outputs.summaryPath), { recursive: true });
  writeFileSync(summary.outputs.summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

function buildAgentIdentity(agentWallet: string | null): AgentIdentity {
  return {
    standard: "ERC-8004",
    agentId: "demo-treasury-agent",
    name: "Demo Treasury Agent",
    description: "Scripted treasury agent used to prove that every major autonomous decision has a replayable trace.",
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    agentWallet,
    agentCardUri: "local://agent-cards/demo-treasury-agent.json",
    endpoints: [
      {
        type: "mcp",
        label: "Trace recorder MCP",
        uri: "mcp://agent-black-box/start_trace_session"
      },
      {
        type: "x402",
        label: "Paid verification report",
        uri: "/api/verify/demo-treasury-agent"
      }
    ],
    trustModels: ["trace-session-proof", "human-readable-json", "onchain-content-hash"]
  };
}
