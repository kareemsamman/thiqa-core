import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";

const SITE_ORIGIN = "https://getthiqa.com";
const DEFAULT_OG_IMAGE = "https://thiqacrm.b-cdn.net/Group%201000011511.png";

type PublicSEOProps = {
  title: string;
  description: string;
  pathname?: string;
  image?: string;
  keywords?: string;
};

// Per-page SEO for public marketing/auth/legal pages. Sets a localized
// title ("Thiqa | <page name>"), a meta description, OG/Twitter tags,
// canonical URL, and — critically — overrides the global noindex
// default declared in index.html so this specific page is allowed in
// search results. CRM/admin pages omit this component and inherit the
// global noindex, keeping them out of the index.
export function PublicSEO({
  title,
  description,
  pathname,
  image = DEFAULT_OG_IMAGE,
  keywords,
}: PublicSEOProps) {
  const location = useLocation();
  const path = pathname ?? location.pathname;
  const canonical = `${SITE_ORIGIN}${path === "/" ? "" : path}`;

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
      <meta name="googlebot" content="index, follow" />
      {keywords ? <meta name="keywords" content={keywords} /> : null}

      <link rel="canonical" href={canonical} />

      <meta property="og:type" content="website" />
      <meta property="og:locale" content="ar_AR" />
      <meta property="og:site_name" content="Thiqa" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={image} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
    </Helmet>
  );
}
