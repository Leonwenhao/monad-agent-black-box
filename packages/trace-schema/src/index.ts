import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";

export const REQUIRED_TRACE_EVENT_TYPES = [
  "goal.received",
  "plan.created",
  "tool.simulation",
  "risk.rejection",
  "policy.approved",
  "execution.submitted",
  "execution.confirmed",
  "session.summary"
] as const;

export type RequiredTraceEventType = (typeof REQUIRED_TRACE_EVENT_TYPES)[number];

export type TraceEventType =
  | RequiredTraceEventType
  | "memory.retrieved"
  | "debate.argument"
  | "human.override"
  | "policy.denied"
  | "execution.failed";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type TraceModel = {
  provider: string;
  model: string;
};

export type TraceEntryInput = {
  sessionId: string;
  step: number;
  eventType: TraceEventType;
  role: string;
  summary: string;
  input: JsonObject;
  output: JsonObject;
  model: TraceModel;
  uri: string;
  createdAt: string;
};

export type TraceEntry = TraceEntryInput & {
  contentHash: `0x${string}`;
};

export function createTraceEntry(input: TraceEntryInput): TraceEntry {
  assertTraceEntryInput(input);
  return {
    ...input,
    contentHash: hashTracePayload(input)
  };
}

export function assertTraceEntry(value: unknown): asserts value is TraceEntry {
  assertTraceEntryInput(value);
  const contentHash = (value as { contentHash?: unknown }).contentHash;
  if (!isBytes32Hex(contentHash)) {
    throw new Error("trace.contentHash must be a Solidity bytes32 hex string");
  }
}

export function assertTraceEntryInput(value: unknown): asserts value is TraceEntryInput {
  if (!isObject(value)) {
    throw new Error("trace must be an object");
  }

  assertNonEmptyString(value.sessionId, "trace.sessionId");
  assertUint32(value.step, "trace.step");
  if (!isTraceEventType(value.eventType)) {
    throw new Error("trace.eventType is not supported");
  }
  assertNonEmptyString(value.role, "trace.role");
  assertNonEmptyString(value.summary, "trace.summary");
  assertJsonObject(value.input, "trace.input");
  assertJsonObject(value.output, "trace.output");
  assertModel(value.model);
  assertNonEmptyString(value.uri, "trace.uri");
  assertNonEmptyString(value.createdAt, "trace.createdAt");
  if (Number.isNaN(Date.parse(value.createdAt))) {
    throw new Error("trace.createdAt must be parseable as a date");
  }
}

export function canonicalizeJson(value: JsonValue): string {
  return JSON.stringify(toCanonicalJson(value));
}

export function canonicalTracePayload(input: TraceEntryInput | TraceEntry): string {
  const { contentHash: _contentHash, ...payload } = input as TraceEntry;
  assertTraceEntryInput(payload);
  return canonicalizeJson(payload);
}

export function hashTracePayload(input: TraceEntryInput | TraceEntry): `0x${string}` {
  const canonicalJson = canonicalTracePayload(input);
  return `0x${bytesToHex(keccak_256(new TextEncoder().encode(canonicalJson)))}`;
}

export function isBytes32Hex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isTraceEventType(value: unknown): value is TraceEventType {
  return (
    typeof value === "string"
    && (
      REQUIRED_TRACE_EVENT_TYPES as readonly string[]
    ).concat(["memory.retrieved", "debate.argument", "human.override", "policy.denied", "execution.failed"]).includes(value)
  );
}

function toCanonicalJson(value: JsonValue): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("JSON numbers must be finite");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toCanonicalJson(item));
  }
  if (isObject(value)) {
    const sorted: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child === undefined) {
        throw new Error(`JSON field ${key} is undefined`);
      }
      sorted[key] = toCanonicalJson(child as JsonValue);
    }
    return sorted;
  }
  throw new Error(`unsupported JSON value type: ${typeof value}`);
}

function assertModel(value: unknown): asserts value is TraceModel {
  if (!isObject(value)) {
    throw new Error("trace.model must be an object");
  }
  assertNonEmptyString(value.provider, "trace.model.provider");
  assertNonEmptyString(value.model, "trace.model.model");
}

function assertJsonObject(value: unknown, field: string): asserts value is JsonObject {
  if (!isObject(value) || Array.isArray(value)) {
    throw new Error(`${field} must be a JSON object`);
  }
  toCanonicalJson(value as JsonObject);
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function assertUint32(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${field} must be a uint32 integer`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
