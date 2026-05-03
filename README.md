# Thiqa

Thiqa is a cloud SaaS platform for managing insurance agencies in Arabic — clients, policies, premiums, collections, cheques, reporting, and notifications, all in one place.

- Production: https://getthiqa.com
- Tech stack: Vite + React 19 + TypeScript, Tailwind CSS, shadcn/ui, Supabase, react-router-dom, react-helmet-async.

## Local development

Requires Node.js 20+ and a package manager (npm, pnpm, or bun).

```sh
# Install dependencies — the project has a pre-existing peer-dep
# conflict (next-themes wants React 18, project is on React 19), so
# the legacy flag is required on every install.
npm install --legacy-peer-deps

# Start the dev server (default: http://localhost:8080)
npm run dev

# Production build — runs `vite build` then `scripts/prerender.mjs`
# (Puppeteer post-build pass, see "Prerender pipeline" below)
npm run build

# Just `vite build` without the prerender pass
npm run build:no-prerender

# Just the prerender pass (assumes dist/ already exists)
npm run prerender

# Preview the production build locally — note: vite preview's
# trailing-slash matching diverges from production hosts; use
# `node scripts/serve-dist.mjs` to mirror Vercel/Netlify behavior.
npm run preview

# Lint
npm run lint
```

## Project structure

- `src/pages/` — top-level routes. Public marketing/auth/legal pages render `<PublicSEO>`; authenticated CRM pages inherit a global `noindex` from `index.html` and `SiteHelmet`.
- `src/components/` — shared UI, including `public/PublicSEO.tsx` (per-page SEO meta) and `layout/SiteHelmet.tsx` (global defaults).
- `src/integrations/supabase/` — generated Supabase client and types.
- `supabase/` — Edge Functions and SQL migrations.
- `public/` — static assets, `robots.txt`, `sitemap.xml`, web manifest.

## SEO

- Per-page SEO is set with the `PublicSEO` component (canonical, OG/Twitter, hreflang, robots).
- Public pages allowed in search: `/`, `/pricing`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/privacy`, `/terms`.
- All other routes inherit `noindex, nofollow`.
- Sitemap: `public/sitemap.xml`. Robots: `public/robots.txt`. Web manifest: `public/site.webmanifest`.

### Prerender pipeline

`npm run build` runs `vite build` and then `scripts/prerender.mjs`, which spawns `vite preview`, walks 8 public routes (`/`, `/pricing`, `/faq`, `/contact`, `/login`, `/register`, `/privacy`, `/terms`) in headless Puppeteer, and writes the rendered HTML back to `dist/<route>/index.html` so Googlebot indexes the SEO content without executing JS. The React Query cache is dehydrated and inlined as `window.__REACT_QUERY_STATE__` so a real visit's hydration first-render uses the same Supabase data the prerender saw.

| Script | Purpose |
| --- | --- |
| `npm run build` | Full production build (`vite build` + prerender) |
| `npm run build:no-prerender` | `vite build` only — useful when iterating on the React app and you don't need updated prerender output |
| `npm run prerender` | Run the prerender pass against an existing `dist/` |
| `node scripts/serve-dist.mjs` | Local Vercel/Netlify-style static server — used by the smoke tests because `vite preview` doesn't canonicalize trailing slashes the way production hosts do |
| `node scripts/smoke-public.mjs` | Confirms all 8 prerendered routes hydrate clean (no React `#418/#419` errors) |
| `node scripts/smoke-crm.mjs` | Confirms CRM routes (`/dashboard`, `/clients`) mount cleanly via the SPA fallback path |
| `node scripts/smoke-dev-console.mjs` | Captures the dev server console for `/`, `/pricing`, `/faq` — confirms zero hydration warnings |
| `ORIGIN=https://getthiqa.com node scripts/verify-deploy.mjs` | Post-deploy curl-and-assert health probe — checks every prerendered URL serves the expected `<title>`, canonical, OG/Twitter tags, JSON-LD, and Arabic body content in static markup |

## Deployment

The site is built with `npm run build` and the contents of `dist/` are served by any static host (or behind a CDN). Supabase handles auth, storage, and Edge Functions.

### Cloudflare configuration (REQUIRED for production SEO)

The site is currently hosted on Lovable Cloud, with `getthiqa.com` proxied through Cloudflare. Lovable's hosting only serves literal file paths and SPA-fallbacks every other URL to `dist/index.html`. That means without the rules below, Googlebot fetching `https://getthiqa.com/pricing` gets the homepage HTML instead of `dist/pricing/index.html` — and the entire prerender pipeline (`scripts/prerender.mjs`) is wasted for the 7 non-root routes.

Two Cloudflare rules sit in front of Lovable to fix this:

#### 1. Rules → Transform Rules → Rewrite URL: `rewrite-prerendered-routes-to-index`

Rewrites pretty URLs to their prerendered file path BEFORE the request reaches Lovable's origin. The browser's URL bar stays unchanged; only what Cloudflare asks the origin for changes.

**Match expression:**
```
(http.request.uri.path in {"/pricing" "/pricing/" "/faq" "/faq/" "/contact" "/contact/" "/login" "/login/" "/register" "/register/" "/privacy" "/privacy/" "/terms" "/terms/"})
```

**Rewrite path (Dynamic):**
```
concat(regex_replace(http.request.uri.path, "/$", ""), "/index.html")
```

**If a new public route is added to the prerender list in `scripts/prerender.mjs`, add it (with both bare and trailing-slash forms) to this Transform Rule's `in {}` allowlist or it won't be served correctly.** The CRM routes (`/dashboard`, `/clients`, `/admin/*`, `/thiqa/*`, etc.) are deliberately excluded — they continue to use Lovable's SPA fallback, which React Router handles client-side.

#### 2. Rules → Redirect Rules: `301-www-to-apex`

Upgrades the www → apex redirect from Lovable's default 302 (temporary) to a 301 (permanent), so Google passes full link equity to the canonical hostname.

**Match expression:**
```
(http.host eq "www.getthiqa.com")
```

**Redirect target URL (Dynamic):**
```
concat("https://getthiqa.com", http.request.uri)
```

**Status code:** `301`

#### Verifying the rules

```bash
# Each prerendered route should return its OWN data-prerendered-route attribute
for r in pricing faq contact login register privacy terms; do
  curl -s "https://getthiqa.com/$r" | grep -oE 'data-prerendered-route="[^"]*"' | head -1
done

# www should 301 (not 302) and preserve path/query
curl -sI "https://www.getthiqa.com/pricing?ref=test" | grep -E "^(HTTP|Location):"

# CRM still falls through to SPA shell (homepage HTML, React Router takes over)
curl -s "https://getthiqa.com/dashboard" | grep -oE 'data-prerendered-route="[^"]*"' | head -1
```

Or run the full health probe:
```bash
ORIGIN=https://getthiqa.com node scripts/verify-deploy.mjs
```

If the Cloudflare account is ever rebuilt, recreate both rules from the expressions above. They're stored in Cloudflare's dashboard, not in this repo, so this README is the source of truth.
