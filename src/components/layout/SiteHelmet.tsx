import { Helmet } from "react-helmet-async";
import { useSiteSettings } from "@/hooks/useSiteSettings";

export function SiteHelmet() {
  const { data: settings } = useSiteSettings();

  const title = settings?.site_title || "Thiqa";
  const description = settings?.site_description || "نظام إدارة التأمين";

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
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
