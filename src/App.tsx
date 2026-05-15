import { lazy, Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, dehydrate, hydrate } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { AuthProvider } from "@/hooks/useAuth";
import { RecentClientProvider } from "@/hooks/useRecentClient";
import { PolicyWizardControllerProvider } from "@/hooks/usePolicyWizardController";

// Lazy-loaded global hosts. Each returns null until their gating
// condition fires (event for quota, instances list for wizard, agent
// permission for Thaqib), so eager-importing them was pulling the
// AddQuotaDialog / PolicyWizard / ThaqibPanel sub-trees into every
// initial bundle — including the public landing where they never
// render. The Suspense fallback is null because none of these own
// any visible chrome.
const GlobalQuotaDialogHost = lazy(() =>
  import("@/components/subscription/GlobalQuotaDialogHost").then((m) => ({
    default: m.GlobalQuotaDialogHost,
  })),
);
const GlobalPolicyWizardHost = lazy(() =>
  import("@/components/policies/GlobalPolicyWizardHost").then((m) => ({
    default: m.GlobalPolicyWizardHost,
  })),
);
const ThaqibWidget = lazy(() =>
  import("@/components/ai-assistant/ThaqibWidget").then((m) => ({
    default: m.ThaqibWidget,
  })),
);
const CookieConsent = lazy(() =>
  import("@/components/public/CookieConsent").then((m) => ({
    default: m.CookieConsent,
  })),
);
const AccessibilityWidget = lazy(() =>
  import("@/components/public/AccessibilityWidget").then((m) => ({
    default: m.AccessibilityWidget,
  })),
);
import { useLocation } from "react-router-dom";
import { useSessionTracker } from "@/hooks/useSessionTracker";
import { SidebarStateProvider } from "@/hooks/useSidebarState";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PermissionRoute } from "@/components/auth/PermissionRoute";
import { SiteHelmet } from "@/components/layout/SiteHelmet";
import { PrerenderReadyBeacon } from "@/components/seo/PrerenderReadyBeacon";
import { RouteSkeleton } from "@/components/layout/RouteSkeleton";

// Wraps React.lazy so each code-split route carries its OWN Suspense
// boundary instead of sharing one global boundary around <Routes>.
//
// Why per-route Suspense:
// React 19 hydration is incompatible with a Suspense boundary that
// surrounds prerendered DOM. With a global <Suspense fallback={null}>
// around <Routes>, the boundary suspends on the first hydration render
// and renders its fallback (null) — which doesn't match the
// prerendered Landing/Pricing/etc. markup that's actually in the DOM.
// React then throws error #418 and falls back to client render, hurting
// CLS/INP and partially undoing the prerender SEO win. With each lazy
// component carrying its own boundary INTERNALLY, the prerendered
// (eager) routes don't have a Suspense boundary in their hydration
// path at all — and lazy CRM/admin routes still get a clean fallback
// during their chunk fetch.
function lazyWithSuspense<T extends ComponentType<unknown>>(
  loader: () => Promise<{ default: T }>,
): T {
  const Lazy: LazyExoticComponent<T> = lazy(loader);
  const Wrapped = ((props: React.ComponentProps<T>) => (
    <Suspense fallback={<RouteSkeleton />}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Lazy {...(props as any)} />
    </Suspense>
  )) as unknown as T;
  return Wrapped;
}
import { AppChrome } from "@/components/layout/AppChrome";
import { AgentProvider } from "@/hooks/useAgentContext";
import { AgentLimitsProvider } from "@/hooks/useAgentLimits";
import { UpgradePromptProvider } from "@/components/pricing/UpgradePromptProvider";
import { ThiqaAdminRoute } from "@/components/auth/ThiqaAdminRoute";
import { UnsavedChangesProvider } from "@/hooks/useUnsavedChanges";

// All pages are code-split. Each route's bundle is only downloaded when
// the user navigates to it. The Suspense fallback is intentionally null
// (not the Thiqa loading screen) — the router keeps the previous page
// rendered while the new chunk loads, so a null fallback means "no
// visible spinner mid-navigation." RoutePrefetcher below then warms
// every chunk in the background once the app is idle, so by the time
// the user actually clicks a nav link the target page is already
// cached.
const Index = lazyWithSuspense(() => import("./pages/Index"));
// Login (also serves /register) is eager — it's prerendered so its
// chunk must be available synchronously at hydration. See the eager-
// import block below for the full reasoning.
import Login from "./pages/Login";
const NoAccess = lazyWithSuspense(() => import("./pages/NoAccess"));
const OAuthConfirm = lazyWithSuspense(() => import("./pages/OAuthConfirm"));
const Clients = lazyWithSuspense(() => import("./pages/Clients"));
const Cars = lazyWithSuspense(() => import("./pages/Cars"));
const Policies = lazyWithSuspense(() => import("./pages/Policies"));
const Companies = lazyWithSuspense(() => import("./pages/Companies"));
const Brokers = lazyWithSuspense(() => import("./pages/Brokers"));
const BrokerWallet = lazyWithSuspense(() => import("./pages/BrokerWallet"));
const Cheques = lazyWithSuspense(() => import("./pages/Cheques"));
const Media = lazyWithSuspense(() => import("./pages/Media"));
const AdminUsers = lazyWithSuspense(() => import("./pages/AdminUsers"));
const BranchManagement = lazyWithSuspense(() => import("./pages/BranchManagement"));
const SmsOnboarding = lazyWithSuspense(() => import("./pages/SmsOnboarding"));
const Receipts = lazyWithSuspense(() => import("./pages/Receipts"));
const Accounting = lazyWithSuspense(() => import("./pages/Accounting"));
const CompanySettlement = lazyWithSuspense(() => import("./pages/CompanySettlement"));
const CompanySettlementDetail = lazyWithSuspense(() => import("./pages/CompanySettlementDetail"));
const InvoiceTemplates = lazyWithSuspense(() => import("./pages/InvoiceTemplates"));
const InsuranceCategories = lazyWithSuspense(() => import("./pages/InsuranceCategories"));
const RoadServices = lazyWithSuspense(() => import("./pages/RoadServices"));
const AccidentFeeServices = lazyWithSuspense(() => import("./pages/AccidentFeeServices"));
const PaymentSettings = lazyWithSuspense(() => import("./pages/PaymentSettings"));
const SmsSettings = lazyWithSuspense(() => import("./pages/SmsSettings"));
const CustomerSignatures = lazyWithSuspense(() => import("./pages/CustomerSignatures"));
const PaymentSuccess = lazyWithSuspense(() => import("./pages/PaymentSuccess"));
const PaymentFail = lazyWithSuspense(() => import("./pages/PaymentFail"));
const SignaturePage = lazyWithSuspense(() => import("./pages/SignaturePage"));
const Notifications = lazyWithSuspense(() => import("./pages/Notifications"));
const WordPressImport = lazyWithSuspense(() => import("./pages/WordPressImport"));
const DatabaseMigration = lazyWithSuspense(() => import("./pages/DatabaseMigration"));
const NotFound = lazyWithSuspense(() => import("./pages/NotFound"));
const SmsHistory = lazyWithSuspense(() => import("./pages/SmsHistory"));
const DebtTracking = lazyWithSuspense(() => import("./pages/DebtTracking"));
const AuthSettings = lazyWithSuspense(() => import("./pages/AuthSettings"));
const FinancialReports = lazyWithSuspense(() => import("./pages/FinancialReports"));
const CompanyWallet = lazyWithSuspense(() => import("./pages/CompanyWallet"));
const ElzamiCostsReport = lazyWithSuspense(() => import("./pages/ElzamiCostsReport"));
const PolicyReports = lazyWithSuspense(() => import("./pages/PolicyReports"));
const MarketingSms = lazyWithSuspense(() => import("./pages/MarketingSms"));
const AccidentReports = lazyWithSuspense(() => import("./pages/AccidentReports"));
const AccidentReportForm = lazyWithSuspense(() => import("./pages/AccidentReportForm"));
const AccidentTemplateMapper = lazyWithSuspense(() => import("./pages/AccidentTemplateMapper"));
const AnnouncementSettings = lazyWithSuspense(() => import("./pages/AnnouncementSettings"));
const Tasks = lazyWithSuspense(() => import("./pages/Tasks"));
const BusinessContacts = lazyWithSuspense(() => import("./pages/BusinessContacts"));
const RepairClaims = lazyWithSuspense(() => import("./pages/RepairClaims"));
const RepairClaimDetail = lazyWithSuspense(() => import("./pages/RepairClaimDetail"));
const CorrespondenceLetters = lazyWithSuspense(() => import("./pages/CorrespondenceLetters"));
const Leads = lazyWithSuspense(() => import("./pages/Leads"));
const CustomerRequests = lazyWithSuspense(() => import("./pages/CustomerRequests"));
const FormTemplates = lazyWithSuspense(() => import("./pages/FormTemplates"));
const FormTemplateEditor = lazyWithSuspense(() => import("./pages/FormTemplateEditor"));
const ActivityLog = lazyWithSuspense(() => import("./pages/ActivityLog"));
const BrandingSettings = lazyWithSuspense(() => import("./pages/BrandingSettings"));
const SubscriptionExpired = lazyWithSuspense(() => import("./pages/SubscriptionExpired"));
const Subscription = lazyWithSuspense(() => import("./pages/Subscription"));
const Support = lazyWithSuspense(() => import("./pages/Support"));
const ThiqaAgents = lazyWithSuspense(() => import("./pages/ThiqaAgents"));
const ThiqaAgentDetail = lazyWithSuspense(() => import("./pages/ThiqaAgentDetail"));
const ThiqaCreateAgent = lazyWithSuspense(() => import("./pages/ThiqaCreateAgent"));
const ThiqaPayments = lazyWithSuspense(() => import("./pages/ThiqaPayments"));
const ThiqaDashboard = lazyWithSuspense(() => import("./pages/ThiqaDashboard"));
const ThiqaSettings = lazyWithSuspense(() => import("./pages/ThiqaSettings"));
const ThiqaLandingCMS = lazyWithSuspense(() => import("./pages/ThiqaLandingCMS"));
const ThiqaAnalytics = lazyWithSuspense(() => import("./pages/ThiqaAnalytics"));
const ThiqaSupport = lazyWithSuspense(() => import("./pages/ThiqaSupport"));
const PayPalTest = lazyWithSuspense(() => import("./pages/PayPalTest"));
// Public marketing/auth/legal pages are EAGER imports so the prerender
// snapshot's hydration first-render produces the same DOM as what got
// captured. React.lazy wraps the loader in a Promise that's still
// "pending" on the first sync render even when the module is cached
// (modulepreload hint + main.tsx pre-import) — and a pending lazy
// boundary renders its Suspense fallback (null), which doesn't match
// the prerendered Landing/Pricing/etc. DOM → React error #418.
//
// Bundle-size cost: these chunks now load with the main entry instead
// of on-demand. The marketing pages are ALSO the most common first hit,
// so the user pays this cost on their initial visit either way; only
// users who land directly on a CRM route would see a slightly larger
// initial bundle.
import Landing from "./pages/Landing";
import VerifyEmail from "./pages/VerifyEmail";
import Pricing from "./pages/Pricing";
import FAQ from "./pages/FAQ";
import ContactUs from "./pages/ContactUs";
import ResetPassword from "./pages/ResetPassword";
import ForgotPassword from "./pages/ForgotPassword";
import Privacy from "./pages/Privacy";
import TermsOfUse from "./pages/TermsOfUse";
const IconChecklist = lazyWithSuspense(() => import("./pages/IconChecklist"));

// Prefetch every route chunk in the background after the app mounts,
// so clicking a sidebar link never waits on a network download. We schedule
// the work on requestIdleCallback (setTimeout fallback for Safari) and
// fire the imports in small staggered batches so we never compete with
// the current page's data fetches for bandwidth.
const ROUTE_PREFETCHERS: Array<() => Promise<unknown>> = [
  () => import("./pages/Index"),
  () => import("./pages/Login"),
  () => import("./pages/NoAccess"),
  () => import("./pages/Clients"),
  () => import("./pages/Cars"),
  () => import("./pages/Policies"),
  () => import("./pages/Companies"),
  () => import("./pages/Brokers"),
  () => import("./pages/BrokerWallet"),
  () => import("./pages/Cheques"),
  () => import("./pages/Media"),
  () => import("./pages/AdminUsers"),
  () => import("./pages/BranchManagement"),
  () => import("./pages/SmsOnboarding"),
  () => import("./pages/Receipts"),
  () => import("./pages/Accounting"),
  () => import("./pages/CompanySettlement"),
  () => import("./pages/CompanySettlementDetail"),
  () => import("./pages/InvoiceTemplates"),
  () => import("./pages/InsuranceCategories"),
  () => import("./pages/RoadServices"),
  () => import("./pages/AccidentFeeServices"),
  () => import("./pages/PaymentSettings"),
  () => import("./pages/SmsSettings"),
  () => import("./pages/CustomerSignatures"),
  () => import("./pages/Notifications"),
  () => import("./pages/WordPressImport"),
  () => import("./pages/DatabaseMigration"),
  () => import("./pages/NotFound"),
  () => import("./pages/SmsHistory"),
  () => import("./pages/DebtTracking"),
  () => import("./pages/AuthSettings"),
  () => import("./pages/FinancialReports"),
  () => import("./pages/CompanyWallet"),
  () => import("./pages/ElzamiCostsReport"),
  () => import("./pages/PolicyReports"),
  () => import("./pages/MarketingSms"),
  () => import("./pages/AccidentReports"),
  () => import("./pages/AccidentReportForm"),
  () => import("./pages/AccidentTemplateMapper"),
  () => import("./pages/AnnouncementSettings"),
  () => import("./pages/Tasks"),
  () => import("./pages/BusinessContacts"),
  () => import("./pages/RepairClaims"),
  () => import("./pages/RepairClaimDetail"),
  () => import("./pages/CorrespondenceLetters"),
  () => import("./pages/Leads"),
  () => import("./pages/FormTemplates"),
  () => import("./pages/FormTemplateEditor"),
  () => import("./pages/ActivityLog"),
  () => import("./pages/BrandingSettings"),
  () => import("./pages/SubscriptionExpired"),
  () => import("./pages/Subscription"),
  () => import("./pages/ThiqaAgents"),
  () => import("./pages/ThiqaAgentDetail"),
  () => import("./pages/ThiqaCreateAgent"),
  () => import("./pages/ThiqaPayments"),
  () => import("./pages/ThiqaDashboard"),
  () => import("./pages/ThiqaSettings"),
  () => import("./pages/ThiqaLandingCMS"),
  () => import("./pages/ThiqaAnalytics"),
  () => import("./pages/Landing"),
  () => import("./pages/VerifyEmail"),
  () => import("./pages/Pricing"),
  () => import("./pages/FAQ"),
  () => import("./pages/ContactUs"),
  () => import("./pages/ResetPassword"),
  () => import("./pages/ForgotPassword"),
  () => import("./pages/IconChecklist"),
  () => import("./pages/Privacy"),
  () => import("./pages/TermsOfUse"),
];

function RoutePrefetcher() {
  useEffect(() => {
    let cancelled = false;
    let i = 0;
    const pump = () => {
      if (cancelled) return;
      // Fire 4 chunk imports in parallel per pump, then yield back to
      // the browser before requesting more work. Browser dedupes the
      // import promise, so calling import() for the page the user is
      // currently on is essentially free.
      const batch = ROUTE_PREFETCHERS.slice(i, i + 4);
      i += 4;
      Promise.all(batch.map(fn => fn().catch(() => undefined))).then(() => {
        if (cancelled || i >= ROUTE_PREFETCHERS.length) return;
        schedule();
      });
    };
    const schedule = () => {
      const ric = (window as any).requestIdleCallback;
      if (typeof ric === "function") {
        ric(pump, { timeout: 2000 });
      } else {
        setTimeout(pump, 300);
      }
    };
    schedule();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Prevent "reload-like" behavior when returning to the tab
      refetchOnWindowFocus: false,
      // Treat data as fresh for 30s after fetch — second mounts of the
      // same hook within that window reuse the cached payload instead
      // of firing another network request. This is what kills the
      // "same query × N components" duplicates the Network tab keeps
      // showing (profiles?select=permissions × 3, branches × 2, etc.).
      // Tune individual queries higher (e.g. branches at 10min) when
      // their data changes rarely.
      staleTime: 30 * 1000,
      // Keep cached payloads in memory for 5 minutes after the last
      // observer unmounts, so navigating away and back doesn't refetch.
      gcTime: 5 * 60 * 1000,
      // Retry once on network failure — the default of 3 amplifies
      // user-visible latency on flaky connections.
      retry: 1,
    },
  },
});

// During the prerender pass, scripts/prerender.mjs reads
// window.__GET_QUERY_CACHE__() to dehydrate the QueryClient state and
// inject it into the captured HTML as a __REACT_QUERY_STATE__ JSON
// blob. On a real visit, we rehydrate that blob into queryClient
// SYNCHRONOUSLY at module-init time (before React renders), so
// useLandingContent and any other query returns the same Supabase-
// sourced data the prerender saw on hydration's first render — no
// fallback-vs-CMS text mismatch / React error #418.
//
// We do this directly with `hydrate()` instead of <HydrationBoundary>
// because the boundary applies state on commit, which can race with
// the first render's data read in production minified builds; the
// direct call guarantees the cache is populated before App ever
// mounts.
if (typeof window !== "undefined") {
  const w = window as {
    __GET_QUERY_CACHE__?: () => unknown;
    __REACT_QUERY_STATE__?: Parameters<typeof hydrate>[1];
  };
  w.__GET_QUERY_CACHE__ = () => dehydrate(queryClient);
  if (w.__REACT_QUERY_STATE__) {
    hydrate(queryClient, w.__REACT_QUERY_STATE__);
  }
}

// Session tracker wrapper component
function SessionTrackerWrapper({ children }: { children: React.ReactNode }) {
  useSessionTracker();
  return <>{children}</>;
}

// Public-page widgets: cookie banner + accessibility FAB. Mounted on
// every public marketing/auth/legal route so the visitor experience
// is consistent — the cookie banner persists its choice in
// localStorage, so it only shows the first time and stays dismissed
// across pages. The authenticated CRM is excluded by virtue of not
// being in this list.
const PUBLIC_WIDGET_PATHS = new Set([
  "/",
  "/landing",
  "/pricing",
  "/faq",
  "/contact",
  "/login",
  "/register",
  "/terms",
  "/privacy",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
]);

function PublicWidgets() {
  const location = useLocation();
  if (!PUBLIC_WIDGET_PATHS.has(location.pathname)) return null;
  return (
    <>
      <Suspense fallback={null}>
        <CookieConsent />
        <AccessibilityWidget />
      </Suspense>
    </>
  );
}

// Wraps the global UI chrome (toasters, lazy-loaded widget hosts, public
// widgets) that depends on browser-only state which can't be matched
// between the prerender snapshot and hydration first-render — sonner's
// useTheme(), createPortal targets, lazy-resolved Suspense boundaries,
// localStorage-driven banners, etc.
//
// During the build-time prerender pass, scripts/prerender.mjs sets
// window.__PRERENDER__ via evaluateOnNewDocument BEFORE the bundle runs.
// We never set chromeMounted in that case, so the snapshot ships without
// the chrome and dist/<route>/index.html is hydration-safe.
//
// On real users, chromeMounted flips to true on the first effect tick
// after hydration, mounting the chrome ~one frame later. The brief delay
// is invisible because the chrome is mostly empty viewports + a fixed-
// position cookie banner that animates in anyway.
function DeferredChrome({ children }: { children: React.ReactNode }) {
  const [chromeMounted, setChromeMounted] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ((window as { __PRERENDER__?: boolean }).__PRERENDER__) return;
    setChromeMounted(true);
  }, []);
  if (!chromeMounted) return null;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <HelmetProvider>
      <TooltipProvider>
        <DeferredChrome>
          <Toaster />
          <Sonner />
          <Suspense fallback={null}>
            <GlobalQuotaDialogHost />
          </Suspense>
        </DeferredChrome>
        <BrowserRouter>
          <UnsavedChangesProvider>
          <AuthProvider>
            <SessionTrackerWrapper>
            <AgentProvider>
            <AgentLimitsProvider>
            <UpgradePromptProvider>
            <SiteHelmet />
            <PrerenderReadyBeacon />
            <SidebarStateProvider>
            <RecentClientProvider>
            <PolicyWizardControllerProvider>
            <DeferredChrome>
              <Suspense fallback={null}>
                <GlobalPolicyWizardHost />
                <ThaqibWidget />
              </Suspense>
              <PublicWidgets />
            </DeferredChrome>
            <RoutePrefetcher />
            <AppChrome />
            {/* No global Suspense around <Routes> — each lazy route
                carries its own Suspense via lazyWithSuspense() so the
                eager prerendered routes have NO Suspense boundary in
                their hydration path. A surrounding boundary would
                suspend on first render and clobber the prerendered
                DOM with its fallback (React error #418). */}
            <Routes>
              <Route path="/landing" element={<Landing />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/faq" element={<FAQ />} />
              <Route path="/contact" element={<ContactUs />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Login />} />
              <Route path="/no-access" element={<NoAccess />} />
              {/* Post-Google-OAuth landing for users who haven't been
                  set up yet. Public route — relies on the supabase
                  session cookie, not on a profile/agent_id, since
                  setup is exactly what this page is for. */}
              <Route path="/oauth-confirm" element={<OAuthConfirm />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<TermsOfUse />} />
              <Route path="/icon-checklist" element={<IconChecklist />} />
              <Route path="/subscription-expired" element={<SubscriptionExpired />} />
              {/* Thiqa Super Admin routes */}
              <Route path="/thiqa" element={<ThiqaAdminRoute><ThiqaDashboard /></ThiqaAdminRoute>} />
              <Route path="/thiqa/agents" element={<ThiqaAdminRoute><ThiqaAgents /></ThiqaAdminRoute>} />
              <Route path="/thiqa/agents/new" element={<ThiqaAdminRoute><ThiqaCreateAgent /></ThiqaAdminRoute>} />
              <Route path="/thiqa/agents/:agentId" element={<ThiqaAdminRoute><ThiqaAgentDetail /></ThiqaAdminRoute>} />
              <Route path="/thiqa/payments" element={<ThiqaAdminRoute><ThiqaPayments /></ThiqaAdminRoute>} />
              <Route path="/thiqa/settings" element={<ThiqaAdminRoute><ThiqaSettings /></ThiqaAdminRoute>} />
              <Route path="/thiqa/landing-cms" element={<ThiqaAdminRoute><ThiqaLandingCMS /></ThiqaAdminRoute>} />
              <Route path="/thiqa/analytics" element={<ThiqaAdminRoute><ThiqaAnalytics /></ThiqaAdminRoute>} />
              <Route path="/thiqa/support" element={<ThiqaAdminRoute><ThiqaSupport /></ThiqaAdminRoute>} />
              <Route path="/thiqa/paypal-test" element={<ThiqaAdminRoute><PayPalTest /></ThiqaAdminRoute>} />
              <Route path="/" element={<Landing />} />
              <Route path="/dashboard" element={
                <PermissionRoute permission="page.dashboard" feature="dashboard">
                  <Index />
                </PermissionRoute>
              } />
              <Route path="/tasks" element={
                <PermissionRoute permission="page.tasks" feature="tasks">
                  <Tasks />
                </PermissionRoute>
              } />
              {/* Activity log is now a dialog in Dashboard, but keep the page as fallback */}
              <Route path="/activity" element={
                <PermissionRoute permission="page.activity">
                  <ActivityLog />
                </PermissionRoute>
              } />
              <Route path="/contacts" element={
                <PermissionRoute permission="page.contacts" feature="contacts">
                  <BusinessContacts />
                </PermissionRoute>
              } />
              <Route path="/clients" element={
                <ProtectedRoute>
                  <Clients />
                </ProtectedRoute>
              } />
              <Route path="/clients/:clientId" element={
                <ProtectedRoute>
                  <Clients />
                </ProtectedRoute>
              } />
              <Route path="/cars" element={
                <ProtectedRoute>
                  <Cars />
                </ProtectedRoute>
              } />
              <Route path="/policies" element={
                <ProtectedRoute>
                  <Policies />
                </ProtectedRoute>
              } />
              <Route path="/companies" element={
                <PermissionRoute permission="page.companies">
                  <Companies />
                </PermissionRoute>
              } />
              <Route path="/brokers" element={
                <PermissionRoute permission="page.brokers" feature="broker_wallet">
                  <Brokers />
                </PermissionRoute>
              } />
              <Route path="/brokers/:brokerId" element={
                <PermissionRoute permission="page.brokers" feature="broker_wallet">
                  <Brokers />
                </PermissionRoute>
              } />
              <Route path="/brokers/:brokerId/wallet" element={
                <PermissionRoute permission="page.brokers" feature="broker_wallet">
                  <BrokerWallet />
                </PermissionRoute>
              } />
              <Route path="/cheques" element={
                <PermissionRoute permission="page.cheques" feature="cheques">
                  <Cheques />
                </PermissionRoute>
              } />
              <Route path="/media" element={
                <PermissionRoute permission="page.media" feature="files_upload">
                  <Media />
                </PermissionRoute>
              } />
              <Route path="/admin/users" element={
                <PermissionRoute permission="page.users">
                  <AdminUsers />
                </PermissionRoute>
              } />
              <Route path="/admin/branches" element={
                <PermissionRoute permission="page.branches">
                  <BranchManagement />
                </PermissionRoute>
              } />
              <Route path="/admin/sms-settings" element={
                <PermissionRoute permission="page.sms_settings">
                  <SmsOnboarding />
                </PermissionRoute>
              } />
              <Route path="/receipts" element={
                <PermissionRoute permission="page.receipts" feature="receipts">
                  <Receipts />
                </PermissionRoute>
              } />
              <Route path="/accounting" element={
                <PermissionRoute permission="page.accounting" feature="accounting">
                  <Accounting />
                </PermissionRoute>
              } />
              <Route path="/reports/company-settlement" element={
                <PermissionRoute permission="page.company_settlement">
                  <CompanySettlement />
                </PermissionRoute>
              } />
              <Route path="/reports/company-settlement/:companyId" element={
                <PermissionRoute permission="page.company_settlement">
                  <CompanySettlementDetail />
                </PermissionRoute>
              } />
              <Route path="/reports/company-settlement/:companyId/wallet" element={
                <PermissionRoute permission="page.company_settlement">
                  <CompanyWallet />
                </PermissionRoute>
              } />
              {/* Redirect old wallet route to new location */}
              <Route path="/companies/:companyId/wallet" element={
                <PermissionRoute permission="page.company_settlement">
                  <CompanyWallet />
                </PermissionRoute>
              } />
              <Route path="/admin/invoice-templates" element={
                <PermissionRoute permission="page.invoice_templates">
                  <InvoiceTemplates />
                </PermissionRoute>
              } />
              <Route path="/admin/insurance-categories" element={
                <PermissionRoute permission="page.insurance_categories">
                  <InsuranceCategories />
                </PermissionRoute>
              } />
              <Route path="/admin/road-services" element={
                <PermissionRoute permission="page.road_services" feature="road_services">
                  <RoadServices />
                </PermissionRoute>
              } />
              <Route path="/admin/accident-fee-services" element={
                <PermissionRoute permission="page.accident_fees" feature="accident_fees">
                  <AccidentFeeServices />
                </PermissionRoute>
              } />
              <Route path="/admin/payment-settings" element={
                <PermissionRoute permission="page.payment_settings">
                  <PaymentSettings />
                </PermissionRoute>
              } />
              <Route path="/admin/sms-settings" element={
                <PermissionRoute permission="page.sms_settings">
                  <SmsSettings />
                </PermissionRoute>
              } />
              <Route path="/admin/customer-signatures" element={
                <PermissionRoute permission="page.customer_signatures" feature="digital_signatures">
                  <CustomerSignatures />
                </PermissionRoute>
              } />
              <Route path="/notifications" element={
                <ProtectedRoute>
                  <Notifications />
                </ProtectedRoute>
              } />
              <Route path="/admin/wordpress-import" element={
                <PermissionRoute permission="page.database_migration">
                  <WordPressImport />
                </PermissionRoute>
              } />
              <Route path="/admin/database-migration" element={
                <PermissionRoute permission="page.database_migration">
                  <DatabaseMigration />
                </PermissionRoute>
              } />
              <Route path="/sms-history" element={
                <PermissionRoute permission="page.sms_history" feature="sms">
                  <SmsHistory />
                </PermissionRoute>
              } />
              <Route path="/debt-tracking" element={
                <PermissionRoute permission="page.debt_tracking" feature="debt_tracking">
                  <DebtTracking />
                </PermissionRoute>
              } />
              <Route path="/admin/auth-settings" element={
                <PermissionRoute permission="page.auth_settings">
                  <AuthSettings />
                </PermissionRoute>
              } />
              <Route path="/reports/financial" element={
                <PermissionRoute permission="page.financial_reports" feature="financial_reports">
                  <FinancialReports />
                </PermissionRoute>
              } />
              <Route path="/reports/elzami-costs" element={
                <PermissionRoute permission="page.elzami_costs">
                  <ElzamiCostsReport />
                </PermissionRoute>
              } />
              <Route path="/reports/policies" element={
                <ProtectedRoute>
                  <PolicyReports />
                </ProtectedRoute>
              } />
              <Route path="/accidents" element={
                <PermissionRoute permission="page.accidents" feature="accident_reports">
                  <AccidentReports />
                </PermissionRoute>
              } />
              {/* Direct accident report access by reportId only */}
              <Route path="/accidents/:reportId" element={
                <PermissionRoute permission="page.accidents" feature="accident_reports">
                  <AccidentReportForm />
                </PermissionRoute>
              } />
              <Route path="/policies/:policyId/accident/:reportId?" element={
                <PermissionRoute permission="page.accidents" feature="accident_reports">
                  <AccidentReportForm />
                </PermissionRoute>
              } />
              <Route path="/admin/accident-template-mapper/:companyId" element={
                <PermissionRoute permission="page.accident_fees">
                  <AccidentTemplateMapper />
                </PermissionRoute>
              } />
              <Route path="/admin/marketing-sms" element={
                <PermissionRoute permission="page.marketing_sms" feature="marketing_sms">
                  <MarketingSms />
                </PermissionRoute>
              } />
              {/* Thiqa super admin announcement settings */}
              <Route path="/thiqa/announcements" element={
                <ThiqaAdminRoute>
                  <AnnouncementSettings />
                </ThiqaAdminRoute>
              } />
              <Route path="/admin/correspondence" element={
                <PermissionRoute permission="page.correspondence" feature="correspondence">
                  <CorrespondenceLetters />
                </PermissionRoute>
              } />
              {/* Form Templates */}
              <Route path="/form-templates" element={
                <PermissionRoute permission="page.form_templates" feature="files_explorer">
                  <FormTemplates />
                </PermissionRoute>
              } />
              <Route path="/form-templates/edit/:fileId" element={
                <PermissionRoute permission="page.form_templates" feature="files_explorer">
                  <FormTemplateEditor />
                </PermissionRoute>
              } />
              {/* Leads from WhatsApp — no plan feature gate (kept free) */}
              <Route path="/leads" element={
                <PermissionRoute permission="page.leads">
                  <Leads />
                </PermissionRoute>
              } />
              {/* AI quote requests from the WhatsApp deterministic flow */}
              <Route path="/customer-requests" element={
                <PermissionRoute permission="page.customer_requests" feature="whatsapp_ai_agent">
                  <CustomerRequests />
                </PermissionRoute>
              } />
              {/* Claims routes */}
              <Route path="/admin/claims" element={
                <PermissionRoute permission="page.repair_claims" feature="repair_claims">
                  <RepairClaims />
                </PermissionRoute>
              } />
              <Route path="/admin/claims/:claimId" element={
                <PermissionRoute permission="page.repair_claims" feature="repair_claims">
                  <RepairClaimDetail />
                </PermissionRoute>
              } />
              {/* Public payment callback routes (loaded in iframe) */}
              <Route path="/payment/success" element={<PaymentSuccess />} />
              <Route path="/payment/fail" element={<PaymentFail />} />
              {/* Public signature page */}
              <Route path="/sign/:token" element={<SignaturePage />} />
              <Route path="/admin/branding" element={
                <PermissionRoute permission="page.branding">
                  <BrandingSettings />
                </PermissionRoute>
              } />
              <Route path="/subscription" element={
                <ProtectedRoute>
                  <Subscription />
                </ProtectedRoute>
              } />
              {/* Support — open to every authenticated agent user.
                  No permission gate so even a worker can flag a bug. */}
              <Route path="/support" element={
                <ProtectedRoute>
                  <Support />
                </ProtectedRoute>
              } />
              <Route path="/support/:ticketId" element={
                <ProtectedRoute>
                  <Support />
                </ProtectedRoute>
              } />
              {/* Admin-side ticket detail: same TicketThread component
                  but lives under /thiqa/* so super-admins (who are
                  fenced into /thiqa by ProtectedRoute) can actually
                  open a ticket without being bounced back. */}
              <Route path="/thiqa/support/:ticketId" element={<ThiqaAdminRoute><Support /></ThiqaAdminRoute>} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            </PolicyWizardControllerProvider>
            </RecentClientProvider>
            </SidebarStateProvider>
            </UpgradePromptProvider>
            </AgentLimitsProvider>
            </AgentProvider>
            </SessionTrackerWrapper>
          </AuthProvider>
          </UnsavedChangesProvider>
        </BrowserRouter>
      </TooltipProvider>
    </HelmetProvider>
  </QueryClientProvider>
);

export default App;
