/**
 * One-shot fetch of 8004scan agent IDs (HTML list). Writes a static JSON bundle
 * for the browser — do not scrape from the client on each page load.
 *
 * Usage: node scripts/scrape-8004scan-agents.mjs
 * Override URL: SCRAPE_URL=https://8004scan.io/agents?chain=143&pageSize=100
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_URL = "https://8004scan.io/agents?chain=143&pageSize=100";
const MAX_IDS = 100;
const OUT_REL = "../public/catalog/8004scan-agents-monad-143.json";

function parseMonadAgentTokenIds(html) {
  const re = /\/agents\/monad\/(\d+)/g;
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
      if (out.length >= MAX_IDS) break;
    }
  }
  return out;
}

async function main() {
  const url = process.env.SCRAPE_URL?.trim() || DEFAULT_URL;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`HTTP ${res.status} from ${url}`);
    process.exit(1);
  }
  const html = await res.text();
  const agentTokenIds = parseMonadAgentTokenIds(html);
  const payload = {
    source: "8004scan.io",
    scrapeUrl: url,
    fetchedAt: new Date().toISOString(),
    chainId: 143,
    agentTokenIds
  };
  const outPath = path.join(__dirname, OUT_REL);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${agentTokenIds.length} ids → ${path.relative(process.cwd(), outPath)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
