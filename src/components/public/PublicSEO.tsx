import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";
import { PublicAnalytics } from "@/components/analytics/PublicAnalytics";

const SITE_ORIGIN = "https://getthiqa.com";
const DEFAULT_OG_IMAGE = "https://thiqacrm.b-cdn.net/fav.png";
const DEFAULT_OG_IMAGE_WIDTH = "1200";
const DEFAULT_OG_IMAGE_HEIGHT = "630";

// Arabic leaf-crumb label per public route. Routes not in this map
// (incl. "/") emit no BreadcrumbList — Google flags single-item
// breadcrumbs and transactional flow pages (verify-email, reset-password)
// don't need the path either.
const BREADCRUMB_LABELS: Record<string, string> = {
  "/pricing": "الأسعار",
  "/faq": "الأسئلة الشائعة",
  "/contact": "تواصل معنا",
  "/login": "تسجيل الدخول",
  "/register": "إنشاء حساب",
  "/privacy": "سياسة الخصوصية",
  "/terms": "الشروط والأحكام",
};

type PublicSEOProps = {
  title: string;
  description: string;
  pathname?: string;
  image?: string;
  imageWidth?: string;
  imageHeight?: string;
  keywords?: string;
  // Transactional flow pages (verify-email, forgot/reset password) want
  // the rest of the meta (title, description, canonical, OG) but should
  // stay out of search since they only make sense reached from an
  // emailed link.
  noindex?: boolean;
};

// Per-page SEO for public marketing/auth/legal pages. Sets a localized
// title ("Thiqa | <page name>"), a meta description, OG/Twitter tags,
// canonical URL, hreflang, theme-color, and — critically — overrides
// the global noindex default declared in index.html so this specific
// page is allowed in search results. CRM/admin pages omit this
// component and inherit the global noindex, keeping them out of the
// index.
export function PublicSEO({
  title,
  description,
  pathname,
  image = DEFAULT_OG_IMAGE,
  imageWidth = DEFAULT_OG_IMAGE_WIDTH,
  imageHeight = DEFAULT_OG_IMAGE_HEIGHT,
  keywords,
  noindex = false,
}: PublicSEOProps) {
  const location = useLocation();
  const path = pathname ?? location.pathname;
  const canonical = `${SITE_ORIGIN}${path === "/" ? "" : path}`;

  // Per-route BreadcrumbList (Home → Current). Stringified once so the
  // <script> child is a single text node; embedding raw JSX would let
  // React try to interpret the JSON as children. JSON.stringify is
  // safe for </script> here because we control all label values.
  const leafLabel = BREADCRUMB_LABELS[path];
  const breadcrumbJsonLd = leafLabel
    ? JSON.stringify({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "الرئيسية",
            item: `${SITE_ORIGIN}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: leafLabel,
            item: canonical,
          },
        ],
      })
    : null;

  return (
    <>
    {/* gtag for public/marketing/auth pages only — CRM routes never
        mount PublicSEO, so the analytics script is never loaded
        there. */}
    <PublicAnalytics />
    <Helmet>
      <html lang="ar" dir="rtl" />
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta
        name="robots"
        content={
          noindex
            ? "noindex, nofollow"
            : "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
        }
      />
      <meta name="googlebot" content={noindex ? "noindex, nofollow" : "index, follow"} />
      {keywords ? <meta name="keywords" content={keywords} /> : null}

      <meta name="author" content="Thiqa" />
      <meta name="publisher" content="Thiqa" />
      <meta name="theme-color" content="#1a1a2e" />
      <meta name="apple-mobile-web-app-title" content="Thiqa" />
      <meta name="application-name" content="Thiqa" />
      <meta name="format-detection" content="telephone=no" />

      <link rel="canonical" href={canonical} />
      <link rel="alternate" hrefLang="ar" href={canonical} />
      <link rel="alternate" hrefLang="x-default" href={canonical} />

      <meta property="og:type" content="website" />
      <meta property="og:locale" content="ar_AR" />
      <meta property="og:site_name" content="Thiqa" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={image} />
      <meta property="og:image:secure_url" content={image} />
      <meta property="og:image:type" content="image/png" />
      <meta property="og:image:width" content={imageWidth} />
      <meta property="og:image:height" content={imageHeight} />
      <meta property="og:image:alt" content={title} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content="@getthiqa" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:image:alt" content={title} />

      {breadcrumbJsonLd && (
        <script id="schema-breadcrumb" type="application/ld+json">{breadcrumbJsonLd}</script>
      )}
    </Helmet>
    </>
  );
}
