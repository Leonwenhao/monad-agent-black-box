import { StrictMode, useEffect, useState } from "react";
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

type Severity = "info" | "warning" | "critical";
type SessionSource = "latest" | "seeded";

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
  recordTxHash: string | null;
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

function App() {
  const [sessionState, setSessionState] = useState<SessionState>({ status: "loading" });
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

  if (sessionState.status === "loading") {
    return <StatePanel title="Loading session data" message="Reading the latest bundled trace session and the committed seed fallback." />;
  }

  if (sessionState.status === "error") {
    return <StatePanel title="Session data unavailable" message={sessionState.message} />;
  }

  const { latest, seeded } = sessionState;
  const activeSession = activeSource === "latest" ? latest : seeded;
  const latestMatchesSeed = sameSession(latest, seeded);
  const hasDistinctLatest = !latestMatchesSeed;
  const selected =
    activeSession.traces.find((item) => item.trace.step === selectedStep) ?? activeSession.traces[0];
  const selectedHashMatches = hashTracePayload(selected.trace) === selected.trace.contentHash;
  const allHashesMatch = activeSession.traces.every((item) => hashTracePayload(item.trace) === item.trace.contentHash);
  const controlLabel = activeSource === "seeded" && hasDistinctLatest ? "View Latest Session" : "Replay Seeded Session";
  const statusBadge = activeSource === "seeded"
    ? "Seeded replay"
    : latestMatchesSeed
      ? "Seeded fallback"
      : "Latest runner session";

  return (
    <main className="appShell">
      <header className="topBar">
        <div>
          <p className="eyebrow">Agent Black Box</p>
          <h1>A flight recorder for autonomous on-chain agents.</h1>
        </div>
        <div className="statusCluster">
          <span className="badge replay">{statusBadge}</span>
          <span className="badge network">{activeSession.chainLabel}</span>
          <span className={activeSession.summary.chain.submitted ? "badge verified" : "badge"}>
            {activeSession.summary.mode}
          </span>
        </div>
      </header>

      <aside className="sessionRail" aria-label="Session list">
        <div className="railHeader">
          <h2>Sessions</h2>
          <div className="controlStack">
            <button type="button" disabled>
              Run Demo Session
            </button>
            <p className="controlNote">CLI-only for now. Run `npm run runner:demo`, then refresh or rebuild to load the new output.</p>
          </div>
          <div className="controlStack">
            <button
              type="button"
              className="secondary"
              disabled={!hasDistinctLatest}
              onClick={() => activateSource(controlLabel === "View Latest Session" ? "latest" : "seeded")}
            >
              {controlLabel}
            </button>
            <p className="controlNote">
              {hasDistinctLatest
                ? "Switch between copied runner output and the committed fallback session."
                : "The seeded fallback is already the only bundled session."}
            </p>
          </div>
        </div>

        <button
          type="button"
          className={`sessionItem ${activeSource === "latest" ? "active" : ""}`}
          onClick={() => activateSource("latest")}
        >
          <span>{latestMatchesSeed ? "Build-safe fallback session" : "Latest runner output"}</span>
          <code>{shortHash(latest.summary.sessionId)}</code>
          <small>{latest.chainLabel} · {latest.summary.eventCount} events · {allHashesLabel(latest)}</small>
        </button>

        {hasDistinctLatest ? (
          <button
            type="button"
            className={`sessionItem seeded ${activeSource === "seeded" ? "active" : ""}`}
            onClick={() => activateSource("seeded")}
          >
            <span>Committed seeded fallback</span>
            <code>{shortHash(seeded.summary.sessionId)}</code>
            <small>{seeded.chainLabel} · {seeded.summary.eventCount} events · {allHashesLabel(seeded)}</small>
          </button>
        ) : null}
      </aside>

      <section className="timelinePane" aria-label="Trace timeline">
        <div className="sectionHeader">
          <div>
            <h2>Flight Recorder Timeline</h2>
            <p>{activeSession.summary.mode} · {shortHash(activeSession.summary.sessionId)}</p>
          </div>
          <span className={allHashesMatch ? "hashOk" : "hashBad"}>
            {allHashesMatch ? "Hashes match JSON" : "Hash mismatch"}
          </span>
        </div>
        <div className="timeline">
          {activeSession.traces.map(({ trace, severity }) => (
            <button
              className={`traceEvent ${trace.step === selected.trace.step ? "selected" : ""} ${severity}`}
              key={`${activeSource}:${trace.step}`}
              onClick={() => setSelectedStep(trace.step)}
              type="button"
            >
              <span className="stepIndex">{String(trace.step).padStart(2, "0")}</span>
              <span className="eventBody">
                <span className="eventTitle">{trace.eventType}</span>
                <span className="eventMeta">{trace.role} · {severity}</span>
                <span className="eventSummary">{trace.summary}</span>
              </span>
              <code title={trace.contentHash}>{shortHash(trace.contentHash)}</code>
            </button>
          ))}
        </div>
      </section>

      <aside className="rightRail">
        <RiskDebate traces={activeSession.traces} />
        <ProofPanel activeSession={activeSession} selected={selected} hashMatches={selectedHashMatches} />
      </aside>

      <section className="detailDrawer" aria-label="Trace detail drawer">
        <div className="sectionHeader">
          <div>
            <h2>{selected.trace.eventType}</h2>
            <p>{selected.trace.role} · step {selected.trace.step}</p>
          </div>
          <span className={selectedHashMatches ? "hashOk" : "hashBad"}>
            {selectedHashMatches ? "Hash verified" : "Hash mismatch"}
          </span>
        </div>
        <p className="proofCopy">{activeSession.proofCopy}</p>
        <dl className="detailGrid">
          <div>
            <dt>Content hash</dt>
            <dd title={selected.trace.contentHash}>{selected.trace.contentHash}</dd>
          </div>
          <div>
            <dt>Runner file</dt>
            <dd>{runnerFilePath(activeSession.summary.sessionId, selected.trace.step)}</dd>
          </div>
          <div>
            <dt>Record tx</dt>
            <dd>{selected.recordTxHash ?? "No trace-record tx for this replay"}</dd>
          </div>
        </dl>
        <pre>{selected.rawJson}</pre>
      </section>
    </main>
  );

  function activateSource(source: SessionSource): void {
    const nextSession = source === "latest" ? latest : seeded;
    setActiveSource(source);
    setSelectedStep(defaultStepFor(nextSession));
  }
}

function RiskDebate({ traces }: { traces: LoadedTrace[] }) {
  const rejection = traces.find((item) => item.trace.eventType === "risk.rejection")?.trace;
  const approval = traces.find((item) => item.trace.eventType === "policy.approved")?.trace;
  const reasonCodes = readStringArray(rejection?.output.reasonCodes);
  const codes = reasonCodes.length > 0 ? reasonCodes : ["UNLIMITED_APPROVAL", "UNVERIFIED_TARGET"];

  return (
    <section className="riskPanel">
      <div className="sectionHeader">
        <h2>Risk Debate</h2>
        <span className="badge critical">Rejected path</span>
      </div>
      <div className="decision rejected">
        <span>Candidate A</span>
        <strong>{readString(rejection?.input.candidateAction) ?? "Unlimited approval"}</strong>
        <p>{rejection?.summary ?? "The risk agent rejected this path before execution."}</p>
        <div className="reasonCodes">
          {codes.map((code) => (
            <code key={code}>{code}</code>
          ))}
        </div>
      </div>
      <div className="decision approved">
        <span>Candidate B</span>
        <strong>{readString(approval?.input.candidateAction) ?? "Bounded demo action"}</strong>
        <p>{approval?.summary ?? "Approved because exposure is capped and the final action is trace-linked."}</p>
      </div>
    </section>
  );
}

function ProofPanel({
  activeSession,
  selected,
  hashMatches
}: {
  activeSession: LoadedSession;
  selected: LoadedTrace;
  hashMatches: boolean;
}) {
  const summary = activeSession.summary;
  const explorerHref = activeSession.explorerBase
    ? `${activeSession.explorerBase}/tx/${summary.chain.executionTxHash}`
    : null;

  return (
    <section className="proofPanel">
      <div className="sectionHeader">
        <h2>On-chain Proof</h2>
        <span className={hashMatches ? "hashOk" : "hashBad"}>{hashMatches ? "Verified" : "Mismatch"}</span>
      </div>
      <dl className="proofList">
        <div>
          <dt>Network</dt>
          <dd>{activeSession.chainLabel}</dd>
        </div>
        <div>
          <dt>Registry</dt>
          <dd title={summary.chain.registryAddress ?? undefined}>{summary.chain.registryAddress ?? "No registry receipt"}</dd>
        </div>
        <div>
          <dt>Session ID</dt>
          <dd title={summary.sessionId}>{summary.sessionId}</dd>
        </div>
        <div>
          <dt>Event count</dt>
          <dd>{summary.eventCount}</dd>
        </div>
        <div>
          <dt>Final tx</dt>
          <dd title={summary.chain.executionTxHash}>{summary.chain.executionTxHash}</dd>
        </div>
        <div>
          <dt>Selected hash</dt>
          <dd title={selected.trace.contentHash}>{selected.trace.contentHash}</dd>
        </div>
      </dl>

      <div className="proofLinks">
        {explorerHref ? (
          <a href={explorerHref} rel="noreferrer" target="_blank">
            View transaction on Monad explorer
          </a>
        ) : (
          <p className="proofLinkMuted">No public explorer link is shown for {activeSession.chainLabel} receipts.</p>
        )}
      </div>
      <p className="proofNote">{summary.chain.note}</p>
    </section>
  );
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
      return {
        trace,
        rawJson,
        severity: severityFor(trace.eventType),
        recordTxHash: summary.chain.traceRecordTxHashes.find((tx) => tx.step === trace.step)?.txHash ?? null
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
  return session.traces.find((item) => item.trace.eventType === "risk.rejection")?.trace.step ?? session.traces[0].trace.step;
}

function chainLabelFor(summary: RunnerSummary): string {
  if (summary.chain.chainId === 10143) return "Monad testnet";
  if (summary.chain.chainId === 31337) return "Local Anvil";
  if (summary.chain.chainId !== null) return `Chain ${summary.chain.chainId}`;
  return "Offline replay";
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
  return "This trace payload hashes deterministically for offline replay mode; no public-chain receipt was submitted in this session.";
}

function explorerBaseFor(summary: RunnerSummary): string | null {
  if (summary.chain.chainId === 10143) {
    return import.meta.env.VITE_MONAD_EXPLORER_BASE_URL ?? "https://testnet.monadexplorer.com";
  }
  return null;
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

function allHashesLabel(session: LoadedSession): string {
  return session.traces.every((item) => hashTracePayload(item.trace) === item.trace.contentHash) ? "verified" : "hash mismatch";
}

function runnerFilePath(sessionId: string, step: number): string {
  return `runner/out/traces/${sessionId}/${step}.json`;
}

function severityFor(eventType: TraceEventType): Severity {
  if (eventType === "risk.rejection") return "critical";
  if (eventType === "tool.simulation") return "warning";
  return "info";
}

function shortHash(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function readString(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function readStringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
