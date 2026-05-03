// Captures the browser console output for /, /pricing, /faq when
// loaded against `npm run dev` (Vite dev server, unminified React).
// Useful as a sanity check that no hydration warnings, no React
// errors, and no other red console messages surface in the dev mode
// the user actually develops in.
//
// Run with the dev server already running:
//   npm run dev          (in one terminal)
//   ORIGIN=http://localhost:8080 node scripts/smoke-dev-console.mjs
//
// (Vite picks the next free port if 8080 is taken — pass the actual
// dev URL via ORIGIN.)
import puppeteer from "puppeteer";

const ORIGIN = process.env.ORIGIN ?? "http://localhost:8080";
const ROUTES = ["/", "/pricing", "/faq"];

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

let totalErrors = 0;
for (const route of ROUTES) {
  const page = await browser.newPage();
  const events = [];
  page.on("pageerror", (err) => events.push(["pageerror", err.message]));
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      const txt = msg.text();
      // Filter dev-only noise unrelated to hydration:
      //   - React DevTools nag
      //   - Lovable preview WebSocket (only present in cloud preview)
      //   - The `fetchpriority` casing warning on the static
      //     <link rel="preload" fetchpriority="high"> tag in
      //     index.html — pre-existing, unrelated to hydration.
      if (
        /Download the React DevTools|Source map error/i.test(txt) ||
        /WebSocket connection to .*:97\d\d/.test(txt) ||
        /Failed to connect to WebSocket server/.test(txt) ||
        /Invalid DOM property.*fetchpriority/.test(txt)
      ) return;
      events.push([type, txt]);
    }
  });
  process.stdout.write(`\n${ORIGIN}${route}\n`);
  try {
    await page.goto(`${ORIGIN}${route}`, { waitUntil: "networkidle0", timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 1500));
  } catch (err) {
    events.push(["navigation", err.message]);
  }
  if (events.length === 0) process.stdout.write(`  ✅ no errors / warnings\n`);
  else {
    totalErrors += events.length;
    for (const [type, text] of events) process.stdout.write(`  [${type}] ${text}\n`);
  }
  await page.close();
}

await browser.close();
process.stdout.write(`\n${totalErrors === 0 ? "✅" : "❌"} ${totalErrors} total console event(s)\n`);
process.exit(totalErrors === 0 ? 0 : 1);
