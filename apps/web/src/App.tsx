import { useEffect, useMemo, useState } from "react";
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

type RegistryAgent = {
  agentId: string;
  name: string;
  owner: string | null;
  agentUri: string | null;
  source: "registry" | "seeded";
  riskScore: number;
  status: "verified" | "needs-review" | "offline" | "untraced";
  badges: string[];
  evidence: string;
};

type RegistryState =
  | { status: "loading"; agents: RegistryAgent[]; note: string }
  | { status: "ready"; agents: RegistryAgent[]; note: string }
  | { status: "fallback"; agents: RegistryAgent[]; note: string };

type SessionState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; latest: LoadedSession; seeded: LoadedSession };

const IDENTITY_REGISTRY_ADDRESS = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const MONAD_REPUTATION_REGISTRY_ADDRESS = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const AGENT_REGISTERED_TOPIC = "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a";
/** Minting address for ERC-721 Transfer — compare case-insensitive; some stacks vary hex casing */
const ZERO_TOPIC = `0x${"0".repeat(64)}`;
const OWNER_OF_SELECTOR = "0x6352211e";
const TOKEN_URI_SELECTOR = "0xc87b56dd";
const MONAD_MAINNET_CHAIN_ID = 143;
const MONAD_MAINNET_LABEL = "monad-mainnet";
const MONAD_MAINNET_EXPLORER_BASE_URL = "https://monadvision.com";
const MONAD_MAINNET_RPC_URL = "https://rpc.monad.xyz";
const DEFAULT_REGISTRY_SCAN_BLOCKS = 10_000n;
/** Monad `eth_getLogs` rejects spans over 100 blocks; stay under to avoid intermittent -32614. */
const REGISTRY_LOG_CHUNK_SIZE = 99n;
const KNOWN_REGISTRATION_BLOCKS = [56_859_390n] as const;
const KNOWN_REGISTRATION_SCAN_RADIUS = 500n;
const MAX_CATALOG_IDS_TO_READ = 100;
const MAX_REGISTRY_DETAILS_ATTEMPTS = 48;
/**
 * Delay after batched/heavy registry RPC rounds. Sequential `eth_call` was one HTTP request each;
 * batches reduce load — keep a modest gap so public RPC stays happy without multi-minute scans.
 */
const REGISTRY_RPC_MIN_INTERVAL_MS = 400;
const RADAR_REGISTRY_ROW_TARGET = 8;

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

export default function App() {
  const [sessionState, setSessionState] = useState<SessionState>({ status: "loading" });
  const [registryState, setRegistryState] = useState<RegistryState>({
    status: "loading",
    agents: [],
    note: "Reading ERC-8004 Identity Registry..."
  });
  const [activeSource, setActiveSource] = useState<SessionSource>("latest");
  const [selectedStep, setSelectedStep] = useState<number | null>(null);

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
    let cancelled = false;
    async function load(): Promise<void> {
      const fallback = seededRegistryAgents();
      try {
        const { agents, catalogSource, catalogListed } = await loadRegistryAgentsWithMeta();
        if (cancelled) return;
        if (agents.length === 0) {
          setRegistryState({
            status: "fallback",
            agents: fallback,
            note: "No agents could be resolved from the bundled 8004scan catalog JSON, fallback list, or on-chain scans. Showing seeded risk examples."
          });
          return;
        }
        setRegistryState({
          status: "ready",
          agents: agents.slice(0, RADAR_REGISTRY_ROW_TARGET),
          note:
            catalogSource === "8004scan"
              ? `Loaded ${agents.length} agent${agents.length === 1 ? "" : "s"} (${catalogListed} ID${
                  catalogListed === 1 ? "" : "s"
                } from bundled 8004scan snapshot, verified on-chain).`
              : catalogSource === "env"
                ? `Loaded ${agents.length} agent${agents.length === 1 ? "" : "s"} from VITE_MOCK_REGISTRY_AGENT_IDS (on-chain verification).`
                : `Loaded ${agents.length} agent${agents.length === 1 ? "" : "s"} from the Identity Registry.`
        });
      } catch (err) {
        if (cancelled) return;
        setRegistryState({
          status: "fallback",
          agents: fallback,
          note: `Registry unavailable in this browser session. Showing seeded examples: ${
            err instanceof Error ? err.message : String(err)
          }`
        });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
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

  function activateSource(source: SessionSource): void {
    if (source === activeSource) return;
    const nextSession = source === "latest" ? latest : seeded;
    setActiveSource(source);
    setSelectedStep(defaultStepFor(nextSession));
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
      <main className="simple-grid">
        <RegistryRadar
          registryState={registryState}
          session={activeSession}
          allHashesMatch={allHashesMatch}
        />
        <TraceSummary
          session={activeSession}
          selected={selected}
          hashMatches={selectedHashMatches}
          demoState={demoState}
        />
      </main>
    </div>
  );
}

function RegistryRadar({
  registryState,
  session,
  allHashesMatch
}: {
  registryState: RegistryState;
  session: LoadedSession;
  allHashesMatch: boolean;
}) {
  const identity = agentIdentityFor(session.summary);
  const tracedAgent: RegistryAgent = {
    agentId: identity.agentId,
    name: identity.name,
    owner: identity.agentWallet ?? session.summary.chain.ownerAddress,
    agentUri: identity.agentCardUri,
    source: "seeded",
    riskScore: allHashesMatch ? 8 : 48,
    status: allHashesMatch ? "verified" : "needs-review",
    badges: allHashesMatch
      ? ["VERIFIED_TRACE_HISTORY", "RISK_REJECTION_RECORDED", "EXECUTION_LINKED"]
      : ["TRACE_MISMATCH"],
    evidence: allHashesMatch
      ? "Current demo agent has a verified Agent Black Box session with risk rejection and linked execution."
      : "Current demo agent has a trace mismatch and needs review."
  };
  const agents = mergeTracedAgent(registryState.agents, tracedAgent);
  const counts = {
    verified: agents.filter((agent) => agent.status === "verified").length,
    review: agents.filter((agent) => agent.status === "needs-review").length,
    offline: agents.filter((agent) => agent.status === "offline").length,
    untraced: agents.filter((agent) => agent.status === "untraced").length
  };

  return (
    <section className="simple-panel radar-panel">
      <div className="simple-hero">
        <Pill tone="purple" square>
          ERC-8004 Identity Registry
        </Pill>
        <h1>Agent Risk Radar</h1>
        <p>
          A review queue for registered agents. It flags missing traces, offline-looking metadata,
          and verified Agent Black Box evidence without labeling agents as malicious.
        </p>
      </div>

      <div className="radar-source">
        <div>
          <span className="radar-source-k">registry</span>
          <Mono copy={IDENTITY_REGISTRY_ADDRESS} title={IDENTITY_REGISTRY_ADDRESS}>
            {shortHash(IDENTITY_REGISTRY_ADDRESS, 12, 10)}
          </Mono>
        </div>
        <Pill tone={registryState.status === "ready" ? "ok" : "warn"} square>
          {registryState.status === "ready" ? "live scan" : registryState.status}
        </Pill>
      </div>

      <div className="radar-counts">
        <RadarCount label="verified" value={counts.verified} tone="ok" />
        <RadarCount label="needs review" value={counts.review} tone="warn" />
        <RadarCount label="offline" value={counts.offline} tone="reject" />
        <RadarCount label="untraced" value={counts.untraced} tone="neutral" />
      </div>

      <div className="radar-list">
        {agents.map((agent) => (
          <AgentRiskRow agent={agent} key={`${agent.source}-${agent.agentId}-${agent.owner ?? "unknown"}`} />
        ))}
      </div>

      <p className="radar-note">{registryState.note}</p>
    </section>
  );
}

function RadarCount({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "reject" | "neutral";
}) {
  return (
    <div className={`radar-count radar-count-${tone}`}>
      <span>{value}</span>
      <label>{label}</label>
    </div>
  );
}

function AgentRiskRow({ agent }: { agent: RegistryAgent }) {
  return (
    <article className={`risk-row risk-row-${agent.status}`}>
      <div className="risk-row-main">
        <div className="risk-score">
          <span>{agent.riskScore}</span>
          <label>risk</label>
        </div>
        <div className="risk-agent">
          <div className="risk-agent-top">
            <strong>{agent.name}</strong>
            <Pill tone={statusTone(agent.status)} square>
              {statusLabel(agent.status)}
            </Pill>
          </div>
          <p>{agent.evidence}</p>
          <div className="risk-meta">
            <span className="mono">agent {agent.agentId}</span>
            {agent.owner ? <span className="mono">{shortHash(agent.owner, 8, 6)}</span> : null}
            {agent.agentUri ? <span className="mono">{compactUri(agent.agentUri)}</span> : null}
          </div>
        </div>
      </div>
      <div className="risk-badges">
        {agent.badges.map((badge) => (
          <span key={badge}>{badge}</span>
        ))}
      </div>
    </article>
  );
}

function TraceSummary({
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
  const identity = agentIdentityFor(session.summary);
  const rejection = session.traces.find((item) => item.trace.eventType === "risk.rejection");
  const execution = session.summary.chain.executionTxHash;
  const registryHref = session.explorerBase && session.summary.chain.registryAddress
    ? `${session.explorerBase}/address/${session.summary.chain.registryAddress}`
    : null;
  const txHref = session.explorerBase && execution ? `${session.explorerBase}/tx/${execution}` : null;

  return (
    <section className="simple-panel trace-panel-simple">
      <div className="simple-panel-hd">
        <div>
          <span>verified trace</span>
          <h2>{identity.name}</h2>
        </div>
        <Pill tone={hashMatches ? "ok" : "reject"} square>
          {hashMatches ? "hash verified" : "mismatch"}
        </Pill>
      </div>

      <div className="trace-steps-simple">
        {session.traces.map((item) => (
          <div className="trace-step-simple" key={item.trace.step}>
            <span className="mono">{String(item.trace.step).padStart(2, "0")}</span>
            <div>
              <strong>{item.trace.eventType}</strong>
              <p>{item.trace.summary}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="simple-proof">
        <ProofRow k="session" copyText={session.summary.sessionId}>
          <Mono copy={session.summary.sessionId}>{shortHash(session.summary.sessionId, 12, 10)}</Mono>
        </ProofRow>
        <ProofRow k="registry" copyText={session.summary.chain.registryAddress ?? undefined}>
          <Mono copy={session.summary.chain.registryAddress ?? ""}>
            {session.summary.chain.registryAddress
              ? shortHash(session.summary.chain.registryAddress, 12, 10)
              : "not deployed"}
          </Mono>
        </ProofRow>
        <ProofRow k="selected hash" copyText={selected.trace.contentHash}>
          <Mono copy={selected.trace.contentHash}>{shortHash(selected.trace.contentHash, 12, 10)}</Mono>
        </ProofRow>
        <ProofRow k="risk evidence">
          <span>{rejection ? "unsafe path rejected before execution" : "no risk rejection found"}</span>
        </ProofRow>
      </div>

      <div className="proof-links">
        <ProofLink href={registryHref} label="explorer · TraceRegistry" />
        <ProofLink href={txHref} label="explorer · execution tx" />
      </div>

      <p className="proof-note">
        {demoState === "confirmed"
          ? "This traced session anchors the demo agent as the verified baseline in the risk radar."
          : session.summary.chain.note}
      </p>
    </section>
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
  const networkPillTone = "purple";
  const networkLabel = `${MONAD_MAINNET_LABEL} · ${MONAD_MAINNET_CHAIN_ID}`;

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
          <span className="hdr-meta-k">radar network</span>
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
  if (chainId === MONAD_MAINNET_CHAIN_ID) return MONAD_MAINNET_LABEL;
  if (chainId === 31337) return "local-anvil";
  return `chain-${chainId}`;
}

function chainLabelFor(summary: RunnerSummary): string {
  if (summary.chain.chainId === MONAD_MAINNET_CHAIN_ID) return "Monad mainnet";
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
  if (summary.chain.chainId === MONAD_MAINNET_CHAIN_ID) {
    return "This trace payload hashes to the contentHash emitted by TraceRegistry on Monad mainnet.";
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
  if (summary.chain.chainId === MONAD_MAINNET_CHAIN_ID) {
    const fromEnv = import.meta.env.VITE_MONAD_EXPLORER_BASE_URL;
    return (fromEnv && fromEnv.length > 0 ? fromEnv : MONAD_MAINNET_EXPLORER_BASE_URL).replace(/\/+$/, "");
  }
  return null;
}

function registryRpcUrl(): string {
  return (
    import.meta.env.VITE_AGENT_REGISTRY_RPC_URL
    ?? import.meta.env.VITE_MONAD_RPC_URL
    ?? MONAD_MAINNET_RPC_URL
  );
}

type RegistryCatalogSource = "8004scan" | "env" | "logs";

type Bundled8004scanCatalogJson = {
  agentTokenIds?: string[];
};

function bundled8004scanCatalogUrl(): string {
  const override = import.meta.env.VITE_8004SCAN_CATALOG_URL?.trim();
  if (override && override.length > 0) return override;
  const base = import.meta.env.BASE_URL;
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}catalog/8004scan-agents-monad-143.json`;
}

async function loadBundled8004scanCatalogTokenIds(): Promise<bigint[]> {
  const url = bundled8004scanCatalogUrl();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Bundled catalog HTTP ${response.status} (${url})`);
  }
  const data = (await response.json()) as Bundled8004scanCatalogJson;
  const raw = data.agentTokenIds;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: bigint[] = [];
  for (const part of raw) {
    const id = typeof part === "string" ? part.trim() : "";
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    try {
      out.push(BigInt(id.replace(/^0x/i, "")));
    } catch {
      continue;
    }
    if (out.length >= MAX_CATALOG_IDS_TO_READ) break;
  }
  return out;
}

function optionalMockRegistryAgentIdsFromEnv(): bigint[] {
  const raw = import.meta.env.VITE_MOCK_REGISTRY_AGENT_IDS?.trim();
  if (!raw || raw.length === 0) return [];
  return raw
    .split(/[, \t]+/)
    .map((part: string) => part.trim())
    .filter((part: string) => part.length > 0)
    .map((part: string) => {
      try {
        return BigInt(part.replace(/^0x/i, ""));
      } catch {
        return null;
      }
    })
    .filter((n: bigint | null): n is bigint => n !== null && n >= 0n);
}

async function loadAgentsByTokenIdOrder(
  rpcUrl: string,
  orderedIds: bigint[],
  target: number,
  maxAttempts: number
): Promise<RegistryAgent[]> {
  const out: RegistryAgent[] = [];
  let cursor = 0;
  while (out.length < target && cursor < orderedIds.length && cursor < maxAttempts) {
    const batch = orderedIds.slice(cursor, cursor + 8);
    cursor += batch.length;
    const results = await hydrateRegistryAgentsFromChain(rpcUrl, batch);
    for (const agent of results) {
      if (agent) out.push(agent);
      if (out.length >= target) break;
    }
  }
  return out.slice(0, target);
}

async function loadRegistryAgentsWithMeta(): Promise<{
  agents: RegistryAgent[];
  catalogSource: RegistryCatalogSource;
  catalogListed: number;
}> {
  const rpcUrl = registryRpcUrl();
  let catalogIds: bigint[] = [];
  let catalogSource: RegistryCatalogSource = "logs";
  try {
    catalogIds = await loadBundled8004scanCatalogTokenIds();
    if (catalogIds.length > 0) catalogSource = "8004scan";
  } catch {
    catalogIds = [];
  }
  if (catalogIds.length === 0) {
    const mocked = optionalMockRegistryAgentIdsFromEnv();
    if (mocked.length > 0) {
      catalogIds = mocked;
      catalogSource = "env";
    }
  }

  const trackedAgents =
    catalogIds.length > 0
      ? await loadAgentsByTokenIdOrder(rpcUrl, catalogIds, RADAR_REGISTRY_ROW_TARGET, MAX_REGISTRY_DETAILS_ATTEMPTS)
      : [];

  /** Log scan is best-effort: some RPCs throttle or reject `eth_getLogs`; catalog agents should still load. */
  let logs: Array<{ topics: string[]; data?: string }> = [];
  try {
    const latestHex = await rpcCall<string>(rpcUrl, "eth_blockNumber", []);
    const latest = BigInt(latestHex);
    const fromBlock = latest > DEFAULT_REGISTRY_SCAN_BLOCKS ? latest - DEFAULT_REGISTRY_SCAN_BLOCKS : 0n;
    logs = await getRegistryRegistrationLogs(rpcUrl, fromBlock, latest);
  } catch {
    logs = [];
  }

  const trackedIdSet = new Set(trackedAgents.map((a) => a.agentId));
  const logTokenIdStrings = uniqueTokenIds(
    logs
      .map(tokenIdFromRegistryLog)
      .filter((topic): topic is string => typeof topic === "string" && topic.startsWith("0x"))
  )
    .filter((hex) => !trackedIdSet.has(BigInt(hex).toString()))
    .map((topic) => BigInt(topic))
    .sort((a, b) => Number(b - a))
    .map((tokenId) => tokenId.toString());

  const fillSlots = Math.max(0, RADAR_REGISTRY_ROW_TARGET - trackedAgents.length);
  const fromLogAgents = (
    await hydrateRegistryAgentsFromChain(
      rpcUrl,
      logTokenIdStrings.slice(0, fillSlots).map((id) => BigInt(id))
    )
  ).filter((agent): agent is RegistryAgent => agent !== null);

  return {
    agents: mergeTrackedAndLogAgents(trackedAgents, fromLogAgents),
    catalogSource,
    catalogListed: catalogIds.length
  };
}

function mergeTrackedAndLogAgents(tracked: RegistryAgent[], fromLogs: RegistryAgent[]): RegistryAgent[] {
  const seen = new Set(tracked.map((a) => a.agentId));
  const rest = fromLogs
    .filter((a) => !seen.has(a.agentId))
    .sort((a, b) => b.riskScore - a.riskScore);
  return [...tracked, ...rest];
}

function uniqueTokenIds(tokenIds: string[]): string[] {
  return [...new Set(tokenIds)];
}

function normalizeTopic(topic: string | undefined): string {
  const t = (topic ?? "").toLowerCase();
  if (/^0x[0-9a-f]{64}$/.test(t)) return t;
  if (/^0x[0-9a-f]+$/.test(t)) return ("0x" + t.slice(2).replace(/^0+/, "").padStart(64, "0")).toLowerCase();
  return t;
}

function topicEquals(a: string, b: string): boolean {
  return normalizeTopic(a) === normalizeTopic(b);
}

function tokenIdFromRegistryLog(log: { topics: string[]; data?: string }): string | null {
  if (
    topicEquals(log.topics[0], TRANSFER_TOPIC)
    && log.topics[1]
    && topicEquals(log.topics[1], ZERO_TOPIC)
  ) {
    return log.topics[3] ?? null;
  }
  if (topicEquals(log.topics[0], AGENT_REGISTERED_TOPIC)) {
    return log.topics[1] ?? null;
  }
  return null;
}

async function getRegistryRegistrationLogs(
  rpcUrl: string,
  recentFromBlock: bigint,
  latest: bigint
): Promise<Array<{ topics: string[]; data?: string }>> {
  const logs: Array<{ topics: string[]; data?: string }> = [];

  for (const block of KNOWN_REGISTRATION_BLOCKS) {
    const fromBlock = block > KNOWN_REGISTRATION_SCAN_RADIUS ? block - KNOWN_REGISTRATION_SCAN_RADIUS : 0n;
    const toBlock = block + KNOWN_REGISTRATION_SCAN_RADIUS;
    logs.push(...(await getRegistryLogsInChunks(rpcUrl, fromBlock, toBlock)));
  }

  if (logs.length >= 8) return logs;

  logs.push(
    ...(await getRegistryLogsInChunks(rpcUrl, recentFromBlock, latest, {
      topics: [TRANSFER_TOPIC, ZERO_TOPIC]
    }))
  );

  return logs;
}

async function getRegistryLogsInChunks(
  rpcUrl: string,
  fromBlock: bigint,
  latest: bigint,
  filter?: { topics?: string[] }
): Promise<Array<{ topics: string[]; data?: string }>> {
  const logs: Array<{ topics: string[]; data?: string }> = [];
  let toBlock = latest;
  while (toBlock >= fromBlock && logs.length < 16) {
    const chunkFrom = toBlock > REGISTRY_LOG_CHUNK_SIZE ? toBlock - REGISTRY_LOG_CHUNK_SIZE + 1n : 0n;
    const boundedFrom = chunkFrom < fromBlock ? fromBlock : chunkFrom;
    const chunkRaw = await rpcCall<Array<{ topics: string[]; data?: string }> | null>(rpcUrl, "eth_getLogs", [
      {
        address: IDENTITY_REGISTRY_ADDRESS,
        fromBlock: toQuantity(boundedFrom),
        toBlock: toQuantity(toBlock),
        ...(filter?.topics ? { topics: filter.topics } : {})
      }
    ]);
    const chunk = Array.isArray(chunkRaw) ? chunkRaw : [];
    logs.push(...chunk.reverse());
    if (boundedFrom === 0n || boundedFrom === fromBlock) break;
    toBlock = boundedFrom - 1n;
  }
  return logs;
}

/** Serializes RPC and spaces calls by `REGISTRY_RPC_MIN_INTERVAL_MS` to avoid bursting the provider. */
let rpcThrottlePipeline: Promise<unknown> = Promise.resolve();

async function enqueueSpacedRpcCall<T>(fn: () => Promise<T>): Promise<T> {
  const result = rpcThrottlePipeline.then(() => fn());
  rpcThrottlePipeline = result
    .then(
      async () => {
        await new Promise<void>((r) => setTimeout(r, REGISTRY_RPC_MIN_INTERVAL_MS));
      },
      async () => {
        await new Promise<void>((r) => setTimeout(r, REGISTRY_RPC_MIN_INTERVAL_MS));
      }
    )
    .catch(() => {});
  return result;
}

async function rpcCall<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  return enqueueSpacedRpcCall(() => rpcCallImmediate<T>(rpcUrl, method, params));
}

async function rpcCallImmediate<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  if (rpcUrl.startsWith("ws://") || rpcUrl.startsWith("wss://")) {
    return wsRpcCall<T>(rpcUrl, method, params);
  }

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: `${Date.now()}-${method}`, method, params })
  });
  if (!response.ok) {
    throw new Error(`${method} failed: ${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as { result?: T; error?: { message?: string } };
  if (payload.error) {
    throw new Error(`${method} failed: ${payload.error.message ?? "RPC error"}`);
  }
  if (payload.result === undefined) {
    throw new Error(`${method} returned no result`);
  }
  return payload.result;
}

function wsRpcCall<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${method}-${Math.random().toString(16).slice(2)}`;
    const socket = new WebSocket(rpcUrl);
    const timeout = window.setTimeout(() => {
      socket.close();
      reject(new Error(`${method} timed out`));
    }, 12_000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
    };

    socket.onopen = () => {
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    };
    socket.onmessage = (event) => {
      const payload = JSON.parse(String(event.data)) as {
        id?: string;
        result?: T;
        error?: { message?: string };
      };
      if (payload.id !== id) return;
      cleanup();
      socket.close();
      if (payload.error) {
        reject(new Error(`${method} failed: ${payload.error.message ?? "RPC error"}`));
        return;
      }
      if (payload.result === undefined) {
        reject(new Error(`${method} returned no result`));
        return;
      }
      resolve(payload.result);
    };
    socket.onerror = () => {
      cleanup();
      reject(new Error(`${method} failed: websocket error`));
    };
    socket.onclose = () => {
      cleanup();
    };
  });
}

type JsonRpcBatchItem<T = unknown> = {
  jsonrpc?: string;
  id?: string | number;
  result?: T;
  error?: { message?: string };
};

/**
 * Sends a JSON-RPC batch over HTTP (one POST). Individual `eth_call` reverts yield `null`
 * for that slot so one bad token ID does not fail the entire batch.
 */
async function rpcBatchImmediateFlexible(rpcUrl: string, calls: Array<{ method: string; params: unknown[] }>): Promise<(string | null)[]> {
  if (calls.length === 0) return [];
  if (rpcUrl.startsWith("ws://") || rpcUrl.startsWith("wss://")) {
    throw new Error("rpc batch requires HTTP(S) RPC URL");
  }

  const payload = calls.map((req, index) => ({
    jsonrpc: "2.0",
    id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
    method: req.method,
    params: req.params
  }));

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`rpc batch failed: ${response.status} ${response.statusText}`);
  }
  const parsed = (await response.json()) as JsonRpcBatchItem<string>[] | JsonRpcBatchItem<string>;
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const byId = new Map<string, JsonRpcBatchItem<string>>();
  for (const row of items) {
    byId.set(String(row.id ?? ""), row);
  }

  const out: (string | null)[] = [];
  for (const row of payload) {
    const hit = byId.get(String(row.id));
    const res = hit?.result;
    if (!hit || hit.error !== undefined || typeof res !== "string") out.push(null);
    else out.push(res);
  }
  return out;
}

async function rpcBatchCallFlexible(
  rpcUrl: string,
  calls: Array<{ method: string; params: unknown[] }>
): Promise<(string | null)[]> {
  return enqueueSpacedRpcCall(() => rpcBatchImmediateFlexible(rpcUrl, calls));
}

async function readAgentCard(uri: string | null): Promise<{ status: "online" | "offline"; name?: string }> {
  const url = normalizeAgentUri(uri);
  if (!url) return { status: "offline" };
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return { status: "offline" };
    const json = (await response.json()) as { name?: unknown; description?: unknown };
    return { status: "online", name: typeof json.name === "string" ? json.name : undefined };
  } catch {
    return { status: "offline" };
  }
}

function buildRegistryDetailCalls(tokenIds: bigint[]): Array<{ method: string; params: unknown[] }> {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  for (const tokenId of tokenIds) {
    const encodedToken = encodeUint256(tokenId);
    calls.push(
      { method: "eth_call", params: [{ to: IDENTITY_REGISTRY_ADDRESS, data: `${OWNER_OF_SELECTOR}${encodedToken}` }, "latest"] },
      { method: "eth_call", params: [{ to: IDENTITY_REGISTRY_ADDRESS, data: `${TOKEN_URI_SELECTOR}${encodedToken}` }, "latest"] }
    );
  }
  return calls;
}

async function buildRegistryAgentDisplay(
  tokenId: bigint,
  owner: string | null,
  agentUri: string | null
): Promise<RegistryAgent> {
  const card = await readAgentCard(agentUri);
  const hasCard = Boolean(agentUri);
  const cardOnline = card.status === "online";
  const name = card.name ?? `ERC-8004 Agent #${tokenId.toString()}`;
  const badges = [
    hasCard ? "AGENT_CARD_SET" : "UNVERIFIED_AGENT_CARD",
    cardOnline ? "ENDPOINT_METADATA_ONLINE" : "OFFLINE_AGENT_CARD",
    "NO_TRACE_COVERAGE"
  ];
  const riskScore = (hasCard ? 20 : 55) + (cardOnline ? 0 : 20) + 20;
  const status: RegistryAgent["status"] = !hasCard || !cardOnline ? "offline" : "untraced";

  return {
    agentId: tokenId.toString(),
    name,
    owner,
    agentUri,
    source: "registry",
    riskScore,
    status,
    badges,
    evidence: cardOnline
      ? "Registered identity found, but no Agent Black Box trace was linked in this MVP scan."
      : "Registered identity found, but its agent card metadata could not be fetched from the browser."
  };
}

async function hydrateRegistryAgentsFromChain(
  rpcUrl: string,
  tokenIds: bigint[]
): Promise<Array<RegistryAgent | null>> {
  if (tokenIds.length === 0) return [];
  if (rpcUrl.startsWith("ws://") || rpcUrl.startsWith("wss://")) {
    const rows: Array<RegistryAgent | null> = [];
    for (const tokenId of tokenIds) {
      rows.push(await fetchOneRegistryAgentSequentialRpc(rpcUrl, tokenId));
    }
    return rows;
  }

  let hexSlots: (string | null)[];
  try {
    hexSlots = await rpcBatchCallFlexible(rpcUrl, buildRegistryDetailCalls(tokenIds));
  } catch {
    return tokenIds.map(() => null);
  }
  if (hexSlots.length !== tokenIds.length * 2) {
    return tokenIds.map(() => null);
  }

  return Promise.all(
    tokenIds.map(async (tokenId, i) => {
      const ownerHex = hexSlots[i * 2];
      const uriHex = hexSlots[i * 2 + 1];
      const owner = typeof ownerHex === "string" ? decodeAddress(ownerHex) : null;
      const agentUri = typeof uriHex === "string" ? decodeAbiString(uriHex) : null;
      if (!owner) return null;
      return buildRegistryAgentDisplay(tokenId, owner, agentUri);
    })
  );
}

async function fetchOneRegistryAgentSequentialRpc(
  rpcUrl: string,
  tokenId: bigint
): Promise<RegistryAgent | null> {
  try {
    const encodedToken = encodeUint256(tokenId);
    const ownerHex = await rpcCall<string>(rpcUrl, "eth_call", [
      { to: IDENTITY_REGISTRY_ADDRESS, data: `${OWNER_OF_SELECTOR}${encodedToken}` },
      "latest"
    ]);
    const uriHex = await rpcCall<string>(rpcUrl, "eth_call", [
      { to: IDENTITY_REGISTRY_ADDRESS, data: `${TOKEN_URI_SELECTOR}${encodedToken}` },
      "latest"
    ]);
    const owner = decodeAddress(ownerHex);
    const agentUri = decodeAbiString(uriHex);
    if (!owner) return null;
    return buildRegistryAgentDisplay(tokenId, owner, agentUri);
  } catch {
    return null;
  }
}

function seededRegistryAgents(): RegistryAgent[] {
  return [
    {
      agentId: "demo-treasury-agent",
      name: "Demo Treasury Agent",
      owner: null,
      agentUri: "local://agent-cards/demo-treasury-agent.json",
      source: "seeded",
      riskScore: 8,
      status: "verified",
      badges: ["VERIFIED_TRACE_HISTORY", "RISK_REJECTION_RECORDED", "EXECUTION_LINKED"],
      evidence: "Verified demo baseline: risk rejection, policy approval, execution, and hash proof are all present."
    },
    {
      agentId: "registry-sample-offline",
      name: "Offline Registered Agent",
      owner: null,
      agentUri: null,
      source: "seeded",
      riskScore: 95,
      status: "offline",
      badges: ["OFFLINE_ENDPOINT", "UNVERIFIED_AGENT_CARD", "NO_TRACE_COVERAGE"],
      evidence: "Identity exists in the radar example, but endpoint and trace evidence are missing."
    },
    {
      agentId: "registry-sample-untraced",
      name: "Untraced Execution Agent",
      owner: null,
      agentUri: "https://example.invalid/agent-card.json",
      source: "seeded",
      riskScore: 72,
      status: "needs-review",
      badges: ["NO_TRACE_COVERAGE", "NEEDS_VERIFICATION", "WALLET_HISTORY_ONLY"],
      evidence: "Wallet activity alone is not enough. This agent needs trace-session evidence before trust."
    }
  ];
}

function mergeTracedAgent(agents: RegistryAgent[], tracedAgent: RegistryAgent): RegistryAgent[] {
  const withoutDuplicate = agents.filter((agent) => agent.agentId !== tracedAgent.agentId);
  return [tracedAgent, ...withoutDuplicate].sort((a, b) => {
    if (a.status === "verified" && b.status !== "verified") return -1;
    if (b.status === "verified" && a.status !== "verified") return 1;
    return b.riskScore - a.riskScore;
  });
}

function statusTone(status: RegistryAgent["status"]): "ok" | "warn" | "reject" | "neutral" {
  if (status === "verified") return "ok";
  if (status === "offline") return "reject";
  if (status === "needs-review") return "warn";
  return "neutral";
}

function statusLabel(status: RegistryAgent["status"]): string {
  if (status === "needs-review") return "needs review";
  return status;
}

function toQuantity(value: bigint): `0x${string}` {
  return `0x${value.toString(16)}`;
}

function encodeUint256(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function decodeAddress(value: string): string | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) return null;
  return `0x${value.slice(-40)}`;
}

function decodeAbiString(value: string): string | null {
  if (!value.startsWith("0x") || value === "0x") return null;
  const hex = value.slice(2);
  if (hex.length < 128) return null;
  const length = Number.parseInt(hex.slice(64, 128), 16);
  if (!Number.isFinite(length) || length <= 0) return null;
  const data = hex.slice(128, 128 + length * 2);
  try {
    const bytes = data.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [];
    return new TextDecoder().decode(new Uint8Array(bytes)).replace(/\0+$/, "");
  } catch {
    return null;
  }
}

function normalizeAgentUri(uri: string | null): string | null {
  if (!uri) return null;
  if (uri.startsWith("http://") || uri.startsWith("https://")) return uri;
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`;
  return null;
}

function compactUri(uri: string): string {
  if (uri.length <= 34) return uri;
  return `${uri.slice(0, 22)}...${uri.slice(-9)}`;
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
