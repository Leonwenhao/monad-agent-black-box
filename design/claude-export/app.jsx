// Agent Black Box — main app
// Renders: Header, Risk Debate panel, Timeline (dominant center), Proof panel, Trace drawer.
// State machine for demo states: empty / running / complete / replay / failure.

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ─── helpers ────────────────────────────────────────────────────────────────
const truncHash = (h, head = 8, tail = 6) =>
  !h ? "" : (h.length <= head + tail + 2 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`);

function copyToClipboard(text) {
  try { navigator.clipboard?.writeText(text); } catch (e) {}
}

function Mono({ children, dim, copy, title }) {
  const [c, setC] = useState(false);
  return (
    <span
      className="mono"
      title={title || (typeof children === "string" ? children : undefined)}
      style={{
        cursor: copy ? "default" : undefined,
        color: dim ? "var(--fg-2)" : "var(--fg-1)",
      }}
      onClick={copy ? () => { copyToClipboard(copy); setC(true); setTimeout(() => setC(false), 900); } : undefined}
    >
      {c ? "copied" : children}
    </span>
  );
}

function Pill({ tone = "neutral", children, dot, square }) {
  return (
    <span className={`pill pill-${tone}`} data-square={square || undefined}>
      {dot && <span className="pill-dot" />}
      {children}
    </span>
  );
}

function StatusDot({ status }) {
  // status: running | confirmed | replayed | failed | idle
  return <span className={`status-dot status-${status}`} />;
}

// ─── header ─────────────────────────────────────────────────────────────────
function Header({ state, session }) {
  const statusMap = {
    empty:    { label: "Idle",       tone: "idle" },
    running:  { label: "Running",    tone: "running" },
    complete: { label: "Confirmed",  tone: "confirmed" },
    replay:   { label: "Replayed",   tone: "replayed" },
    failure:  { label: "RPC failed", tone: "failed" },
  };
  const s = statusMap[state];
  return (
    <header className="hdr">
      <div className="hdr-left">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <span className="brand-mark-inner" />
          </span>
          <span className="brand-name">Agent Black Box</span>
          <span className="brand-build mono">v0.4.2</span>
        </div>
        <span className="hdr-divider" />
        <span className="hdr-tagline">A flight recorder for autonomous on-chain agents.</span>
      </div>
      <div className="hdr-right">
        <div className="hdr-meta">
          <span className="hdr-meta-k">session</span>
          <Mono copy={session.sessionId} title={session.sessionId}>{session.shortSession}</Mono>
        </div>
        <div className="hdr-meta">
          <span className="hdr-meta-k">network</span>
          <Pill tone="purple" dot>monad-testnet · 10143</Pill>
        </div>
        <div className="hdr-meta">
          <span className="hdr-meta-k">status</span>
          <span className={`hdr-status hdr-status-${s.tone}`}>
            <StatusDot status={s.tone} />{s.label}
          </span>
        </div>
      </div>
    </header>
  );
}

// ─── timeline ───────────────────────────────────────────────────────────────
const ROLE_LABEL = {
  system: "system", planner: "planner", simulator: "simulator",
  risk: "risk", policy: "policy", executor: "executor",
  chain: "chain", registry: "registry",
};

function SeverityGlyph({ sev }) {
  if (sev === "critical") return <span className="sev sev-critical" title="critical">●</span>;
  if (sev === "warn")     return <span className="sev sev-warn"     title="warn">▲</span>;
  if (sev === "ok")       return <span className="sev sev-ok"       title="ok">✓</span>;
  return <span className="sev sev-info" title="info">·</span>;
}

function HashStatus({ status }) {
  const map = {
    anchored:  { tone: "ok",   label: "anchored" },
    pending:   { tone: "warn", label: "pending"  },
    confirmed: { tone: "ok",   label: "confirmed" },
    queued:    { tone: "neutral", label: "queued" },
  };
  const m = map[status] || map.queued;
  return <Pill tone={m.tone} square>{m.label}</Pill>;
}

function TimelineEvent({ ev, idx, total, selected, onSelect, visible }) {
  return (
    <div
      className={`tl-row${selected ? " is-selected" : ""}${ev.severity === "critical" ? " is-critical" : ""}${visible ? " is-in" : " is-out"}`}
      onClick={() => onSelect(ev.id)}
      role="button"
      tabIndex={0}
    >
      <div className="tl-gutter">
        <span className="tl-idx mono">{String(idx + 1).padStart(2, "0")}</span>
        <span className="tl-spine" />
        <span className="tl-node" data-sev={ev.severity}>
          <SeverityGlyph sev={ev.severity} />
        </span>
      </div>
      <div className="tl-card">
        <div className="tl-card-top">
          <span className="tl-role">{ROLE_LABEL[ev.role] || ev.role}</span>
          <span className="tl-t mono">{ev.t}</span>
          <span className="tl-spacer" />
          <HashStatus status={ev.hashStatus} />
        </div>
        <div className="tl-title">{ev.title}</div>
        <div className="tl-sub">{ev.sub}</div>
      </div>
    </div>
  );
}

function Timeline({ events, visibleCount, selectedId, onSelect, state }) {
  const listRef = useRef(null);

  useEffect(() => {
    // auto-scroll to bottom when new events appear (running state)
    if (state === "running" && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [visibleCount, state]);

  return (
    <section className="panel timeline-panel">
      <div className="panel-hd">
        <div className="panel-hd-l">
          <span className="panel-eyebrow">02 ·</span>
          <h3 className="panel-title">Trace timeline</h3>
        </div>
        <div className="panel-hd-r">
          <span className="panel-meta mono">{visibleCount}/{events.length} events</span>
          <span className="panel-meta-sep" />
          <span className="panel-meta">durations from t₀</span>
        </div>
      </div>
      <div className="tl-list" ref={listRef}>
        {events.map((ev, i) => (
          <TimelineEvent
            key={ev.id}
            ev={ev}
            idx={i}
            total={events.length}
            selected={selectedId === ev.id}
            onSelect={onSelect}
            visible={i < visibleCount}
          />
        ))}
        {visibleCount < events.length && (
          <div className="tl-pending">
            <span className="tl-pending-pulse" />
            <span className="mono">awaiting next event…</span>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── risk debate ────────────────────────────────────────────────────────────
function RiskDebate({ events, state }) {
  const e_plan = events.find(e => e.payload?.type === "PlanGenerated");
  const e_simA = events.find(e => e.payload?.type === "SimulationResult" && e.payload.candidateId === "A");
  const e_simB = events.find(e => e.payload?.type === "SimulationResult" && e.payload.candidateId === "B");
  const e_eval = events.find(e => e.payload?.type === "RiskEvaluation");

  const A = e_simA?.payload;
  const B = e_simB?.payload;
  const verdicts = e_eval?.payload?.verdicts || [];
  const verdictA = verdicts.find(v => v.candidateId === "A");
  const verdictB = verdicts.find(v => v.candidateId === "B");

  const ready = state !== "empty";

  return (
    <section className="panel risk-panel">
      <div className="panel-hd">
        <div className="panel-hd-l">
          <span className="panel-eyebrow">03 ·</span>
          <h3 className="panel-title">Risk debate</h3>
        </div>
        <Pill tone="neutral" square>{e_eval?.payload?.policy || "policy-v3.risk.strict"}</Pill>
      </div>

      {!ready ? (
        <div className="empty-mini">Awaiting plan…</div>
      ) : (
        <>
          <p className="risk-copy">The risk agent rejected this path before execution.</p>

          {/* Candidate A — rejected */}
          <div className="cand cand-rejected">
            <div className="cand-strike" aria-hidden="true">
              <span /><span /><span /><span /><span /><span />
            </div>
            <div className="cand-hd">
              <span className="cand-id">A</span>
              <span className="cand-path">{A?.candidateId ? "Aave → Curve → Aave" : "—"}</span>
              <Pill tone="reject">REJECTED</Pill>
            </div>
            <dl className="cand-grid">
              <div><dt>slippage</dt><dd className="bad mono">{A ? `${A.observedSlippageBps} bps` : "—"} <span className="dim">/ 25</span></dd></div>
              <div><dt>sandwich</dt><dd className="bad mono">{A ? A.mev.sandwichRisk.toFixed(2) : "—"} <span className="dim">/ 0.20</span></dd></div>
              <div><dt>sim pnl</dt><dd className="mono">{A ? `+$${A.pnlUsd.toFixed(0)}` : "—"}</dd></div>
              <div><dt>fork blk</dt><dd className="mono dim">{A ? A.forkBlock : "—"}</dd></div>
            </dl>
            {verdictA && (
              <div className="cand-reasons">
                {verdictA.reasons.map(r => (
                  <span key={r} className="reason reason-bad mono">{r}</span>
                ))}
              </div>
            )}
          </div>

          {/* Candidate B — approved */}
          <div className="cand cand-approved">
            <div className="cand-hd">
              <span className="cand-id">B</span>
              <span className="cand-path">Compound → Uniswap v3 → Compound</span>
              <Pill tone="ok">APPROVED</Pill>
            </div>
            <dl className="cand-grid">
              <div><dt>slippage</dt><dd className="ok mono">{B ? `${B.observedSlippageBps} bps` : "—"} <span className="dim">/ 25</span></dd></div>
              <div><dt>sandwich</dt><dd className="ok mono">{B ? B.mev.sandwichRisk.toFixed(2) : "—"} <span className="dim">/ 0.20</span></dd></div>
              <div><dt>sim pnl</dt><dd className="mono">{B ? `+$${B.pnlUsd.toFixed(0)}` : "—"}</dd></div>
              <div><dt>fork blk</dt><dd className="mono dim">{B ? B.forkBlock : "—"}</dd></div>
            </dl>
            {verdictB && (
              <div className="cand-reasons">
                {verdictB.reasons.map(r => (
                  <span key={r} className="reason reason-good mono">{r}</span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ─── proof panel ────────────────────────────────────────────────────────────
function ProofRow({ k, children, copy }) {
  return (
    <div className="proof-row">
      <span className="proof-k">{k}</span>
      <span className="proof-v">
        {children}
        {copy && (
          <button className="proof-copy mono" onClick={() => copyToClipboard(copy)} title="copy">⧉</button>
        )}
      </span>
    </div>
  );
}

function ProofPanel({ session, state, events }) {
  const r = session.registry;
  const verified = state === "complete" || state === "replay";
  const failure = state === "failure";

  return (
    <section className="panel proof-panel">
      <div className="panel-hd">
        <div className="panel-hd-l">
          <span className="panel-eyebrow">04 ·</span>
          <h3 className="panel-title">Onchain proof</h3>
        </div>
        {state === "replay" && <Pill tone="purple" square>replay</Pill>}
      </div>

      <p className="proof-copy">
        This trace payload hashes to the <span className="kw">contentHash</span> emitted
        by <span className="kw">TraceRegistry</span> on Monad testnet.
      </p>

      <div className={`proof-match proof-match-${verified ? "ok" : failure ? "bad" : "wait"}`}>
        <div className="proof-match-lhs">
          <span className="proof-match-lbl">hash match</span>
          <span className="proof-match-state">
            {verified ? "verified" : failure ? "unverified" : "pending"}
          </span>
        </div>
        <div className="proof-match-rhs">
          <div className="proof-match-cmp">
            <div className="cmp-side">
              <span className="cmp-k">local</span>
              <span className="mono">{truncHash(r.contentHash, 10, 8)}</span>
            </div>
            <span className={`cmp-eq cmp-eq-${verified ? "ok" : failure ? "bad" : "wait"}`}>
              {verified ? "=" : failure ? "≠" : "?"}
            </span>
            <div className="cmp-side">
              <span className="cmp-k">onchain</span>
              <span className="mono">{verified ? truncHash(r.chainHash, 10, 8) : (failure ? "rpc · n/a" : "—")}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="proof-grid">
        <ProofRow k="registry" copy={r.address}>
          <Mono copy={r.address}>{truncHash(r.address, 10, 8)}</Mono>
        </ProofRow>
        <ProofRow k="session" copy={session.sessionId}>
          <Mono copy={session.sessionId}>{truncHash(session.sessionId, 10, 8)}</Mono>
        </ProofRow>
        <ProofRow k="events">
          <span className="mono">{r.eventCount}</span>
          <span className="dim mono"> · {((events.find(e => e.payload?.type === "SessionSummary")?.payload?.durationMs)/1000 || 0).toFixed(2)}s</span>
        </ProofRow>
        <ProofRow k="contentHash" copy={r.contentHash}>
          <Mono copy={r.contentHash}>{truncHash(r.contentHash, 12, 10)}</Mono>
        </ProofRow>
        <ProofRow k="final tx" copy={r.finalTxHash}>
          <Mono copy={r.finalTxHash}>{truncHash(r.finalTxHash, 12, 10)}</Mono>
        </ProofRow>
        <ProofRow k="block">
          <span className="mono">{r.blockNumber.toLocaleString()}</span>
          <span className="dim mono"> · {r.gasUsed.toLocaleString()} gas</span>
        </ProofRow>
      </div>

      <div className="proof-links">
        <a href="#" className="proof-link" onClick={(e) => e.preventDefault()}>
          <span>explorer · tx</span><span className="proof-link-arr">↗</span>
        </a>
        <a href="#" className="proof-link" onClick={(e) => e.preventDefault()}>
          <span>explorer · registry</span><span className="proof-link-arr">↗</span>
        </a>
        <a href="#" className="proof-link" onClick={(e) => e.preventDefault()}>
          <span>download trace.json</span><span className="proof-link-arr">↓</span>
        </a>
      </div>
    </section>
  );
}

// ─── trace drawer ───────────────────────────────────────────────────────────
function jsonLines(obj, indent = 0, lines = []) {
  // produces tokenized lines for syntax-ish coloring
  const pad = "  ".repeat(indent);
  if (obj === null) { lines.push({ pad, tokens: [{ t: "null", v: "null" }] }); return lines; }
  if (Array.isArray(obj)) {
    lines.push({ pad, tokens: [{ t: "p", v: "[" }] });
    obj.forEach((v, i) => {
      const sub = jsonLines(v, indent + 1, []);
      sub.forEach((ln, k) => {
        if (k === sub.length - 1 && i < obj.length - 1) ln.tokens.push({ t: "p", v: "," });
        lines.push(ln);
      });
    });
    lines.push({ pad, tokens: [{ t: "p", v: "]" }] });
    return lines;
  }
  if (typeof obj === "object") {
    lines.push({ pad, tokens: [{ t: "p", v: "{" }] });
    const keys = Object.keys(obj);
    keys.forEach((k, i) => {
      const v = obj[k];
      if (v !== null && typeof v === "object") {
        lines.push({ pad: pad + "  ", tokens: [{ t: "k", v: `"${k}"` }, { t: "p", v: ": " }] });
        const sub = jsonLines(v, indent + 1, []);
        // merge first line of sub onto last pushed
        const head = lines[lines.length - 1];
        head.tokens.push(...sub[0].tokens);
        for (let j = 1; j < sub.length; j++) lines.push(sub[j]);
        if (i < keys.length - 1) lines[lines.length - 1].tokens.push({ t: "p", v: "," });
      } else {
        const tokens = [{ t: "k", v: `"${k}"` }, { t: "p", v: ": " }];
        if (typeof v === "string")  tokens.push({ t: "s", v: `"${v}"` });
        else if (typeof v === "number") tokens.push({ t: "n", v: String(v) });
        else if (typeof v === "boolean") tokens.push({ t: "b", v: String(v) });
        else tokens.push({ t: "n", v: String(v) });
        if (i < keys.length - 1) tokens.push({ t: "p", v: "," });
        lines.push({ pad: pad + "  ", tokens });
      }
    });
    lines.push({ pad, tokens: [{ t: "p", v: "}" }] });
    return lines;
  }
  // primitive
  if (typeof obj === "string") lines.push({ pad, tokens: [{ t: "s", v: `"${obj}"` }] });
  else lines.push({ pad, tokens: [{ t: "n", v: String(obj) }] });
  return lines;
}

function JsonView({ data }) {
  const lines = useMemo(() => jsonLines(data), [data]);
  return (
    <pre className="json mono">
      {lines.map((ln, i) => (
        <div key={i} className="json-line">
          <span className="json-ln">{String(i + 1).padStart(2, "0")}</span>
          <span className="json-c">
            {ln.pad}
            {ln.tokens.map((tk, j) => (
              <span key={j} className={`jt jt-${tk.t}`}>{tk.v}</span>
            ))}
          </span>
        </div>
      ))}
    </pre>
  );
}

function fakeHashFor(ev) {
  // deterministic-ish: hash from event id
  const seeds = "abcdef0123456789";
  let s = "0x";
  let n = 0;
  for (let i = 0; i < ev.id.length; i++) n = (n * 31 + ev.id.charCodeAt(i)) >>> 0;
  for (let i = 0; i < 64; i++) {
    n = (n * 1103515245 + 12345) >>> 0;
    s += seeds[(n >>> (i & 28)) & 15];
  }
  return s;
}

function Drawer({ event, onClose }) {
  const open = !!event;
  const localHash  = event ? fakeHashFor(event) : "";
  const chainHash  = event ? localHash : ""; // match
  const explain = event ? EXPLAIN[event.payload?.type] || "Raw payload below." : "";

  return (
    <>
      <div className={`drw-scrim${open ? " is-open" : ""}`} onClick={onClose} />
      <aside className={`drw${open ? " is-open" : ""}`} aria-hidden={!open}>
        {event && (
          <>
            <div className="drw-hd">
              <div className="drw-hd-l">
                <span className="drw-eyebrow mono">
                  event {event.id} · {event.role} · {event.t}
                </span>
                <h3 className="drw-title">{event.title}</h3>
              </div>
              <div className="drw-hd-r">
                <Pill tone={severityTone(event.severity)} square>{event.severity}</Pill>
                <button className="drw-close" onClick={onClose} aria-label="close">esc</button>
              </div>
            </div>

            <div className="drw-explain">{explain}</div>

            <div className="drw-cmp">
              <div className="drw-cmp-row">
                <span className="drw-cmp-k">local hash</span>
                <Mono copy={localHash}>{truncHash(localHash, 14, 10)}</Mono>
              </div>
              <div className="drw-cmp-row">
                <span className="drw-cmp-k">onchain hash</span>
                <Mono copy={chainHash}>{truncHash(chainHash, 14, 10)}</Mono>
              </div>
              <div className="drw-cmp-row drw-cmp-eq">
                <span className="drw-cmp-k">match</span>
                <span className="ok mono">= verified</span>
              </div>
            </div>

            <div className="drw-json-hd">
              <span className="drw-json-k">payload.json</span>
              <span className="dim mono">{Object.keys(event.payload || {}).length} keys</span>
            </div>
            <div className="drw-json-wrap">
              <JsonView data={event.payload} />
            </div>
          </>
        )}
      </aside>
    </>
  );
}

const EXPLAIN = {
  GoalReceived: "Goal handed to the agent with hard constraints. Constraints are pinned into the trace so risk and policy agents can be reproduced deterministically.",
  PlanGenerated: "Planner emits N candidate execution paths. Each candidate is scored offline; nothing has touched the chain yet.",
  SimulationResult: "Each candidate is forked against a recent state. We record observed vs expected slippage and MEV estimates.",
  RiskEvaluation: "Risk agent compares simulation outputs against policy thresholds. Verdicts are recorded for every candidate, not only the winner.",
  CandidateRejected: "This candidate would have breached policy. It is blocked from execution and the reason codes are anchored to the trace.",
  PolicyApproved: "Approval is short-lived (ttl) and bound to a specific signer + allow list. Anything outside the allow list is rejected at submit time.",
  TxSubmitted: "Bundle submitted to the mempool. Trace records nonce, fee and call decoder output before confirmation.",
  TxConfirmed: "Receipt observed. Logs are stored; gas and effective price are pinned for audit.",
  TraceAnchored: "TraceRegistry.commit(sessionId, contentHash) writes the trace digest to Monad. Anyone can verify the offchain bundle against the onchain hash.",
  SessionSummary: "Final tally. Hash match indicates the offchain payload reproduces bit-for-bit the value committed onchain.",
};

function severityTone(s) {
  return s === "critical" ? "reject" : s === "warn" ? "warn" : s === "ok" ? "ok" : "neutral";
}

// ─── Empty & Failure states ─────────────────────────────────────────────────
function EmptyState({ onRun }) {
  return (
    <div className="empty">
      <div className="empty-inner">
        <div className="empty-glyph" aria-hidden="true">
          <span /><span /><span /><span />
        </div>
        <div className="empty-eyebrow mono">no session</div>
        <h2 className="empty-title">No session selected.</h2>
        <p className="empty-sub">
          Open a recorded trace from the registry, or run the seeded demo to see
          how the flight recorder captures plan → risk → execution → proof.
        </p>
        <div className="empty-cta">
          <button className="btn btn-primary" onClick={onRun}>▶  Run demo</button>
          <button className="btn btn-ghost">browse registry</button>
        </div>
        <div className="empty-tail mono">
          registry · 0x9B3a…A3c1 &nbsp;·&nbsp; monad-testnet · chainId 10143
        </div>
      </div>
    </div>
  );
}

function FailureBanner({ onReplay }) {
  return (
    <div className="fail-banner">
      <div className="fail-banner-l">
        <span className="fail-dot" />
        <div>
          <div className="fail-title">RPC failed · monad-testnet primary endpoint timeout (1822 ms)</div>
          <div className="fail-sub mono">last_block=18482171 · last_seen=14:32:08Z · fallback=seeded-replay</div>
        </div>
      </div>
      <button className="btn btn-warn" onClick={onReplay}>load seeded replay →</button>
    </div>
  );
}

// ─── main app ───────────────────────────────────────────────────────────────
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "demoState": "complete",
  "drawerOpenById": "e06",
  "showSeams": false
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const state = t.demoState; // 'empty' | 'running' | 'complete' | 'replay' | 'failure'
  const events = window.TRACE_EVENTS;
  const session = window.TRACE_SESSION;

  const [selectedId, setSelectedId] = useState(t.drawerOpenById || null);
  const [visibleCount, setVisibleCount] = useState(events.length);

  // keep selected event in sync with tweak
  useEffect(() => {
    setSelectedId(t.drawerOpenById || null);
  }, [t.drawerOpenById]);

  // running state animation
  useEffect(() => {
    if (state === "running") {
      setVisibleCount(0);
      let i = 0;
      const tick = () => {
        i += 1;
        setVisibleCount(i);
        if (i < events.length) setTimeout(tick, 480 + Math.random() * 220);
      };
      const id = setTimeout(tick, 350);
      return () => clearTimeout(id);
    } else {
      setVisibleCount(events.length);
    }
  }, [state, events.length]);

  // keyboard close drawer
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectedEv = events.find(e => e.id === selectedId) || null;

  const runDemo = () => setTweak("demoState", "running");
  const replay  = () => setTweak("demoState", "replay");

  // empty state takes the full canvas
  if (state === "empty") {
    return (
      <div className="app">
        <Header state={state} session={session} />
        <EmptyState onRun={runDemo} />
        <AppTweaks t={t} setTweak={setTweak} />
      </div>
    );
  }

  return (
    <div className={`app state-${state}${t.showSeams ? " show-seams" : ""}`}>
      <Header state={state} session={session} />
      {state === "failure" && <FailureBanner onReplay={replay} />}

      <main className="grid">
        <RiskDebate events={events.slice(0, visibleCount)} state={state} />
        <Timeline
          events={events}
          visibleCount={visibleCount}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
          state={state}
        />
        <ProofPanel session={session} state={state} events={events} />
      </main>

      <Drawer event={selectedEv} onClose={() => setSelectedId(null)} />
      <AppTweaks t={t} setTweak={setTweak} />
    </div>
  );
}

function AppTweaks({ t, setTweak }) {
  return (
    <TweaksPanel>
      <TweakSection label="Demo state" />
      <TweakSelect
        label="state"
        value={t.demoState}
        options={["empty", "running", "complete", "replay", "failure"]}
        onChange={(v) => setTweak("demoState", v)}
      />
      <TweakSection label="Trace drawer" />
      <TweakSelect
        label="open event"
        value={t.drawerOpenById || "none"}
        options={["none", ...window.TRACE_EVENTS.map(e => `${e.id} · ${e.title}`)]}
        onChange={(v) => {
          const id = v === "none" ? null : v.split(" · ")[0];
          setTweak("drawerOpenById", id);
        }}
      />
      <TweakSection label="Debug" />
      <TweakToggle
        label="show grid seams"
        value={!!t.showSeams}
        onChange={(v) => setTweak("showSeams", v)}
      />
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
