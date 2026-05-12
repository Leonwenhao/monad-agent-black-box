import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hashTracePayload, REQUIRED_TRACE_EVENT_TYPES } from "@agent-black-box/trace-schema";
import { buildScenario } from "./scenario.js";
import { writeTraceSession } from "./traceStore.js";

const sessionId = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const createdAt = "2026-05-12T00:00:00.000Z";
const traceUriBase = `local://traces/${sessionId}`;

test("scenario covers every required trace event type", () => {
  const { traces } = buildScenario({ sessionId, createdAt, traceUriBase });
  const types = new Set(traces.map((t) => t.eventType));
  for (const required of REQUIRED_TRACE_EVENT_TYPES) {
    assert.ok(types.has(required), `missing required event type: ${required}`);
  }
});

test("scenario produces deterministic content hashes across runs", () => {
  const a = buildScenario({ sessionId, createdAt, traceUriBase });
  const b = buildScenario({ sessionId, createdAt, traceUriBase });

  assert.deepEqual(
    a.traces.map((t) => t.contentHash),
    b.traces.map((t) => t.contentHash)
  );
});

test("each stored contentHash matches a fresh re-hash of the canonical payload", () => {
  const { traces } = buildScenario({ sessionId, createdAt, traceUriBase });
  for (const trace of traces) {
    assert.equal(trace.contentHash, hashTracePayload(trace));
  }
});

test("writeTraceSession is idempotent: rerunning produces identical files", () => {
  const baseTmp = mkdtempSync(join(tmpdir(), "runner-trace-"));
  try {
    const { traces } = buildScenario({ sessionId, createdAt, traceUriBase });
    const first = writeTraceSession(baseTmp, sessionId, traces);
    const firstContents = first.tracePaths.map((p) => readFileSync(p, "utf8"));

    const second = writeTraceSession(baseTmp, sessionId, traces);
    const secondContents = second.tracePaths.map((p) => readFileSync(p, "utf8"));

    assert.deepEqual(secondContents, firstContents);
    assert.equal(second.tracePaths.length, traces.length);
  } finally {
    rmSync(baseTmp, { recursive: true, force: true });
  }
});

test("scripted scenario hash list matches a stable snapshot", () => {
  const { traces } = buildScenario({ sessionId, createdAt, traceUriBase });
  const snapshot = traces.map((t) => ({ step: t.step, eventType: t.eventType, contentHash: t.contentHash }));

  for (const entry of snapshot) {
    assert.match(entry.contentHash, /^0x[0-9a-f]{64}$/);
  }

  const expectedTypes = [
    "goal.received",
    "plan.created",
    "tool.simulation",
    "risk.rejection",
    "policy.approved",
    "execution.submitted",
    "execution.confirmed",
    "session.summary"
  ];
  assert.deepEqual(
    snapshot.map((s) => s.eventType),
    expectedTypes
  );
});
