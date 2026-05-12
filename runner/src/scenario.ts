import {
  createTraceEntry,
  REQUIRED_TRACE_EVENT_TYPES,
  type TraceEntry,
  type TraceEntryInput
} from "@agent-black-box/trace-schema";

const MODEL = { provider: "deterministic-demo", model: "scripted-v1" } as const;

export type ScenarioOptions = {
  sessionId: `0x${string}`;
  createdAt: string;
  traceUriBase: string;
  execution?: {
    target: `0x${string}`;
    calldataHash: `0x${string}`;
    txHash: `0x${string}`;
    blockNumber: number;
  };
};

export type ScenarioResult = {
  sessionId: `0x${string}`;
  createdAt: string;
  traces: TraceEntry[];
  executionTxHash: `0x${string}`;
  calldataHash: `0x${string}`;
};

const PLACEHOLDER_EXECUTION_TX_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const PLACEHOLDER_CALLDATA_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export function buildScenario(opts: ScenarioOptions): ScenarioResult {
  const { sessionId, createdAt, traceUriBase } = opts;

  const txHash = opts.execution?.txHash ?? process.env.RUNNER_EXECUTION_TX_HASH ?? PLACEHOLDER_EXECUTION_TX_HASH;
  const calldataHash = opts.execution?.calldataHash ?? process.env.RUNNER_CALLDATA_HASH ?? PLACEHOLDER_CALLDATA_HASH;
  const target = opts.execution?.target ?? "0x0000000000000000000000000000000000000000";
  const blockNumber = opts.execution?.blockNumber ?? 0;
  assertBytes32(txHash, "RUNNER_EXECUTION_TX_HASH");
  assertBytes32(calldataHash, "RUNNER_CALLDATA_HASH");

  const inputs: TraceEntryInput[] = [
    {
      sessionId,
      step: 1,
      eventType: "goal.received",
      role: "user",
      summary: "Rebalance the demo treasury wallet with an inspectable audit trail.",
      input: { goal: "Rebalance the demo treasury wallet." },
      output: { accepted: true },
      model: MODEL,
      uri: traceUri(traceUriBase, 1),
      createdAt
    },
    {
      sessionId,
      step: 2,
      eventType: "plan.created",
      role: "planner",
      summary: "Compare an unsafe unlimited approval path against a safe demo action.",
      input: { candidateCount: 2 },
      output: { candidates: ["unsafe-unlimited-approval", "safe-demo-action"] },
      model: MODEL,
      uri: traceUri(traceUriBase, 2),
      createdAt
    },
    {
      sessionId,
      step: 3,
      eventType: "tool.simulation",
      role: "executor",
      summary: "Simulate both candidate actions against the demo treasury contract.",
      input: {
        candidates: [
          { id: "unsafe-unlimited-approval", actionType: 1, amount: "unlimited" },
          { id: "safe-demo-action", actionType: 0, amount: "1000" }
        ]
      },
      output: {
        simulations: [
          { id: "unsafe-unlimited-approval", revert: false, gas: 65000, exposure: "unbounded" },
          { id: "safe-demo-action", revert: false, gas: 42000, exposure: "bounded" }
        ]
      },
      model: MODEL,
      uri: traceUri(traceUriBase, 3),
      createdAt
    },
    {
      sessionId,
      step: 4,
      eventType: "risk.rejection",
      role: "risk-agent",
      summary: "Reject the unlimited approval path because the target is unverified.",
      input: { candidateAction: "unsafe-unlimited-approval" },
      output: {
        riskLevel: "critical",
        reasonCodes: ["UNLIMITED_APPROVAL", "UNVERIFIED_TARGET"],
        recommendation: "reject"
      },
      model: MODEL,
      uri: traceUri(traceUriBase, 4),
      createdAt
    },
    {
      sessionId,
      step: 5,
      eventType: "policy.approved",
      role: "policy-agent",
      summary: "Approve the safe demo action under the bounded-exposure policy.",
      input: { candidateAction: "safe-demo-action" },
      output: { policy: "bounded-exposure", decision: "approve" },
      model: MODEL,
      uri: traceUri(traceUriBase, 5),
      createdAt
    },
    {
      sessionId,
      step: 6,
      eventType: "execution.submitted",
      role: "executor",
      summary: "Submit the safe demo action to the DemoTreasuryAction contract.",
      input: {
        target,
        actionType: 0,
        amount: "1000",
        memo: "scripted-demo"
      },
      output: { calldataHash, txHash, status: "submitted" },
      model: MODEL,
      uri: traceUri(traceUriBase, 6),
      createdAt
    },
    {
      sessionId,
      step: 7,
      eventType: "execution.confirmed",
      role: "executor",
      summary: "Confirm inclusion of the safe demo action transaction.",
      input: { txHash },
      output: { status: "confirmed", blockNumber },
      model: MODEL,
      uri: traceUri(traceUriBase, 7),
      createdAt
    },
    {
      sessionId,
      step: 8,
      eventType: "session.summary",
      role: "system",
      summary: "Session closed. Goal completed with one rejected and one approved action.",
      input: { traceEventCount: 8, registryEventCount: 9 },
      output: { outcome: "completed", rejectedCount: 1, executedCount: 1 },
      model: MODEL,
      uri: traceUri(traceUriBase, 8),
      createdAt
    }
  ];

  assertCoversRequiredEventTypes(inputs);

  const traces = inputs.map((input) => createTraceEntry(input));

  return {
    sessionId,
    createdAt,
    traces,
    executionTxHash: txHash as `0x${string}`,
    calldataHash: calldataHash as `0x${string}`
  };
}

function traceUri(base: string, step: number): string {
  return `${base.replace(/\/+$/, "")}/${step}.json`;
}

function assertBytes32(value: string, field: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${field} must be a 0x-prefixed 32-byte hex string`);
  }
}

function assertCoversRequiredEventTypes(inputs: TraceEntryInput[]): void {
  const present = new Set(inputs.map((i) => i.eventType));
  const missing = REQUIRED_TRACE_EVENT_TYPES.filter((t) => !present.has(t));
  if (missing.length > 0) {
    throw new Error(`scripted scenario missing required event types: ${missing.join(", ")}`);
  }
}
