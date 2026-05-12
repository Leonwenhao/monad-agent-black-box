import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createTraceEntry, REQUIRED_TRACE_EVENT_TYPES, type TraceEntry } from "@agent-black-box/trace-schema";
import "./styles.css";

const sessionId = "0x1111111111111111111111111111111111111111111111111111111111111111";

const traceEvents: TraceEntry[] = REQUIRED_TRACE_EVENT_TYPES.map((eventType, index) =>
  createTraceEntry({
    sessionId,
    step: index + 1,
    eventType,
    role: eventType.startsWith("risk") ? "risk-agent" : "deterministic-demo",
    summary: `Seeded ${eventType} trace event ready for replay wiring.`,
    input: {
      source: "seeded-ui"
    },
    output: {
      status: index === REQUIRED_TRACE_EVENT_TYPES.length - 1 ? "complete" : "recorded"
    },
    model: {
      provider: "deterministic-demo",
      model: "scripted-v1"
    },
    uri: `local://traces/local-placeholder-session/${index + 1}.json`,
    createdAt: "2026-05-12T00:00:00.000Z"
  })
);

function App() {
  return (
    <main className="shell">
      <section className="timeline">
        <p className="eyebrow">Monad Agent Black Box</p>
        <h1>Flight recorder for autonomous on-chain agents</h1>
        <div className="events">
          {traceEvents.map((trace, index) => (
            <article className="event" key={trace.eventType}>
              <span className="step">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h2>{trace.eventType}</h2>
                <p>{trace.summary}</p>
                <code>{trace.contentHash}</code>
              </div>
            </article>
          ))}
        </div>
      </section>
      <aside className="proof">
        <h2>Proof Panel</h2>
        <dl>
          <div>
            <dt>Registry</dt>
            <dd>{import.meta.env.VITE_TRACE_REGISTRY_ADDRESS ?? "not deployed"}</dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>local-placeholder-session</dd>
          </div>
          <div>
            <dt>Events</dt>
            <dd>{traceEvents.length}</dd>
          </div>
        </dl>
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
