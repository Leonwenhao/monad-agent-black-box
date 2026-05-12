#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const failureLogPath = resolve(repoRoot, "docs", "dev", "test_logs", "goal8-monad-deploy.log");

loadDotEnv(resolve(repoRoot, ".env"));

const childEnv = {
  ...process.env,
  RUNNER_TARGET: "monad-testnet"
};

const steps = [
  { label: "schema build", command: "npm", args: ["run", "schema:build"] },
  { label: "contracts build", command: "npm", args: ["run", "contracts:build"] },
  { label: "Monad scripted runner", command: "npm", args: ["--workspace", "runner", "run", "demo:scripted"] },
  { label: "web session preparation", command: "npm", args: ["run", "web:prepare-session"] }
];

const transcript = [];

for (const step of steps) {
  const header = `[goal8] ${step.label}: ${step.command} ${step.args.join(" ")}\n`;
  process.stdout.write(header);
  transcript.push(header);

  const result = await runStep(step, childEnv);
  if (result.code !== 0) {
    writeFailureLog(step, result);
    process.exit(result.code ?? 1);
  }
}

function runStep(step, env) {
  return new Promise((resolveStep) => {
    const child = spawn(step.command, step.args, {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      process.stdout.write(text);
      transcript.push(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      process.stderr.write(text);
      transcript.push(text);
    });
    child.on("error", (error) => {
      const text = `${error.message}\n`;
      process.stderr.write(text);
      transcript.push(text);
      resolveStep({ code: 1, signal: null });
    });
    child.on("exit", (code, signal) => resolveStep({ code: code ?? 1, signal }));
  });
}

function writeFailureLog(step, result) {
  mkdirSync(dirname(failureLogPath), { recursive: true });
  const sanitizedTranscript = sanitizeSecretValues(transcript.join(""));
  const runnerFailure = sanitizedTranscript
    .split(/\r?\n/)
    .find((line) => line.includes("[runner:FAILED]"));
  const error = runnerFailure ? runnerFailure.replace(/^.*\[runner:FAILED\]\s*/, "") : `${step.label} failed`;
  const body = [
    "# Goal 8 Monad Deploy Failure",
    "",
    `timestamp: ${new Date().toISOString()}`,
    "command: npm run runner:demo:monad",
    `failedStep: ${step.label}`,
    `exitCode: ${result.code}`,
    `signal: ${result.signal ?? "null"}`,
    `error: ${error}`,
    "",
    "## Sanitized output",
    "",
    "```text",
    sanitizedTranscript.trimEnd(),
    "```",
    ""
  ].join("\n");
  writeFileSync(failureLogPath, body, "utf8");
}

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquoteEnvValue(rawValue.trim());
  }
}

function unquoteEnvValue(value) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function sanitizeSecretValues(value) {
  let sanitized = value;
  sanitized = sanitized.split(repoRoot).join("[repo]");
  for (const key of ["RUNNER_PRIVATE_KEY", "MONAD_RPC_URL", "RUNNER_RPC_URL"]) {
    const secret = process.env[key];
    if (secret) {
      sanitized = sanitized.split(secret).join(`[redacted ${key}]`);
      if (key === "RUNNER_PRIVATE_KEY") {
        sanitized = sanitized.replace(new RegExp(escapeRegExp(secret), "gi"), `[redacted ${key}]`);
      }
    }
  }
  return sanitized;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
