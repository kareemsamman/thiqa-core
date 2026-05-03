import { Helmet } from "react-helmet-async";

// JSON-LD helpers for the public pages. Landing.tsx already emits
// Organization + SoftwareApplication + FAQPage on its own; this
// component covers everything else: BreadcrumbList for non-home
// pages, FAQPage for /faq, Offers for /pricing, ContactPage for
// /contact. Each helper accepts plain data and emits a single
// <script type="application/ld+json">.

const SITE_ORIGIN = "https://getthiqa.com";

interface BreadcrumbCrumb {
  label: string;
  href: string;
}

// Renders a BreadcrumbList for the current page so search results
// can show the path under the title. The home crumb is always
// "ثقة → ..." in RTL reading order; in JSON-LD itemListElement is
// LTR (root → leaf) regardless of page direction.
export function BreadcrumbJsonLd({ crumbs }: { crumbs: BreadcrumbCrumb[] }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      item: c.href.startsWith("http") ? c.href : `${SITE_ORIGIN}${c.href}`,
    })),
  };
  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(data)}</script>
    </Helmet>
  );
}

// FAQPage schema for /faq. Pass the catalog flattened to {q, a}.
export function FaqPageJsonLd({ items }: { items: { q: string; a: string }[] }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(data)}</script>
    </Helmet>
  );
}

interface PricingOffer {
  name: string;
  description?: string | null;
  monthlyPrice: number;
  yearlyPrice?: number;
}

// Product + AggregateOffer for /pricing. One Offer per plan, plus a
// SoftwareApplication wrapper so search results can pick the
// product/pricing pair.
export function PricingJsonLd({ offers }: { offers: PricingOffer[] }) {
  const offerNodes = offers.flatMap((p) => {
    const nodes: Record<string, unknown>[] = [];
    if (p.monthlyPrice > 0) {
      nodes.push({
        "@type": "Offer",
        name: `${p.name} — شهرياً`,
        price: p.monthlyPrice.toString(),
        priceCurrency: "ILS",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: p.monthlyPrice,
          priceCurrency: "ILS",
          unitCode: "MON",
          billingDuration: "P1M",
        },
        url: `${SITE_ORIGIN}/pricing`,
        availability: "https://schema.org/InStock",
      });
    }
    if (p.yearlyPrice && p.yearlyPrice > 0) {
      nodes.push({
        "@type": "Offer",
        name: `${p.name} — سنوياً`,
        price: p.yearlyPrice.toString(),
        priceCurrency: "ILS",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: p.yearlyPrice,
          priceCurrency: "ILS",
          unitCode: "ANN",
          billingDuration: "P1Y",
        },
        url: `${SITE_ORIGIN}/pricing`,
        availability: "https://schema.org/InStock",
      });
    }
    return nodes;
  });

  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Thiqa",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: offerNodes,
    url: `${SITE_ORIGIN}/pricing`,
  };
  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(data)}</script>
    </Helmet>
  );
}

// Lightweight WebPage entity for routes that don't have a richer
// schema of their own (login, privacy, terms). Anchors the page to
// the Organization defined on the homepage via @id reference, so
// crawlers see a consistent publisher graph across the site without
// having to re-emit the full Organization block per page.
export function WebPageJsonLd({
  name,
  pathname,
  description,
}: {
  name: string;
  pathname: string;
  description?: string;
}) {
  const url = `${SITE_ORIGIN}${pathname === "/" ? "" : pathname}`;
  const data = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name,
    url,
    inLanguage: "ar",
    ...(description ? { description } : {}),
    isPartOf: { "@type": "WebSite", "@id": `${SITE_ORIGIN}/#website` },
    publisher: { "@id": `${SITE_ORIGIN}/#org` },
  };
  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(data)}</script>
    </Helmet>
  );
}

// ContactPage with embedded ContactPoint for /contact.
export function ContactPageJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    name: "تواصل معنا — Thiqa",
    url: `${SITE_ORIGIN}/contact`,
    mainEntity: {
      "@type": "Organization",
      name: "Thiqa",
      url: SITE_ORIGIN,
      contactPoint: [
        {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: "support@getthiqa.com",
          telephone: "+972-52-514-3581",
          availableLanguage: ["Arabic", "Hebrew", "English"],
          areaServed: ["IL", "PS"],
        },
        {
          "@type": "ContactPoint",
          contactType: "customer support",
          telephone: "+972-59-894-8155",
          availableLanguage: ["Arabic", "Hebrew", "English"],
          areaServed: ["IL", "PS"],
        },
      ],
    },
  };
  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(data)}</script>
    </Helmet>
  );
}
