# Thiqa

Thiqa is a cloud SaaS platform for managing insurance agencies in Arabic — clients, policies, premiums, collections, cheques, reporting, and notifications, all in one place.

- Production: https://getthiqa.com
- Tech stack: Vite + React 19 + TypeScript, Tailwind CSS, shadcn/ui, Supabase, react-router-dom, react-helmet-async.

## Local development

Requires Node.js 20+ and a package manager (npm, pnpm, or bun).

```sh
# Install dependencies
npm install

# Start the dev server (default: http://localhost:8080)
npm run dev

# Type-check + production build
npm run build

# Preview the production build locally
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

## Deployment

The site is built with `npm run build` and the contents of `dist/` are served by any static host (or behind a CDN). Supabase handles auth, storage, and Edge Functions.
