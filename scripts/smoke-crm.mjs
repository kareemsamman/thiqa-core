// Smoke test for CRM routes after the prerender pass. Confirms:
//   1. dist/index.html (prerendered Landing) is served via SPA fallback
//      for an unknown route like /dashboard.
//   2. main.tsx detects the prerenderedRoute mismatch and takes the
//      createRoot branch (wiping the stale Landing markup), instead of
//      hydrateRoot (which would crash with React error #418).
//   3. The CRM route mounts without any React/hydration errors. With
//      no Supabase session it'll redirect to /login — that's expected
//      and proves the routing/auth chain still works.
//
// Uses scripts/serve-dist (mimics Vercel/Netlify pretty-URL handling)
// so the test reflects what production actually does.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import puppeteer from "puppeteer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PORT = 4181;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ROUTES = ["/dashboard", "/clients"];

function log(msg) { process.stdout.write(`[smoke-crm] ${msg}\n`); }
function fail(msg) { process.stderr.write(`[smoke-crm] FAIL: ${msg}\n`); }

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

  let browser;
  const pageErrors = [];
  try {
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    for (const route of ROUTES) {
      const page = await browser.newPage();
      const errs = [];
      page.on("pageerror", (err) => errs.push(`${route}: ${err.message}`));
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          const txt = msg.text();
          // Filter noise: Supabase 401s, missing CDN images, etc. — we
          // only care about React/hydration errors.
          if (/hydrat|React|#418|#419/i.test(txt)) errs.push(`${route} console: ${txt}`);
        }
      });
      log(`→ ${route}`);
      try {
        await page.goto(`${ORIGIN}${route}`, { waitUntil: "networkidle0", timeout: 30_000 });
        await new Promise((r) => setTimeout(r, 1500));
        log(`  settled at ${page.url()}`);
      } catch (err) {
        errs.push(`${route} navigation: ${err.message}`);
      }
      pageErrors.push(...errs);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(server.pid), "/f", "/t"], { shell: true });
    else server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (pageErrors.length === 0) log(`✅ all CRM smoke routes mounted clean (no React/hydration errors)`);
  else { fail(`${pageErrors.length} React errors:`); pageErrors.forEach((e) => fail(`  - ${e}`)); process.exit(1); }
}

main().catch((err) => { fail(err.stack || err.message); process.exit(1); });
