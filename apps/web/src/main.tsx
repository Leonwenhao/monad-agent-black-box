import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  assertTraceEntry,
  hashTracePayload,
  REQUIRED_TRACE_EVENT_TYPES,
  type JsonValue,
  type TraceEntry,
  type TraceEventType
} from "@agent-black-box/trace-schema";
import "./styles.css";

type Severity = "info" | "warn" | "critical" | "ok";
type SessionSource = "latest" | "seeded";
type DemoState = "confirmed" | "replayed" | "offline";

type AgentEndpoint = {
  type: "mcp" | "http" | "x402" | "a2a";
  label: string;
  uri: string;
};

type AgentIdentity = {
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

type RunnerSummary = {
  mode: "scripted-offline" | "scripted-onchain";
  runner: { name: string; version: string };
  sessionId: string;
  createdAt: string;
  eventCount: number;
  traces: Array<{
    step: number;
    eventType: TraceEventType;
    contentHash: string;
    uri: string;
    role: string;
  }>;
  agentIdentity?: AgentIdentity;
  chain: {
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
  outputs: {
    sessionDir: string;
    summaryPath: string;
    tracePaths: string[];
  };
};

type LoadedTrace = {
  trace: TraceEntry;
  rawJson: string;
  severity: Severity;
  role: string;
  title: string;
  sub: string;
  hashStatus: "anchored" | "pending";
  recordTxHash: `0x${string}` | null;
  localHash: `0x${string}`;
};

type LoadedSession = {
  source: SessionSource;
  summary: RunnerSummary;
  traces: LoadedTrace[];
  chainLabel: string;
  proofCopy: string;
  explorerBase: string | null;
};

type SessionState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; latest: LoadedSession; seeded: LoadedSession };

const SESSION_ASSET_ROOT: Record<SessionSource, string> = {
  latest: "session-data",
  seeded: "seeded-session"
};

const ROLE_LABEL: Record<TraceEventType, string> = {
  "goal.received": "system",
  "plan.created": "planner",
  "tool.simulation": "simulator",
  "risk.rejection": "risk",
  "policy.approved": "policy",
  "execution.submitted": "executor",
  "execution.confirmed": "chain",
  "session.summary": "registry",
  "memory.retrieved": "system",
  "debate.argument": "risk",
  "human.override": "system",
  "policy.denied": "policy",
  "execution.failed": "executor"
};

const TITLE_FOR: Record<TraceEventType, string> = {
  "goal.received": "Session opened",
  "plan.created": "Plan generated",
  "tool.simulation": "Simulation result",
  "risk.rejection": "REJECTED · risk breach",
  "policy.approved": "Policy approved",
  "execution.submitted": "Tx submitted",
  "execution.confirmed": "Tx confirmed",
  "session.summary": "Session summary",
  "memory.retrieved": "Memory retrieved",
  "debate.argument": "Debate argument",
  "human.override": "Human override",
  "policy.denied": "Policy denied",
  "execution.failed": "Execution failed"
};

const EXPLAIN: Record<TraceEventType, string> = {
  "goal.received":
    "Goal handed to the agent. Hard constraints are pinned into the trace so risk and policy agents can be reproduced deterministically.",
  "plan.created":
    "Planner emits candidate actions. Each candidate is scored offline before anything touches the chain.",
  "tool.simulation":
    "Each candidate is simulated against the demo treasury contract. Gas and exposure are recorded for every candidate, not only the winner.",
  "risk.rejection":
    "This candidate would have breached policy. It is blocked from execution and the reason codes are anchored to the trace.",
  "policy.approved":
    "Approval is short-lived and bound to a specific signer + allow list. Anything outside the allow list is rejected at submit time.",
  "execution.submitted":
    "Calldata hash and target are recorded before the transaction lands. The runner pins this commitment in the registry.",
  "execution.confirmed":
    "Receipt observed. The runner links the execution tx hash back to the trace session.",
  "session.summary":
    "Final tally. Hash match indicates the offchain payload reproduces bit-for-bit the value committed onchain.",
  "memory.retrieved": "Optional memory event. Reproducible from the pinned snapshot.",
  "debate.argument": "Optional debate event captured between risk and policy agents.",
  "human.override": "An operator intervened; the override is recorded for audit.",
  "policy.denied": "Policy refused the action under the active allow list.",
  "execution.failed": "Submission failed. Failure mode and the runner's diagnostic are pinned to the trace."
};

function App() {
  const [sessionState, setSessionState] = useState<SessionState>({ status: "loading" });
  const [activeSource, setActiveSource] = useState<SessionSource>("latest");
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const [latest, seeded] = await Promise.all([loadSession("latest"), loadSession("seeded")]);
        if (cancelled) return;
        setSessionState({ status: "ready", latest, seeded });
        setSelectedStep(defaultStepFor(latest));
      } catch (err) {
        if (cancelled) return;
        setSessionState({
          status: "error",
          message: err instanceof Error ? err.message : String(err)
        });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (sessionState.status === "loading") {
    return (
      <StatePanel
        title="Loading session data"
        message="Reading the latest bundled trace session and the committed seed fallback."
      />
    );
  }

  if (sessionState.status === "error") {
    return <StatePanel title="Session data unavailable" message={sessionState.message} />;
  }

  const { latest, seeded } = sessionState;
  const latestMatchesSeed = sameSession(latest, seeded);
  const hasDistinctLatest = !latestMatchesSeed;
  const activeSession = activeSource === "latest" ? latest : seeded;
  const selected =
    activeSession.traces.find((item) => item.trace.step === selectedStep) ?? activeSession.traces[0];
  const selectedHashMatches = selected.localHash === selected.trace.contentHash;
  const allHashesMatch = activeSession.traces.every((item) => item.localHash === item.trace.contentHash);

  const demoState: DemoState =
    activeSource === "seeded"
      ? "replayed"
      : activeSession.summary.chain.submitted
        ? "confirmed"
        : "offline";

  function handleSelect(step: number): void {
    if (step === selectedStep) {
      setDrawerOpen((open) => !open);
    } else {
      setSelectedStep(step);
      setDrawerOpen(true);
    }
  }

  function activateSource(source: SessionSource): void {
    if (source === activeSource) return;
    const nextSession = source === "latest" ? latest : seeded;
    setActiveSource(source);
    setSelectedStep(defaultStepFor(nextSession));
    setDrawerOpen(false);
  }

  return (
    <div className="app">
      <Header
        session={activeSession}
        demoState={demoState}
        activeSource={activeSource}
        hasDistinctLatest={hasDistinctLatest}
        onActivateSource={activateSource}
      />
      <main className="grid">
        <aside className="rail">
          <AgentContext session={activeSession} allHashesMatch={allHashesMatch} />
          <RiskDebate session={activeSession} />
        </aside>
        <Timeline
          session={activeSession}
          selectedStep={selected.trace.step}
          allHashesMatch={allHashesMatch}
          onSelect={handleSelect}
        />
        <ProofPanel
          session={activeSession}
          selected={selected}
          hashMatches={selectedHashMatches}
          demoState={demoState}
        />
      </main>
      <Drawer
        open={drawerOpen}
        item={selected}
        hashMatches={selectedHashMatches}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}

function AgentContext({
  session,
  allHashesMatch
}: {
  session: LoadedSession;
  allHashesMatch: boolean;
}) {
  const identity = agentIdentityFor(session.summary);
  const chain = session.summary.chain;
  const wallet = identity.agentWallet ?? chain.ownerAddress;
  const walletHref = session.explorerBase && wallet ? `${session.explorerBase}/address/${wallet}` : null;
  const txHref = session.explorerBase && chain.executionTxHash ? `${session.explorerBase}/tx/${chain.executionTxHash}` : null;
  const reputationHref = session.explorerBase
    ? `${session.explorerBase}/address/${identity.reputationRegistry}`
    : null;

  const evidence = [
    { label: "unsafe path rejected", ok: Boolean(session.traces.find((t) => t.trace.eventType === "risk.rejection")) },
    { label: "safe action executed", ok: Boolean(chain.executionTxHash && chain.submitted) },
    { label: "trace hashes verified", ok: allHashesMatch },
    { label: "reputation evidence ready", ok: allHashesMatch && Boolean(chain.executionTxHash) }
  ];

  return (
    <section className="panel agent-panel">
      <div className="panel-hd">
        <div className="panel-hd-l">
          <span className="panel-eyebrow">01 ·</span>
          <h3 className="panel-title">Agent context</h3>
        </div>
        <Pill tone="purple" square>
          {identity.standard}
        </Pill>
      </div>

      <div className="agent-card">
        <div className="agent-card-top">
          <div>
            <p className="agent-name">{identity.name}</p>
            <p className="agent-desc">{identity.description}</p>
          </div>
        </div>

        <div className="agent-grid">
          <AgentRow k="agent id">
            <span className="mono">{identity.agentId}</span>
          </AgentRow>
          <AgentRow k="wallet">
            {wallet ? (
              <Mono copy={wallet} title={wallet}>
                {shortHash(wallet, 10, 8)}
              </Mono>
            ) : (
              <span className="dim mono">not set</span>
            )}
          </AgentRow>
          <AgentRow k="identity">
            <Mono copy={identity.identityRegistry} title={identity.identityRegistry}>
              {shortHash(identity.identityRegistry, 10, 8)}
            </Mono>
          </AgentRow>
          <AgentRow k="agent card">
            <span className="mono">{identity.agentCardUri}</span>
          </AgentRow>
        </div>

        <div className="agent-links">
          <ProofLink href={walletHref} label="explorer · agent wallet" />
          <ProofLink href={txHref} label="explorer · traced action" />
          <ProofLink href={reputationHref} label="explorer · reputation registry" />
        </div>
      </div>

      <div className="agent-section">
        <div className="agent-section-hd">
          <span>integration slots</span>
          <span className="mono">MCP / x402</span>
        </div>
        <div className="agent-endpoints">
          {identity.endpoints.map((endpoint) => (
            <div className="agent-endpoint" key={`${endpoint.type}-${endpoint.uri}`}>
              <Pill tone={endpoint.type === "x402" ? "warn" : "purple"} square>
                {endpoint.type}
              </Pill>
              <div>
                <span>{endpoint.label}</span>
                <code>{endpoint.uri}</code>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="agent-section">
        <div className="agent-section-hd">
          <span>reputation evidence</span>
          <span className="mono">{session.summary.eventCount} events</span>
        </div>
        <div className="evidence-list">
          {evidence.map((item) => (
            <span className={`evidence-item ${item.ok ? "evidence-ok" : "evidence-wait"}`} key={item.label}>
              <span>{item.ok ? "✓" : "·"}</span>
              {item.label}
            </span>
          ))}
        </div>
        <p className="agent-note">
          MonadScan or Goldsky can supply broader wallet history later. This session remains the verified
          decision trace behind one agent action.
        </p>
      </div>
    </section>
  );
}

function AgentRow({
  k,
  children
}: {
  k: string;
  children: React.ReactNode;
}) {
  return (
    <div className="agent-row">
      <span className="agent-k">{k}</span>
      <span className="agent-v">{children}</span>
    </div>
  );
}

function Header({
  session,
  demoState,
  activeSource,
  hasDistinctLatest,
  onActivateSource
}: {
  session: LoadedSession;
  demoState: DemoState;
  activeSource: SessionSource;
  hasDistinctLatest: boolean;
  onActivateSource: (source: SessionSource) => void;
}) {
  const statusMap: Record<DemoState, { label: string; tone: "confirmed" | "replayed" | "offline" }> = {
    confirmed: { label: "Confirmed", tone: "confirmed" },
    replayed: { label: "Replayed", tone: "replayed" },
    offline: { label: "Offline replay", tone: "offline" }
  };
  const status = statusMap[demoState];
  const networkPillTone =
    session.summary.chain.chainId === 10143
      ? "purple"
      : session.summary.chain.chainId === 31337
        ? "warn"
        : "neutral";
  const networkLabel =
    session.summary.chain.chainId !== null
      ? `${chainSlugFor(session.summary.chain.chainId)} · ${session.summary.chain.chainId}`
      : "offline replay";

  return (
    <header className="hdr">
      <div className="hdr-left">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <span className="brand-mark-inner" />
          </span>
          <span className="brand-name">Agent Black Box</span>
          <span className="brand-build mono">v{session.summary.runner.version}</span>
        </div>
        <span className="hdr-divider" />
        <span className="hdr-tagline">A flight recorder for autonomous on-chain agents.</span>
      </div>
      <div className="hdr-right">
        <div className="hdr-meta">
          <span className="hdr-meta-k">session</span>
          <Mono copy={session.summary.sessionId} title={session.summary.sessionId}>
            {shortHash(session.summary.sessionId, 8, 6)}
          </Mono>
        </div>
        <div className="hdr-meta">
          <span className="hdr-meta-k">network</span>
          <Pill tone={networkPillTone} dot>
            {networkLabel}
          </Pill>
        </div>
        {hasDistinctLatest ? (
          <div className="hdr-meta">
            <span className="hdr-meta-k">source</span>
            <div className="hdr-source-switch" role="group" aria-label="Session source">
              <button
                type="button"
                aria-pressed={activeSource === "latest"}
                onClick={() => onActivateSource("latest")}
              >
                latest
              </button>
              <button
                type="button"
                aria-pressed={activeSource === "seeded"}
                onClick={() => onActivateSource("seeded")}
              >
                seeded
              </button>
            </div>
          </div>
        ) : (
          <div className="hdr-meta">
            <span className="hdr-meta-k">source</span>
            <Pill tone="neutral">seeded fallback</Pill>
          </div>
        )}
        <div className="hdr-meta">
          <span className="hdr-meta-k">status</span>
          <span className={`hdr-status hdr-status-${status.tone}`}>
            <span className="status-dot" />
            {status.label}
          </span>
        </div>
      </div>
    </header>
  );
}

function Timeline({
  session,
  selectedStep,
  allHashesMatch,
  onSelect
}: {
  session: LoadedSession;
  selectedStep: number;
  allHashesMatch: boolean;
  onSelect: (step: number) => void;
}) {
  return (
    <section className="panel timeline-panel">
      <div className="panel-hd">
        <div className="panel-hd-l">
          <span className="panel-eyebrow">02 ·</span>
          <h3 className="panel-title">Trace timeline</h3>
        </div>
        <div className="panel-hd-r">
          <span className="panel-meta mono">
            {session.traces.length}/{session.summary.eventCount} events
          </span>
          <span className="panel-meta-sep" />
          <span className="panel-meta">
            {allHashesMatch ? "hashes verified" : "hash mismatch"}
          </span>
        </div>
      </div>
      <div className="tl-list">
        {session.traces.map((item, idx) => (
          <TimelineRow
            key={`${session.source}-${item.trace.step}`}
            item={item}
            idx={idx}
            selected={item.trace.step === selectedStep}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function TimelineRow({
  item,
  idx,
  selected,
  onSelect
}: {
  item: LoadedTrace;
  idx: number;
  selected: boolean;
  onSelect: (step: number) => void;
}) {
  const rowClass = [
    "tl-row",
    selected ? "is-selected" : "",
    item.severity === "critical" ? "is-critical" : ""
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={rowClass} onClick={() => onSelect(item.trace.step)}>
      <div className="tl-gutter">
        <span className="tl-idx mono">{String(idx + 1).padStart(2, "0")}</span>
        <span className="tl-spine" />
        <span className="tl-node" data-sev={item.severity}>
          <SeverityGlyph sev={item.severity} />
        </span>
      </div>
      <div className="tl-card">
        <div className="tl-card-top">
          <span className="tl-role">{item.role}</span>
          <span className="tl-t mono">step {String(item.trace.step).padStart(2, "0")}</span>
          <span className="tl-spacer" />
          <Pill tone={hashStatusTone(item.hashStatus)} square>
            {item.hashStatus}
          </Pill>
        </div>
        <div className="tl-title">{item.title}</div>
        <div className="tl-sub">{item.sub}</div>
      </div>
    </button>
  );
}

function RiskDebate({ session }: { session: LoadedSession }) {
  const rejection = session.traces.find((item) => item.trace.eventType === "risk.rejection");
  const approval = session.traces.find((item) => item.trace.eventType === "policy.approved");
  const simulation = session.traces.find((item) => item.trace.eventType === "tool.simulation");

  const rejectionReasonCodes = readStringArray(rejection?.trace.output.reasonCodes);
  const approvalReasons = readStringArray(approval?.trace.output.reasons);
  const fallbackApprovalCodes =
    approvalReasons.length > 0
      ? approvalReasons
      : approval
        ? [`POLICY:${readString(approval.trace.output.policy) ?? "bounded-exposure"}`]
        : [];

  const rejectedAction = readString(rejection?.trace.input.candidateAction);
  const approvedAction = readString(approval?.trace.input.candidateAction);

  const simulationCandidates = readSimulationCandidates(simulation?.trace.output);
  const rejectedSim = simulationCandidates.find((c) => c.id === rejectedAction) ?? simulationCandidates[0];
  const approvedSim = simulationCandidates.find((c) => c.id === approvedAction) ?? simulationCandidates[1];

  const policyLabel = readString(approval?.trace.output.policy) ?? "policy.bounded-exposure";

  return (
    <section className="panel risk-panel">
      <div className="panel-hd">
        <div className="panel-hd-l">
          <span className="panel-eyebrow">03 ·</span>
          <h3 className="panel-title">Risk debate</h3>
        </div>
        <Pill tone="neutral" square>
          {policyLabel}
        </Pill>
      </div>

      <p className="risk-copy">
        {rejection
          ? "The risk agent rejected this path before execution."
          : "Awaiting risk verdict for this session."}
      </p>

      <div className="cand cand-rejected">
        <div className="cand-hd">
          <span className="cand-id">A</span>
          <span className="cand-path">{rejectedAction ?? "unsafe candidate"}</span>
          <Pill tone="reject" square>
            REJECTED
          </Pill>
        </div>
        <p className="cand-summary">
          {rejection?.trace.summary ?? "Candidate flagged by the risk agent."}
        </p>
        {rejectedSim ? <SimulationStats sim={rejectedSim} bad /> : null}
        {rejectionReasonCodes.length > 0 ? (
          <div className="cand-reasons">
            {rejectionReasonCodes.map((code) => (
              <span key={code} className="reason reason-bad">
                {code}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="cand cand-approved">
        <div className="cand-hd">
          <span className="cand-id">B</span>
          <span className="cand-path">{approvedAction ?? "safe candidate"}</span>
          <Pill tone="ok" square>
            APPROVED
          </Pill>
        </div>
        <p className="cand-summary">
          {approval?.trace.summary ?? "Approved candidate; bounded exposure."}
        </p>
        {approvedSim ? <SimulationStats sim={approvedSim} /> : null}
        {fallbackApprovalCodes.length > 0 ? (
          <div className="cand-reasons">
            {fallbackApprovalCodes.map((code) => (
              <span key={code} className="reason reason-good">
                {code}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

type SimCandidate = {
  id: string;
  revert: boolean | null;
  gas: number | null;
  exposure: string | null;
};

function SimulationStats({ sim, bad }: { sim: SimCandidate; bad?: boolean }) {
  return (
    <dl className="cand-grid">
      <div>
        <dt>gas</dt>
        <dd className={`mono ${bad ? "bad" : "ok"}`}>{sim.gas !== null ? sim.gas.toLocaleString() : "—"}</dd>
      </div>
      <div>
        <dt>exposure</dt>
        <dd className={`mono ${bad ? "bad" : "ok"}`}>{sim.exposure ?? "—"}</dd>
      </div>
      <div>
        <dt>revert</dt>
        <dd className="mono dim">{sim.revert === null ? "—" : sim.revert ? "yes" : "no"}</dd>
      </div>
      <div>
        <dt>id</dt>
        <dd className="mono dim">{sim.id}</dd>
      </div>
    </dl>
  );
}

function ProofPanel({
  session,
  selected,
  hashMatches,
  demoState
}: {
  session: LoadedSession;
  selected: LoadedTrace;
  hashMatches: boolean;
  demoState: DemoState;
}) {
  const chain = session.summary.chain;
  const verifiedTone: "ok" | "wait" | "bad" =
    !hashMatches ? "bad" : chain.submitted ? "ok" : "wait";
  const verifiedLabel = !hashMatches ? "unverified" : chain.submitted ? "verified" : "local-only";

  const explorerTxHref = session.explorerBase && chain.executionTxHash
    ? `${session.explorerBase}/tx/${chain.executionTxHash}`
    : null;
  const explorerRegistryHref = session.explorerBase && chain.registryAddress
    ? `${session.explorerBase}/address/${chain.registryAddress}`
    : null;
  const explorerSelectedTxHref = session.explorerBase && selected.recordTxHash
    ? `${session.explorerBase}/tx/${selected.recordTxHash}`
    : null;

  return (
    <section className="panel proof-panel">
      <div className="panel-hd">
        <div className="panel-hd-l">
          <span className="panel-eyebrow">04 ·</span>
          <h3 className="panel-title">Onchain proof</h3>
        </div>
        {demoState === "replayed" ? (
          <Pill tone="purple" square>
            replay
          </Pill>
        ) : demoState === "offline" ? (
          <Pill tone="warn" square>
            offline
          </Pill>
        ) : null}
      </div>

      <p className="proof-copy">{session.proofCopy}</p>

      <div className={`proof-match proof-match-${verifiedTone}`}>
        <div className="proof-match-lhs">
          <span className="proof-match-lbl">hash match</span>
          <span className="proof-match-state">{verifiedLabel}</span>
        </div>
        <div className="proof-match-rhs">
          <div className="proof-match-cmp">
            <div className="cmp-side">
              <span className="cmp-k">local</span>
              <span className="mono">{shortHash(selected.localHash, 10, 8)}</span>
            </div>
            <span className={`cmp-eq cmp-eq-${verifiedTone}`}>
              {hashMatches ? "=" : "≠"}
            </span>
            <div className="cmp-side">
              <span className="cmp-k">onchain</span>
              <span className="mono">
                {chain.submitted ? shortHash(selected.trace.contentHash, 10, 8) : "n/a · offline"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="proof-grid">
        <ProofRow k="network">
          <span className="mono">{session.chainLabel}</span>
        </ProofRow>
        <ProofRow k="registry" copyText={chain.registryAddress ?? undefined}>
          {chain.registryAddress ? (
            <Mono copy={chain.registryAddress} title={chain.registryAddress}>
              {shortHash(chain.registryAddress, 10, 8)}
            </Mono>
          ) : (
            <span className="dim mono">not deployed</span>
          )}
        </ProofRow>
        <ProofRow k="session" copyText={session.summary.sessionId}>
          <Mono copy={session.summary.sessionId} title={session.summary.sessionId}>
            {shortHash(session.summary.sessionId, 10, 8)}
          </Mono>
        </ProofRow>
        <ProofRow k="events">
          <span className="mono">{session.summary.eventCount}</span>
          <span className="dim mono"> · {new Date(session.summary.createdAt).toISOString().slice(11, 19)}Z</span>
        </ProofRow>
        <ProofRow k="selected hash" copyText={selected.trace.contentHash}>
          <Mono copy={selected.trace.contentHash} title={selected.trace.contentHash}>
            {shortHash(selected.trace.contentHash, 12, 10)}
          </Mono>
        </ProofRow>
        <ProofRow k="final tx" copyText={chain.executionTxHash}>
          {chain.submitted ? (
            <Mono copy={chain.executionTxHash} title={chain.executionTxHash}>
              {shortHash(chain.executionTxHash, 12, 10)}
            </Mono>
          ) : (
            <span className="dim mono">no chain receipt</span>
          )}
        </ProofRow>
        <ProofRow k="treasury" copyText={chain.demoTreasuryAddress ?? undefined}>
          {chain.demoTreasuryAddress ? (
            <Mono copy={chain.demoTreasuryAddress} title={chain.demoTreasuryAddress}>
              {shortHash(chain.demoTreasuryAddress, 10, 8)}
            </Mono>
          ) : (
            <span className="dim mono">not deployed</span>
          )}
        </ProofRow>
      </div>

      <div className="proof-links">
        <ProofLink href={explorerTxHref} label="explorer · execution tx" />
        <ProofLink href={explorerRegistryHref} label="explorer · registry" />
        <ProofLink href={explorerSelectedTxHref} label={`explorer · step ${selected.trace.step} record`} />
      </div>

      <p className="proof-note">{chain.note}</p>
    </section>
  );
}

function ProofRow({
  k,
  children,
  copyText
}: {
  k: string;
  children: React.ReactNode;
  copyText?: string;
}) {
  return (
    <div className="proof-row">
      <span className="proof-k">{k}</span>
      <span className="proof-v">
        {children}
        {copyText ? (
          <button
            type="button"
            className="proof-copy-btn mono"
            onClick={() => copyToClipboard(copyText)}
            title="copy"
            aria-label={`copy ${k}`}
          >
            ⧉
          </button>
        ) : null}
      </span>
    </div>
  );
}

function ProofLink({ href, label }: { href: string | null; label: string }) {
  if (!href) {
    return (
      <span className="proof-link proof-link-disabled" aria-disabled="true">
        <span>{label}</span>
        <span className="proof-link-arr">·</span>
      </span>
    );
  }
  return (
    <a className="proof-link" href={href} target="_blank" rel="noreferrer">
      <span>{label}</span>
      <span className="proof-link-arr">↗</span>
    </a>
  );
}

function Drawer({
  open,
  item,
  hashMatches,
  onClose
}: {
  open: boolean;
  item: LoadedTrace;
  hashMatches: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <div className={`drw-scrim${open ? " is-open" : ""}`} onClick={onClose} />
      <aside className={`drw${open ? " is-open" : ""}`} aria-hidden={!open}>
        <div className="drw-hd">
          <div className="drw-hd-l">
            <span className="drw-eyebrow mono">
              step {String(item.trace.step).padStart(2, "0")} · {item.role} · {item.trace.eventType}
            </span>
            <h3 className="drw-title">{item.title}</h3>
          </div>
          <div className="drw-hd-r">
            <Pill tone={severityTone(item.severity)} square>
              {item.severity}
            </Pill>
            <button type="button" className="drw-close" onClick={onClose} aria-label="close">
              esc
            </button>
          </div>
        </div>

        <div className="drw-explain">{EXPLAIN[item.trace.eventType] ?? "Raw payload below."}</div>

        <div className="drw-cmp">
          <div className="drw-cmp-row">
            <span className="drw-cmp-k">local hash</span>
            <Mono copy={item.localHash} title={item.localHash}>
              {shortHash(item.localHash, 14, 10)}
            </Mono>
          </div>
          <div className="drw-cmp-row">
            <span className="drw-cmp-k">stored hash</span>
            <Mono copy={item.trace.contentHash} title={item.trace.contentHash}>
              {shortHash(item.trace.contentHash, 14, 10)}
            </Mono>
          </div>
          <div className="drw-cmp-row drw-cmp-eq">
            <span className="drw-cmp-k">match</span>
            <span className={`mono ${hashMatches ? "ok" : "bad"}`}>
              {hashMatches ? "= verified" : "≠ mismatch"}
            </span>
          </div>
          {item.recordTxHash ? (
            <div className="drw-cmp-row">
              <span className="drw-cmp-k">record tx</span>
              <Mono copy={item.recordTxHash} title={item.recordTxHash}>
                {shortHash(item.recordTxHash, 14, 10)}
              </Mono>
            </div>
          ) : null}
        </div>

        <div className="drw-json-hd">
          <span className="drw-json-k">payload.json</span>
          <span className="dim mono">canonical · {item.rawJson.length} bytes</span>
        </div>
        <div className="drw-json-wrap">
          <JsonView json={item.rawJson} />
        </div>
      </aside>
    </>
  );
}

function JsonView({ json }: { json: string }) {
  const parsed = useMemo<JsonValue>(() => JSON.parse(json) as JsonValue, [json]);
  const lines = useMemo(() => jsonLines(parsed), [parsed]);
  return (
    <pre className="json">
      {lines.map((line, i) => (
        <div key={i} className="json-line">
          <span className="json-ln">{String(i + 1).padStart(2, "0")}</span>
          <span className="json-c">
            {line.pad}
            {line.tokens.map((tok, j) => (
              <span key={j} className={`jt jt-${tok.t}`}>
                {tok.v}
              </span>
            ))}
          </span>
        </div>
      ))}
    </pre>
  );
}

type JsonToken = { t: "k" | "s" | "n" | "b" | "p"; v: string };
type JsonLine = { pad: string; tokens: JsonToken[] };

function jsonLines(value: JsonValue, indent = 0, lines: JsonLine[] = []): JsonLine[] {
  const pad = "  ".repeat(indent);
  if (value === null) {
    lines.push({ pad, tokens: [{ t: "n", v: "null" }] });
    return lines;
  }
  if (Array.isArray(value)) {
    lines.push({ pad, tokens: [{ t: "p", v: "[" }] });
    value.forEach((v, i) => {
      const sub = jsonLines(v, indent + 1, []);
      sub.forEach((line, k) => {
        if (k === sub.length - 1 && i < value.length - 1) line.tokens.push({ t: "p", v: "," });
        lines.push(line);
      });
    });
    lines.push({ pad, tokens: [{ t: "p", v: "]" }] });
    return lines;
  }
  if (typeof value === "object") {
    lines.push({ pad, tokens: [{ t: "p", v: "{" }] });
    const keys = Object.keys(value);
    keys.forEach((key, i) => {
      const child = (value as { [k: string]: JsonValue })[key];
      if (child !== null && typeof child === "object") {
        lines.push({
          pad: pad + "  ",
          tokens: [
            { t: "k", v: `"${key}"` },
            { t: "p", v: ": " }
          ]
        });
        const sub = jsonLines(child, indent + 1, []);
        const head = lines[lines.length - 1];
        head.tokens.push(...sub[0].tokens);
        for (let j = 1; j < sub.length; j += 1) lines.push(sub[j]);
        if (i < keys.length - 1) lines[lines.length - 1].tokens.push({ t: "p", v: "," });
      } else {
        const tokens: JsonToken[] = [
          { t: "k", v: `"${key}"` },
          { t: "p", v: ": " }
        ];
        if (typeof child === "string") tokens.push({ t: "s", v: `"${child}"` });
        else if (typeof child === "number") tokens.push({ t: "n", v: String(child) });
        else if (typeof child === "boolean") tokens.push({ t: "b", v: String(child) });
        else tokens.push({ t: "n", v: "null" });
        if (i < keys.length - 1) tokens.push({ t: "p", v: "," });
        lines.push({ pad: pad + "  ", tokens });
      }
    });
    lines.push({ pad, tokens: [{ t: "p", v: "}" }] });
    return lines;
  }
  if (typeof value === "string") lines.push({ pad, tokens: [{ t: "s", v: `"${value}"` }] });
  else if (typeof value === "boolean") lines.push({ pad, tokens: [{ t: "b", v: String(value) }] });
  else lines.push({ pad, tokens: [{ t: "n", v: String(value) }] });
  return lines;
}

function Mono({
  children,
  copy,
  title
}: {
  children: React.ReactNode;
  copy?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span
      className="mono"
      title={title}
      onClick={
        copy
          ? () => {
              void copyToClipboard(copy);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 900);
            }
          : undefined
      }
      style={{ cursor: copy ? "default" : undefined }}
    >
      {copied ? "copied" : children}
    </span>
  );
}

function Pill({
  tone = "neutral",
  square,
  dot,
  children
}: {
  tone?: "ok" | "warn" | "reject" | "purple" | "neutral";
  square?: boolean;
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`pill pill-${tone}`} data-square={square ? "" : undefined}>
      {dot ? <span className="pill-dot" /> : null}
      {children}
    </span>
  );
}

function SeverityGlyph({ sev }: { sev: Severity }) {
  if (sev === "critical") return <span className="sev sev-critical">●</span>;
  if (sev === "warn") return <span className="sev sev-warn">▲</span>;
  if (sev === "ok") return <span className="sev sev-ok">✓</span>;
  return <span className="sev sev-info">·</span>;
}

function StatePanel({ title, message }: { title: string; message: string }) {
  return (
    <main className="shellState">
      <section className="statePanel">
        <p className="eyebrow">Agent Black Box</p>
        <h1>{title}</h1>
        <p>{message}</p>
      </section>
    </main>
  );
}

function severityFor(eventType: TraceEventType): Severity {
  if (eventType === "risk.rejection" || eventType === "execution.failed" || eventType === "policy.denied") {
    return "critical";
  }
  if (eventType === "tool.simulation" || eventType === "debate.argument" || eventType === "human.override") {
    return "warn";
  }
  if (
    eventType === "policy.approved"
    || eventType === "execution.confirmed"
    || eventType === "session.summary"
  ) {
    return "ok";
  }
  return "info";
}

function severityTone(severity: Severity): "ok" | "warn" | "reject" | "neutral" {
  if (severity === "ok") return "ok";
  if (severity === "warn") return "warn";
  if (severity === "critical") return "reject";
  return "neutral";
}

function hashStatusTone(status: "anchored" | "pending"): "ok" | "warn" {
  return status === "anchored" ? "ok" : "warn";
}

function chainSlugFor(chainId: number): string {
  if (chainId === 10143) return "monad-testnet";
  if (chainId === 31337) return "local-anvil";
  return `chain-${chainId}`;
}

function chainLabelFor(summary: RunnerSummary): string {
  if (summary.chain.chainId === 10143) return "Monad testnet";
  if (summary.chain.chainId === 31337) return "Local Anvil";
  if (summary.chain.chainId !== null) return `Chain ${summary.chain.chainId}`;
  return "Offline replay";
}

function agentIdentityFor(summary: RunnerSummary): AgentIdentity {
  return summary.agentIdentity ?? {
    standard: "ERC-8004",
    agentId: "demo-treasury-agent",
    name: "Demo Treasury Agent",
    description: "Scripted treasury agent used to prove replayable decision traces for on-chain actions.",
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    agentWallet: summary.chain.ownerAddress,
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

function proofCopyFor(summary: RunnerSummary): string {
  if (summary.chain.chainId === 10143) {
    return "This trace payload hashes to the contentHash emitted by TraceRegistry on Monad testnet.";
  }
  if (summary.chain.chainId === 31337) {
    return "This trace payload hashes to the contentHash emitted by TraceRegistry on Local Anvil.";
  }
  if (summary.chain.submitted && summary.chain.chainId !== null) {
    return `This trace payload hashes to the contentHash emitted by TraceRegistry on chain ${summary.chain.chainId}.`;
  }
  return "This trace payload hashes deterministically for offline replay; no public-chain receipt was submitted in this session.";
}

function explorerBaseFor(summary: RunnerSummary): string | null {
  if (summary.chain.chainId === 10143) {
    const fromEnv = import.meta.env.VITE_MONAD_EXPLORER_BASE_URL;
    return (fromEnv && fromEnv.length > 0 ? fromEnv : "https://testnet.monadexplorer.com").replace(/\/+$/, "");
  }
  return null;
}

async function loadSession(source: SessionSource): Promise<LoadedSession> {
  const root = SESSION_ASSET_ROOT[source];
  const summary = await fetchJson<RunnerSummary>(assetPath(`${root}/summary.json`));
  const traces = await Promise.all(
    summary.traces.map(async (traceSummary) => {
      const asset = assetPath(`${root}/traces/${summary.sessionId}/${traceSummary.step}.json`);
      const rawJson = await fetchText(asset);
      const trace = JSON.parse(rawJson) as unknown;
      assertTraceEntry(trace);
      if (trace.contentHash !== traceSummary.contentHash) {
        throw new Error(`Trace summary mismatch for session ${summary.sessionId} step ${traceSummary.step}`);
      }
      const recordTxHash = summary.chain.traceRecordTxHashes.find((tx) => tx.step === trace.step)?.txHash ?? null;
      const severity = severityFor(trace.eventType);
      const localHash = hashTracePayload(trace);
      return {
        trace,
        rawJson,
        severity,
        role: ROLE_LABEL[trace.eventType] ?? trace.role,
        title: TITLE_FOR[trace.eventType] ?? trace.eventType,
        sub: trace.summary,
        hashStatus: recordTxHash ? ("anchored" as const) : ("pending" as const),
        recordTxHash,
        localHash
      };
    })
  );

  assertRequiredTraces(source, traces);

  return {
    source,
    summary,
    traces,
    chainLabel: chainLabelFor(summary),
    proofCopy: proofCopyFor(summary),
    explorerBase: explorerBaseFor(summary)
  };
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function assetPath(relativePath: string): string {
  return `${import.meta.env.BASE_URL}${relativePath}`;
}

function defaultStepFor(session: LoadedSession): number {
  return (
    session.traces.find((item) => item.trace.eventType === "risk.rejection")?.trace.step
    ?? session.traces[0].trace.step
  );
}

function assertRequiredTraces(source: SessionSource, traces: LoadedTrace[]): void {
  for (const required of REQUIRED_TRACE_EVENT_TYPES) {
    if (!traces.some((item) => item.trace.eventType === required)) {
      throw new Error(`${source} session is missing required trace event: ${required}`);
    }
  }
}

function sameSession(a: LoadedSession, b: LoadedSession): boolean {
  return a.summary.sessionId === b.summary.sessionId && a.summary.createdAt === b.summary.createdAt;
}

function shortHash(value: string, head = 8, tail = 6): string {
  if (!value) return "";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function readString(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function readStringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function readSimulationCandidates(output: JsonValue | undefined): SimCandidate[] {
  if (!output || typeof output !== "object" || Array.isArray(output)) return [];
  const sims = (output as { [k: string]: JsonValue }).simulations;
  if (!Array.isArray(sims)) return [];
  return sims
    .map((sim): SimCandidate | null => {
      if (!sim || typeof sim !== "object" || Array.isArray(sim)) return null;
      const obj = sim as { [k: string]: JsonValue };
      const id = readString(obj.id);
      if (!id) return null;
      return {
        id,
        revert: typeof obj.revert === "boolean" ? obj.revert : null,
        gas: typeof obj.gas === "number" ? obj.gas : null,
        exposure: readString(obj.exposure)
      };
    })
    .filter((c): c is SimCandidate => c !== null);
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    /* ignore */
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
