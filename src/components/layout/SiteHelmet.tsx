import { Helmet } from "react-helmet-async";
import { useSiteSettings } from "@/hooks/useSiteSettings";

// App-wide Helmet defaults. Sets a fallback title/description plus a
// global `noindex, nofollow` robots tag so the authenticated CRM and
// admin areas stay out of search engines on principle. Public marketing,
// auth, and legal pages mount <PublicSEO> inside their route, which is
// rendered AFTER this component in the tree — react-helmet-async resolves
// duplicate tags by "last mount wins", so PublicSEO cleanly overrides
// both the title and the robots tag for those pages.
export function SiteHelmet() {
  const { data: settings } = useSiteSettings();

  const title = settings?.site_title || "Thiqa";
  const description = settings?.site_description || "Thiqa";

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="robots" content="noindex, nofollow" />
      <meta name="googlebot" content="noindex, nofollow" />
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
