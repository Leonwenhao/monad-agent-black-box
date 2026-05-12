import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TraceEntry } from "@agent-black-box/trace-schema";

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
