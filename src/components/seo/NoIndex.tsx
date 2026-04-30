import { Helmet } from "react-helmet-async";

// Drop into any authenticated / utility / customer-only route that
// must stay out of search. Mount it AFTER SiteHelmet (any page-level
// component already satisfies that — SiteHelmet lives at the App
// root) so react-helmet-async's "last mount wins" rule overrides the
// global `index, follow` baseline.
//
// MainLayout already carries this for every CRM route; only standalone
// pages that don't render through MainLayout need to mount it directly.
export function NoIndex() {
  return (
    <Helmet>
      <meta name="robots" content="noindex, nofollow" />
      <meta name="googlebot" content="noindex, nofollow" />
    </Helmet>
  );
}
