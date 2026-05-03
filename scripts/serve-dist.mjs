// Tiny static file server for the dist/ output that mimics what
// Vercel / Netlify / Cloudflare Pages do by default:
//
// - `/foo` → tries dist/foo/index.html, then dist/foo.html, then falls
//   back to dist/index.html (SPA-fallback for unknown paths).
// - `/foo/` → 301 to /foo (canonicalize trailing slash, like Vercel
//   "Trailing Slash: Off"). React Router 6 matches `/foo`, not `/foo/`,
//   so we have to canonicalize before the bundle hydrates.
// - `/` → dist/index.html.
//
// vite preview is too dumb for this — it only resolves /foo/ to
// dist/foo/index.html when the URL has the trailing slash, which means
// React Router sees the wrong path on the prerendered routes. This
// little server is what smoke-public uses now so the test reflects
// what production actually does.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");

const PORT = Number(process.env.PORT ?? 4180);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico":  "image/x-icon",
  ".txt":  "text/plain; charset=utf-8",
  ".xml":  "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

async function tryServe(res, path, fallbackHtml = false) {
  try {
    const s = await stat(path);
    if (!s.isFile()) return false;
    const body = await readFile(path);
    const ct = MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": ct });
    res.end(body);
    return true;
  } catch {
    if (fallbackHtml) {
      const body = await readFile(join(DIST, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
      return true;
    }
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  // Canonicalize trailing slash to match production hosts.
  if (pathname.length > 1 && pathname.endsWith("/")) {
    res.writeHead(301, { Location: pathname.slice(0, -1) + url.search });
    res.end();
    return;
  }

  if (pathname === "/") {
    await tryServe(res, join(DIST, "index.html"));
    return;
  }

  // Asset request (has an extension other than .html) — serve directly,
  // 404 if missing. Don't fall back to index.html for missing assets,
  // that'd corrupt JS/CSS responses.
  const ext = extname(pathname).toLowerCase();
  if (ext && ext !== ".html") {
    const ok = await tryServe(res, join(DIST, pathname));
    if (!ok) { res.writeHead(404); res.end("Not found"); }
    return;
  }

  // Pretty URL: try dist/<path>/index.html first (prerendered output),
  // then dist/<path>.html, finally SPA-fallback dist/index.html.
  if (await tryServe(res, join(DIST, pathname, "index.html"))) return;
  if (await tryServe(res, join(DIST, `${pathname}.html`))) return;
  await tryServe(res, join(DIST, "index.html"));
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`[serve-dist] listening on http://127.0.0.1:${PORT}\n`);
});
