import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTraceEntry,
  assertTraceEntryInput,
  canonicalTracePayload,
  canonicalizeJson,
  createTraceEntry,
  hashTracePayload,
  isBytes32Hex,
  type TraceEntryInput
} from "./index.js";

const baseTrace: TraceEntryInput = {
  sessionId: "0x1111111111111111111111111111111111111111111111111111111111111111",
  step: 3,
  eventType: "risk.rejection",
  role: "risk-agent",
  summary: "Rejected Strategy A because it requested unlimited approval.",
  input: {
    target: "0x2222222222222222222222222222222222222222",
    candidateAction: "Strategy A"
  },
  output: {
    recommendation: "reject",
    reasonCodes: ["UNLIMITED_APPROVAL", "UNVERIFIED_TARGET"],
    riskLevel: "critical"
  },
  model: {
    provider: "deterministic-demo",
    model: "scripted-v1"
  },
  uri: "local://traces/session-1/3.json",
  createdAt: "2026-05-12T00:00:00.000Z"
};

test("canonicalizeJson sorts object keys recursively", () => {
  const first = canonicalizeJson({
    z: 1,
    a: {
      y: true,
      b: ["x", { d: 4, c: 3 }]
    }
  });
  const second = canonicalizeJson({
    a: {
      b: ["x", { c: 3, d: 4 }],
      y: true
    },
    z: 1
  });

  assert.equal(first, second);
  assert.equal(first, "{\"a\":{\"b\":[\"x\",{\"c\":3,\"d\":4}],\"y\":true},\"z\":1}");
});

test("hashTracePayload is stable across object insertion order", () => {
  const reordered: TraceEntryInput = {
    createdAt: baseTrace.createdAt,
    uri: baseTrace.uri,
    model: {
      model: "scripted-v1",
      provider: "deterministic-demo"
    },
    output: {
      riskLevel: "critical",
      reasonCodes: ["UNLIMITED_APPROVAL", "UNVERIFIED_TARGET"],
      recommendation: "reject"
    },
    input: {
      candidateAction: "Strategy A",
      target: "0x2222222222222222222222222222222222222222"
    },
    summary: baseTrace.summary,
    role: baseTrace.role,
    eventType: baseTrace.eventType,
    step: baseTrace.step,
    sessionId: baseTrace.sessionId
  };

  assert.equal(canonicalTracePayload(baseTrace), canonicalTracePayload(reordered));
  assert.equal(hashTracePayload(baseTrace), hashTracePayload(reordered));
});

test("hashTracePayload returns Solidity bytes32-compatible hex", () => {
  const hash = hashTracePayload(baseTrace);

  assert.equal(hash.length, 66);
  assert.ok(isBytes32Hex(hash));
});

test("createTraceEntry produces a self-validating trace entry", () => {
  const trace = createTraceEntry(baseTrace);

  assert.equal(trace.contentHash, hashTracePayload(baseTrace));
  assertTraceEntry(trace);
});

test("contentHash is excluded from canonical payload to avoid circular hashing", () => {
  const trace = createTraceEntry(baseTrace);

  assert.equal(hashTracePayload(trace), trace.contentHash);
});

test("bad or missing fields are rejected", () => {
  assert.throws(() => assertTraceEntryInput({ ...baseTrace, step: -1 }), /trace.step/);
  assert.throws(() => assertTraceEntryInput({ ...baseTrace, eventType: "unknown.event" }), /eventType/);
  assert.throws(() => assertTraceEntryInput({ ...baseTrace, summary: "" }), /summary/);
  assert.throws(() => assertTraceEntryInput({ ...baseTrace, input: [] }), /trace.input/);
  assert.throws(() => assertTraceEntry({ ...baseTrace, contentHash: "0x1234" }), /contentHash/);
});
