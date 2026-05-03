// Post-build prerender pass for Thiqa's public marketing/auth/legal
// routes. Runs AFTER `vite build`. Spawns a local `vite preview` server,
// uses Puppeteer to walk each route, waits on the
// window.__PRERENDER_READY__ beacon (set once React Query has settled
// + Helmet has flushed), captures the rendered HTML, and writes it back
// to dist/<route>/index.html so deployed static hosting serves a fully
// hydrated DOM to crawlers.
//
// CRM, admin, and personalized auth routes (/forgot-password,
// /reset-password, /verify-email, /sign/:token) are deliberately NOT
// prerendered — they ship the bare index.html with empty #root and
// hydrate as a regular SPA via createRoot.
//
// Why we collect all HTML in memory before writing:
// vite preview falls back to dist/index.html for any non-asset path it
// doesn't recognize (standard SPA behavior). If we wrote the prerendered
// Landing to dist/index.html mid-pass, the next route's request
// (/pricing) would fall back to that prerendered Landing — and React
// would throw hydration error #418 trying to fit Pricing into Landing's
// DOM. So we capture everything, then flush to disk after the preview
// shuts down.
//
// Failure policy:
//   - Vite preview must come up. If not, fail the build (deterministic
//     local issue; silently shipping zero-prerender would defeat the point).
//   - Per-route timeouts log a warning and snapshot the current DOM.
//     Body copy with hardcoded Arabic fallbacks is still better than no
//     prerender.
//   - Supabase being unreachable from the build environment is the most
//     likely real-world failure. The beacon still fires (useIsFetching
//     drops back to 0 after the failed query), so Puppeteer captures
//     the fallback-strings DOM and the build succeeds.

import { spawn } from "node:child_process";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import puppeteer from "puppeteer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "dist");

const PORT = 4173;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const ROUTES = [
  "/",
  "/pricing",
  "/faq",
  "/contact",
  "/login",
  "/register",
  "/privacy",
  "/terms",
];

const PER_ROUTE_TIMEOUT_MS = 30_000;
const PREVIEW_BOOT_TIMEOUT_MS = 15_000;

function log(msg) {
  process.stdout.write(`[prerender] ${msg}\n`);
}
function warn(msg) {
  process.stderr.write(`[prerender] WARN: ${msg}\n`);
}

async function assertDistReady() {
  try {
    await readFile(join(DIST, "index.html"), "utf8");
  } catch {
    throw new Error(`dist/index.html not found. Run \`vite build\` before prerender.`);
  }
}

// Pre-flight: refuse to start if 4173 is occupied. Otherwise we'd hit
// the bug where the script silently piggybacks on someone else's preview
// (which may be serving a stale build) and produces wrong snapshots.
function assertPortFree() {
  return new Promise((resolve, reject) => {
    const tester = createServer()
      .once("error", (err) =>
        reject(
          new Error(
            `port ${PORT} is in use (${err.code}). Stop the other process first ` +
              `(check for stale 'vite preview' instances) and re-run.`,
          ),
        ),
      )
      .once("listening", () => tester.close(() => resolve()))
      .listen(PORT, "127.0.0.1");
  });
}

async function pingPreview() {
  try {
    const res = await fetch(`${ORIGIN}/`, { method: "HEAD" });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

async function startPreview() {
  log(`starting vite preview on :${PORT}…`);
  const proc = spawn(
    "npx",
    ["vite", "preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
    { cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  proc.stderr.on("data", (data) => process.stderr.write(data));
  proc.stdout.on("data", () => {});

  const deadline = Date.now() + PREVIEW_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await pingPreview()) {
      log(`vite preview ready`);
      return proc;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error(`vite preview did not boot within ${PREVIEW_BOOT_TIMEOUT_MS}ms`);
}

function stopPreview(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.killed) return resolve();
    proc.once("exit", () => resolve());
    if (process.platform === "win32") {
      // Windows: npx spawns a node child via cmd.exe; a plain SIGTERM to
      // the cmd shell leaves the node process orphaned holding the port.
      // taskkill /t kills the whole tree.
      spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"], { shell: true });
    } else {
      proc.kill("SIGTERM");
    }
    setTimeout(resolve, 2000);
  });
}

function outputPathFor(route) {
  if (route === "/") return join(DIST, "index.html");
  return join(DIST, route.replace(/^\//, ""), "index.html");
}

async function captureRoute(browser, route) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  // Mark this page as a prerender pass BEFORE the app bundle runs, so
  // App.tsx can keep dynamic chrome (toasters, lazy hosts, public
  // widgets) out of the snapshot. The same chrome mounts post-hydration
  // on real users, and React 19 lets us defer it cleanly via a
  // useEffect-gated mount that doesn't fire during prerender.
  // Without this, sonner's useTheme() (next-themes) and similar
  // mount-time-dependent components produce DOM that differs between
  // capture and hydration first-render, throwing React error #418.
  await page.evaluateOnNewDocument(() => {
    window.__PRERENDER__ = true;
  });
  page.on("pageerror", (err) => warn(`${route}: page error: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") warn(`${route}: console.error: ${msg.text()}`);
  });

  const url = `${ORIGIN}${route}`;
  log(`→ ${route}`);
  try {
    await page.goto(url, { waitUntil: "networkidle0", timeout: PER_ROUTE_TIMEOUT_MS });
    await page
      .waitForFunction(() => window.__PRERENDER_READY__ === true, {
        timeout: PER_ROUTE_TIMEOUT_MS,
      })
      .catch(() => warn(`${route}: ready beacon timeout — snapshotting current DOM`));
    // 1. Tag #root with the route name so main.tsx can decide
    //    hydrateRoot vs createRoot at startup. Without this, a CRM URL
    //    served the prerendered Landing via SPA fallback would crash
    //    with React error #418 trying to hydrate dashboard onto landing.
    // 2. Dehydrate the React Query cache and inject it into <body> as
    //    `<script>window.__REACT_QUERY_STATE__ = ...</script>`. Without
    //    this, useLandingContent's CMS-sourced text (which the prerender
    //    waited for via the PRERENDER_READY beacon) would be in the
    //    captured DOM, but hydration's first render would re-fetch
    //    fresh and use the hardcoded fallback strings — text mismatch,
    //    React error #418.
    await page.evaluate((r) => {
      const root = document.getElementById("root");
      if (root) root.setAttribute("data-prerendered-route", r);

      const dehydrated = window.__GET_QUERY_CACHE__?.();
      if (dehydrated) {
        const tag = document.createElement("script");
        tag.id = "__react_query_state__";
        // Use textContent (not innerHTML) to dodge any HTML special-char
        // interpretation; main.tsx parses it back via JSON.parse. The
        // </script> escape avoids breaking out of the tag if a query
        // value happens to contain that token.
        tag.textContent =
          "window.__REACT_QUERY_STATE__ = " +
          JSON.stringify(dehydrated).replace(/<\/script/gi, "<\\/script") +
          ";";
        document.body.appendChild(tag);
      }
    }, route);
    return await page.content();
  } finally {
    await page.close();
  }
}

async function main() {
  await assertDistReady();
  await assertPortFree();

  const preview = await startPreview();
  const captured = new Map();
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    for (const route of ROUTES) {
      try {
        const html = await captureRoute(browser, route);
        captured.set(route, html);
      } catch (err) {
        warn(`${route}: capture failed: ${err.message}`);
      }
    }
  } finally {
    if (browser) await browser.close();
    await stopPreview(preview);
  }

  // Flush all captures to disk after the preview server is down, so vite's
  // SPA fallback can't accidentally serve a half-prerendered tree to a
  // later request mid-pass.
  for (const [route, html] of captured) {
    const outPath = outputPathFor(route);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, html, "utf8");
    log(`  wrote ${outPath.replace(ROOT, ".")} (${html.length.toLocaleString()} bytes)`);
  }

  log(`done — prerendered ${captured.size}/${ROUTES.length} routes`);
  if (captured.size === 0) process.exit(1);
}

main().catch((err) => {
  warn(err.stack || err.message);
  process.exit(1);
});
