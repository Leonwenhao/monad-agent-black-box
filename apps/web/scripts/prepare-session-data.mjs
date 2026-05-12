import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const repoRoot = resolve(appRoot, "../..");
const publicRoot = resolve(appRoot, "public");
const latestRoot = resolve(publicRoot, "session-data");
const monadRoot = resolve(publicRoot, "monad-testnet-session");
const seededRoot = resolve(publicRoot, "seeded-session");
const runnerOutRoot = resolve(repoRoot, "runner", "out");

main();

function main() {
  const { sourceRoot, sourceLabel } = selectSessionSource();
  const summary = readSummary(resolve(sourceRoot, "summary.json"));

  rmSync(latestRoot, { recursive: true, force: true });
  mkdirSync(resolve(latestRoot, "traces", summary.sessionId), { recursive: true });
  writeFileSync(resolve(latestRoot, "summary.json"), `${JSON.stringify(publicSummary(summary), null, 2)}\n`);

  for (const trace of summary.traces) {
    copyFileSync(
      resolve(sourceRoot, "traces", summary.sessionId, `${trace.step}.json`),
      resolve(latestRoot, "traces", summary.sessionId, `${trace.step}.json`)
    );
  }

  process.stdout.write(`[web] prepared session-data from ${sourceLabel}\n`);
}

function selectSessionSource() {
  if (hasUsableSessionRoot(runnerOutRoot)) {
    return { sourceRoot: runnerOutRoot, sourceLabel: "runner/out" };
  }
  if (hasUsableSessionRoot(monadRoot)) {
    return { sourceRoot: monadRoot, sourceLabel: "monad-testnet-session" };
  }
  return { sourceRoot: seededRoot, sourceLabel: "seeded-session" };
}

function hasUsableSessionRoot(root) {
  const summaryPath = resolve(root, "summary.json");
  if (!existsSync(summaryPath)) return false;

  try {
    const summary = readSummary(summaryPath);
    return summary.traces.every((trace) =>
      existsSync(resolve(root, "traces", summary.sessionId, `${trace.step}.json`))
    );
  } catch {
    return false;
  }
}

function readSummary(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function publicSummary(summary) {
  return {
    ...summary,
    chain: {
      ...summary.chain,
      rpcUrl: null
    },
    outputs: {
      sessionDir: `public/session-data/traces/${summary.sessionId}`,
      summaryPath: "public/session-data/summary.json",
      tracePaths: summary.traces.map((trace) => `public/session-data/traces/${summary.sessionId}/${trace.step}.json`)
    }
  };
}
