import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalizeJson,
  hashTracePayload,
  type JsonValue,
  type TraceEntry
} from "@agent-black-box/trace-schema";

export type StoreResult = {
  sessionDir: string;
  tracePaths: string[];
};

export function writeTraceSession(outDir: string, sessionId: string, traces: TraceEntry[]): StoreResult {
  const sessionDir = join(outDir, "traces", sessionId);
  rmSync(sessionDir, { recursive: true, force: true });
  mkdirSync(sessionDir, { recursive: true });

  const tracePaths: string[] = [];
  for (const trace of traces) {
    const expected = hashTracePayload(trace);
    if (trace.contentHash !== expected) {
      throw new Error(
        `contentHash drift detected for step ${trace.step}: stored ${trace.contentHash} vs recomputed ${expected}`
      );
    }
    const path = join(sessionDir, `${trace.step}.json`);
    const json = `${canonicalizeJson(trace as unknown as JsonValue)}\n`;
    writeFileSync(path, json, { encoding: "utf8" });
    tracePaths.push(path);
  }

  return { sessionDir, tracePaths };
}
