import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { navigationGroups } from "./navigation";

// Flatten the sidebar nav into [href, name] pairs sorted by descending
// href length so nested paths (e.g. /admin/marketing-sms) win against
// their parents (/admin) in startsWith matching.
const NAV_TITLE_ENTRIES: ReadonlyArray<readonly [string, string]> = navigationGroups
  .flatMap((g) => g.items.map((i) => [i.href, i.name] as const))
  .sort((a, b) => b[0].length - a[0].length);

function pageNameFor(pathname: string): string | null {
  for (const [href, name] of NAV_TITLE_ENTRIES) {
    if (pathname === href || pathname.startsWith(`${href}/`)) return name;
  }
  return null;
}

// App-wide Helmet defaults. Sets a fallback title/description plus a
// global `index, follow` robots tag — the public marketing pages must
// be crawlable as a baseline, since Google skips rendering JS entirely
// when the initial HTML says noindex (so a later <PublicSEO> override
// would never take effect for crawlers). CRM and admin routes mount
// inside MainLayout, which carries its own <NoIndex> Helmet entry —
// react-helmet-async resolves duplicate tags by "last mount wins", so
// MainLayout cleanly switches authenticated routes back to noindex.
//
// Title format is `Thiqa | <page name>`, where the page name is derived
// from the sidebar nav entry matching the current pathname. Pages that
// already mount their own <Helmet><title> (Login, SignaturePage, etc.)
// still override this via "last mount wins".
//
// Keyed by location.pathname so the Helmet remounts on every navigation.
// react-helmet-async otherwise keeps stale tags from an unmounted child
// (e.g. /login's PublicSEO) when this component's own props are unchanged
// — without the remount, the tab title stuck on "Thiqa | تسجيل الدخول"
// after logging in.
export function SiteHelmet() {
  const { data: settings } = useSiteSettings();
  const location = useLocation();

  const pageName = pageNameFor(location.pathname);
  const title = pageName ? `Thiqa | ${pageName}` : "Thiqa";
  const description = settings?.site_description || "Thiqa";

  return (
    <Helmet key={location.pathname}>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="robots" content="index, follow" />
      <meta name="googlebot" content="index, follow" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      {settings?.og_image_url && (
        <>
          <meta property="og:image" content={settings.og_image_url} />
          <meta name="twitter:image" content={settings.og_image_url} />
        </>
      )}
      {settings?.favicon_url && (
        <link rel="icon" href={settings.favicon_url} />
      )}
    </Helmet>
  );
}
