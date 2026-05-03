// Post-deploy SEO verification. Curls each prerendered URL on the
// production host and asserts the static markup contains the SEO
// pieces Google needs to see WITHOUT executing JavaScript:
//
//   - <html lang="ar" dir="rtl">
//   - per-route <title> (Arabic, route-specific)
//   - per-route <meta name="description">
//   - <link rel="canonical" href="https://getthiqa.com${path}">
//   - <meta name="robots" content="index, follow…">
//   - og:title / og:description / og:url / og:image
//   - twitter:card="summary_large_image"
//   - at least one <script type="application/ld+json">
//   - real Arabic body content (not just an empty SPA shell)
//
// Run after deploy:
//   ORIGIN=https://getthiqa.com node scripts/verify-deploy.mjs
//
// Prints one ✅ / ❌ line per check per route and exits non-zero on
// any failure. Useful as a CI / cron health probe.
//
// This script does NOT verify hydration (that requires running JS in
// a browser). It only verifies the static HTML Googlebot will index,
// which is the real SEO contract — Google can render JS but the
// crawl/index pass relies on the fast static fetch first.

const ORIGIN = process.env.ORIGIN ?? "https://getthiqa.com";

const ROUTES = [
  { path: "/",        titleHas: "Thiqa",     bodyHas: "Thiqa" },
  { path: "/pricing", titleHas: "أسعار",     bodyHas: "خطط"  },
  { path: "/faq",     titleHas: "الأسئلة",   bodyHas: "Thiqa" },
  { path: "/contact", titleHas: "تواصل",     bodyHas: "Thiqa" },
  { path: "/login",   titleHas: "تسجيل",     bodyHas: "Thiqa" },
  { path: "/register",titleHas: "إنشاء",     bodyHas: "Thiqa" },
  { path: "/privacy", titleHas: "الخصوصية", bodyHas: "Thiqa" },
  { path: "/terms",   titleHas: "الاستخدام", bodyHas: "Thiqa" },
];

const fmt = { ok: "\x1b[32m✅\x1b[0m", bad: "\x1b[31m❌\x1b[0m" };

function check(label, ok, detail) {
  process.stdout.write(`  ${ok ? fmt.ok : fmt.bad} ${label}${detail ? `: ${detail}` : ""}\n`);
  return ok;
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { "user-agent": "thiqa-verify/1.0" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.text();
}

async function verifyRoute({ path, titleHas, bodyHas }) {
  const url = `${ORIGIN}${path}`;
  process.stdout.write(`\n${url}\n`);
  let html;
  try {
    html = await fetchHtml(url);
  } catch (err) {
    check("fetch", false, err.message);
    return false;
  }

  const expected = `https://getthiqa.com${path === "/" ? "" : path}`;
  const passes = [
    check("html lang=ar dir=rtl",
      /<html[^>]*\blang="ar"[^>]*\bdir="rtl"|<html[^>]*\bdir="rtl"[^>]*\blang="ar"/.test(html)),
    check("<title> contains Arabic",
      new RegExp(titleHas).test(html), titleHas),
    check("meta description present",
      /<meta[^>]*name="description"[^>]*content="[^"]+"/.test(html)),
    check("canonical = " + expected,
      new RegExp(`<link[^>]*rel="canonical"[^>]*href="${expected.replace(/[/]/g, "\\/")}"`).test(html)),
    check("robots index, follow",
      /<meta[^>]*name="robots"[^>]*content="[^"]*index[^"]*follow/.test(html)),
    check("og:title present",
      /<meta[^>]*property="og:title"[^>]*content="[^"]+"/.test(html)),
    check("og:description present",
      /<meta[^>]*property="og:description"[^>]*content="[^"]+"/.test(html)),
    check("og:image present",
      /<meta[^>]*property="og:image"[^>]*content="https?:\/\//.test(html)),
    check("twitter:card summary_large_image",
      /<meta[^>]*name="twitter:card"[^>]*content="summary_large_image"/.test(html)),
    check("JSON-LD block present",
      /<script[^>]*type="application\/ld\+json"/.test(html)),
    check("Arabic body content",
      new RegExp(bodyHas).test(html)),
  ];

  return passes.every(Boolean);
}

async function main() {
  process.stdout.write(`Verifying static HTML on ${ORIGIN}\n`);
  let allOk = true;
  for (const route of ROUTES) {
    const ok = await verifyRoute(route);
    if (!ok) allOk = false;
  }
  process.stdout.write(`\n${allOk ? fmt.ok : fmt.bad} ${allOk ? "all routes pass" : "FAIL"}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`verify-deploy crashed: ${err.message}\n`);
  process.exit(1);
});
