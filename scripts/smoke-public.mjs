// Verifies the 8 prerendered public routes hydrate cleanly — no React
// hydration warnings (#418/#419), no console errors that match the
// hydration-mismatch patterns. Hits each route via scripts/serve-dist
// (which mimics Vercel/Netlify pretty-URL handling) so we exercise
// the same code path real visitors will go through, not vite preview's
// trailing-slash-only directory matching.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import puppeteer from "puppeteer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 4180;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const ROUTES = ["/", "/pricing", "/faq", "/contact", "/login", "/register", "/privacy", "/terms"];

function log(m) { process.stdout.write(`[smoke-public] ${m}\n`); }
function fail(m) { process.stderr.write(`[smoke-public] FAIL: ${m}\n`); }

async function pingServer() { try { return (await fetch(`${ORIGIN}/`)).ok; } catch { return false; } }
function assertPortFree() {
  return new Promise((resolve, reject) => {
    const s = createServer().once("error", reject).once("listening", () => s.close(() => resolve())).listen(PORT, "127.0.0.1");
  });
}

async function main() {
  await assertPortFree();
  log(`starting serve-dist on :${PORT}…`);
  const server = spawn("node", [join(__dirname, "serve-dist.mjs")], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(d));
  server.stdout.on("data", () => {});

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { if (await pingServer()) break; await new Promise((r) => setTimeout(r, 200)); }

  const errors = [];
  let browser;
  try {
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    for (const route of ROUTES) {
      const page = await browser.newPage();
      const errs = [];
      page.on("pageerror", (err) => errs.push(`${route}: pageerror: ${err.message}`));
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          const txt = msg.text();
          if (/hydrat|#418|#419|did not match/i.test(txt)) errs.push(`${route} console: ${txt}`);
        }
      });
      log(`→ ${route}`);
      await page.goto(`${ORIGIN}${route}`, { waitUntil: "networkidle0", timeout: 30_000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      errors.push(...errs);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(server.pid), "/f", "/t"], { shell: true });
    else server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (errors.length === 0) log(`✅ all ${ROUTES.length} prerendered routes hydrated clean`);
  else { fail(`${errors.length} hydration errors:`); errors.forEach((e) => fail(`  - ${e}`)); process.exit(1); }
}

main().catch((err) => { fail(err.stack || err.message); process.exit(1); });
