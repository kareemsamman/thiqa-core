import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { AppChrome } from "@/components/layout/AppChrome";
import { AgentProvider } from "@/hooks/useAgentContext";
import { UpgradePromptProvider } from "@/components/pricing/UpgradePromptProvider";
import { ThiqaAdminRoute } from "@/components/auth/ThiqaAdminRoute";

// All pages are code-split. Each route's bundle is only downloaded when
// the user navigates to it. The Suspense fallback is intentionally null
// (not the Thiqa loading screen) — the router keeps the previous page
// rendered while the new chunk loads, so a null fallback means "no
// visible spinner mid-navigation." RoutePrefetcher below then warms
// every chunk in the background once the app is idle, so by the time
// the user actually clicks a nav link the target page is already
// cached.
const Index = lazy(() => import("./pages/Index"));
const Login = lazy(() => import("./pages/Login"));
const NoAccess = lazy(() => import("./pages/NoAccess"));
const OAuthConfirm = lazy(() => import("./pages/OAuthConfirm"));
const Clients = lazy(() => import("./pages/Clients"));
const Cars = lazy(() => import("./pages/Cars"));
const Policies = lazy(() => import("./pages/Policies"));
const Companies = lazy(() => import("./pages/Companies"));
const Brokers = lazy(() => import("./pages/Brokers"));
const BrokerWallet = lazy(() => import("./pages/BrokerWallet"));
const Cheques = lazy(() => import("./pages/Cheques"));
const Media = lazy(() => import("./pages/Media"));
const AdminUsers = lazy(() => import("./pages/AdminUsers"));
const BranchManagement = lazy(() => import("./pages/BranchManagement"));
const SmsOnboarding = lazy(() => import("./pages/SmsOnboarding"));
const Receipts = lazy(() => import("./pages/Receipts"));
const Accounting = lazy(() => import("./pages/Accounting"));
const CompanySettlement = lazy(() => import("./pages/CompanySettlement"));
const CompanySettlementDetail = lazy(() => import("./pages/CompanySettlementDetail"));
const InvoiceTemplates = lazy(() => import("./pages/InvoiceTemplates"));
const InsuranceCategories = lazy(() => import("./pages/InsuranceCategories"));
const RoadServices = lazy(() => import("./pages/RoadServices"));
const AccidentFeeServices = lazy(() => import("./pages/AccidentFeeServices"));
const PaymentSettings = lazy(() => import("./pages/PaymentSettings"));
const SmsSettings = lazy(() => import("./pages/SmsSettings"));
const CustomerSignatures = lazy(() => import("./pages/CustomerSignatures"));
const PaymentSuccess = lazy(() => import("./pages/PaymentSuccess"));
const PaymentFail = lazy(() => import("./pages/PaymentFail"));
const SignaturePage = lazy(() => import("./pages/SignaturePage"));
const Notifications = lazy(() => import("./pages/Notifications"));
const WordPressImport = lazy(() => import("./pages/WordPressImport"));
const DatabaseMigration = lazy(() => import("./pages/DatabaseMigration"));
const NotFound = lazy(() => import("./pages/NotFound"));
const SmsHistory = lazy(() => import("./pages/SmsHistory"));
const DebtTracking = lazy(() => import("./pages/DebtTracking"));
const AuthSettings = lazy(() => import("./pages/AuthSettings"));
const FinancialReports = lazy(() => import("./pages/FinancialReports"));
const CompanyWallet = lazy(() => import("./pages/CompanyWallet"));
const ElzamiCostsReport = lazy(() => import("./pages/ElzamiCostsReport"));
const PolicyReports = lazy(() => import("./pages/PolicyReports"));
const MarketingSms = lazy(() => import("./pages/MarketingSms"));
const AccidentReports = lazy(() => import("./pages/AccidentReports"));
const AccidentReportForm = lazy(() => import("./pages/AccidentReportForm"));
const AccidentTemplateMapper = lazy(() => import("./pages/AccidentTemplateMapper"));
const AnnouncementSettings = lazy(() => import("./pages/AnnouncementSettings"));
const Tasks = lazy(() => import("./pages/Tasks"));
const BusinessContacts = lazy(() => import("./pages/BusinessContacts"));
const RepairClaims = lazy(() => import("./pages/RepairClaims"));
const RepairClaimDetail = lazy(() => import("./pages/RepairClaimDetail"));
const CorrespondenceLetters = lazy(() => import("./pages/CorrespondenceLetters"));
const Leads = lazy(() => import("./pages/Leads"));
const FormTemplates = lazy(() => import("./pages/FormTemplates"));
const FormTemplateEditor = lazy(() => import("./pages/FormTemplateEditor"));
const ActivityLog = lazy(() => import("./pages/ActivityLog"));
const BrandingSettings = lazy(() => import("./pages/BrandingSettings"));
const SubscriptionExpired = lazy(() => import("./pages/SubscriptionExpired"));
const Subscription = lazy(() => import("./pages/Subscription"));
const Support = lazy(() => import("./pages/Support"));
const ThiqaAgents = lazy(() => import("./pages/ThiqaAgents"));
const ThiqaAgentDetail = lazy(() => import("./pages/ThiqaAgentDetail"));
const ThiqaCreateAgent = lazy(() => import("./pages/ThiqaCreateAgent"));
const ThiqaPayments = lazy(() => import("./pages/ThiqaPayments"));
const ThiqaDashboard = lazy(() => import("./pages/ThiqaDashboard"));
const ThiqaSettings = lazy(() => import("./pages/ThiqaSettings"));
const ThiqaLandingCMS = lazy(() => import("./pages/ThiqaLandingCMS"));
const ThiqaAnalytics = lazy(() => import("./pages/ThiqaAnalytics"));
const ThiqaSupport = lazy(() => import("./pages/ThiqaSupport"));
const PayPalTest = lazy(() => import("./pages/PayPalTest"));
const Landing = lazy(() => import("./pages/Landing"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail"));
const Pricing = lazy(() => import("./pages/Pricing"));
const FAQ = lazy(() => import("./pages/FAQ"));
const ContactUs = lazy(() => import("./pages/ContactUs"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const Privacy = lazy(() => import("./pages/Privacy"));
const TermsOfUse = lazy(() => import("./pages/TermsOfUse"));
const IconChecklist = lazy(() => import("./pages/IconChecklist"));

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
    },
  },
});

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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <HelmetProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Suspense fallback={null}>
          <GlobalQuotaDialogHost />
        </Suspense>
        <BrowserRouter>
          <AuthProvider>
            <SessionTrackerWrapper>
            <AgentProvider>
            <UpgradePromptProvider>
            <SiteHelmet />
            <SidebarStateProvider>
            <RecentClientProvider>
            <PolicyWizardControllerProvider>
            <Suspense fallback={null}>
              <GlobalPolicyWizardHost />
              <ThaqibWidget />
            </Suspense>
            <PublicWidgets />
            <RoutePrefetcher />
            <AppChrome />
            <Suspense fallback={null}>
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
            </Suspense>
            </PolicyWizardControllerProvider>
            </RecentClientProvider>
            </SidebarStateProvider>
            </UpgradePromptProvider>
            </AgentProvider>
            </SessionTrackerWrapper>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </HelmetProvider>
  </QueryClientProvider>
);

export default App;
