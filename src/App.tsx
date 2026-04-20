import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GlobalQuotaDialogHost } from "@/components/subscription/GlobalQuotaDialogHost";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { AuthProvider } from "@/hooks/useAuth";
import { RecentClientProvider } from "@/hooks/useRecentClient";
import { PolicyWizardControllerProvider } from "@/hooks/usePolicyWizardController";
import { GlobalPolicyWizardHost } from "@/components/policies/GlobalPolicyWizardHost";
import { ThaqibWidget } from "@/components/ai-assistant/ThaqibWidget";
import { CookieConsent } from "@/components/public/CookieConsent";
import { AccessibilityWidget } from "@/components/public/AccessibilityWidget";
import { useLocation } from "react-router-dom";
import { useSessionTracker } from "@/hooks/useSessionTracker";
import { SidebarStateProvider } from "@/hooks/useSidebarState";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AdminRoute } from "@/components/auth/AdminRoute";
import { SiteHelmet } from "@/components/layout/SiteHelmet";
import { AgentProvider } from "@/hooks/useAgentContext";
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
const ThiqaAgents = lazy(() => import("./pages/ThiqaAgents"));
const ThiqaAgentDetail = lazy(() => import("./pages/ThiqaAgentDetail"));
const ThiqaCreateAgent = lazy(() => import("./pages/ThiqaCreateAgent"));
const ThiqaPayments = lazy(() => import("./pages/ThiqaPayments"));
const ThiqaDashboard = lazy(() => import("./pages/ThiqaDashboard"));
const ThiqaSettings = lazy(() => import("./pages/ThiqaSettings"));
const ThiqaLandingCMS = lazy(() => import("./pages/ThiqaLandingCMS"));
const ThiqaAnalytics = lazy(() => import("./pages/ThiqaAnalytics"));
const Landing = lazy(() => import("./pages/Landing"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail"));
const Pricing = lazy(() => import("./pages/Pricing"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const Privacy = lazy(() => import("./pages/Privacy"));
const TermsOfUse = lazy(() => import("./pages/TermsOfUse"));

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
  () => import("./pages/ResetPassword"),
  () => import("./pages/ForgotPassword"),
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

// Public-page widgets: cookie banner + accessibility FAB. Mounted only
// on the marketing landing and the auth/legal pages so the
// authenticated CRM stays uncluttered. The list is intentionally
// short — exact paths only, no startsWith fan-out, since "/" would
// otherwise match every route.
const PUBLIC_WIDGET_PATHS = new Set([
  "/",
  "/login",
  "/register",
  "/terms",
  "/privacy",
]);

function PublicWidgets() {
  const location = useLocation();
  if (!PUBLIC_WIDGET_PATHS.has(location.pathname)) return null;
  return (
    <>
      <CookieConsent />
      <AccessibilityWidget />
    </>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <HelmetProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <GlobalQuotaDialogHost />
        <BrowserRouter>
          <AuthProvider>
            <SessionTrackerWrapper>
            <AgentProvider>
            <SiteHelmet />
            <SidebarStateProvider>
            <RecentClientProvider>
            <PolicyWizardControllerProvider>
            <GlobalPolicyWizardHost />
            <ThaqibWidget />
            <PublicWidgets />
            <RoutePrefetcher />
            <Suspense fallback={null}>
            <Routes>
              <Route path="/landing" element={<Landing />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Login />} />
              <Route path="/no-access" element={<NoAccess />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<TermsOfUse />} />
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
              <Route path="/" element={<Landing />} />
              <Route path="/dashboard" element={
                <ProtectedRoute>
                  <Index />
                </ProtectedRoute>
              } />
              <Route path="/tasks" element={
                <ProtectedRoute>
                  <Tasks />
                </ProtectedRoute>
              } />
              {/* Activity log is now a dialog in Dashboard, but keep the page as fallback */}
              <Route path="/activity" element={
                <ProtectedRoute>
                  <ActivityLog />
                </ProtectedRoute>
              } />
              <Route path="/contacts" element={
                <ProtectedRoute>
                  <BusinessContacts />
                </ProtectedRoute>
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
              {/* Admin-only route: Companies */}
              <Route path="/companies" element={
                <AdminRoute>
                  <Companies />
                </AdminRoute>
              } />
              {/* Admin-only routes: Brokers, BrokerWallet */}
              <Route path="/brokers" element={
                <AdminRoute>
                  <Brokers />
                </AdminRoute>
              } />
              <Route path="/brokers/:brokerId" element={
                <AdminRoute>
                  <Brokers />
                </AdminRoute>
              } />
              <Route path="/brokers/:brokerId/wallet" element={
                <AdminRoute>
                  <BrokerWallet />
                </AdminRoute>
              } />
              <Route path="/cheques" element={
                <ProtectedRoute>
                  <Cheques />
                </ProtectedRoute>
              } />
              <Route path="/media" element={
                <ProtectedRoute>
                  <Media />
                </ProtectedRoute>
              } />
              {/* Admin-only routes */}
              <Route path="/admin/users" element={
                <AdminRoute>
                  <AdminUsers />
                </AdminRoute>
              } />
              <Route path="/admin/branches" element={
                <AdminRoute>
                  <BranchManagement />
                </AdminRoute>
              } />
              <Route path="/admin/sms-settings" element={
                <AdminRoute>
                  <SmsOnboarding />
                </AdminRoute>
              } />
              <Route path="/receipts" element={
                <ProtectedRoute>
                  <Receipts />
                </ProtectedRoute>
              } />
              <Route path="/accounting" element={
                <AdminRoute>
                  <Accounting />
                </AdminRoute>
              } />
              <Route path="/reports/company-settlement" element={
                <AdminRoute>
                  <CompanySettlement />
                </AdminRoute>
              } />
              <Route path="/reports/company-settlement/:companyId" element={
                <AdminRoute>
                  <CompanySettlementDetail />
                </AdminRoute>
              } />
              <Route path="/reports/company-settlement/:companyId/wallet" element={
                <AdminRoute>
                  <CompanyWallet />
                </AdminRoute>
              } />
              {/* Redirect old wallet route to new location */}
              <Route path="/companies/:companyId/wallet" element={
                <AdminRoute>
                  <CompanyWallet />
                </AdminRoute>
              } />
              <Route path="/admin/invoice-templates" element={
                <AdminRoute>
                  <InvoiceTemplates />
                </AdminRoute>
              } />
              <Route path="/admin/insurance-categories" element={
                <AdminRoute>
                  <InsuranceCategories />
                </AdminRoute>
              } />
              <Route path="/admin/road-services" element={
                <AdminRoute>
                  <RoadServices />
                </AdminRoute>
              } />
              <Route path="/admin/accident-fee-services" element={
                <AdminRoute>
                  <AccidentFeeServices />
                </AdminRoute>
              } />
              <Route path="/admin/payment-settings" element={
                <AdminRoute>
                  <PaymentSettings />
                </AdminRoute>
              } />
              <Route path="/admin/sms-settings" element={
                <AdminRoute>
                  <SmsSettings />
                </AdminRoute>
              } />
              <Route path="/admin/customer-signatures" element={
                <AdminRoute>
                  <CustomerSignatures />
                </AdminRoute>
              } />
              <Route path="/notifications" element={
                <ProtectedRoute>
                  <Notifications />
                </ProtectedRoute>
              } />
              <Route path="/admin/wordpress-import" element={
                <AdminRoute>
                  <WordPressImport />
                </AdminRoute>
              } />
              <Route path="/admin/database-migration" element={
                <AdminRoute>
                  <DatabaseMigration />
                </AdminRoute>
              } />
              <Route path="/sms-history" element={
                <AdminRoute>
                  <SmsHistory />
                </AdminRoute>
              } />
              <Route path="/debt-tracking" element={
                <ProtectedRoute>
                  <DebtTracking />
                </ProtectedRoute>
              } />
              <Route path="/admin/auth-settings" element={
                <AdminRoute>
                  <AuthSettings />
                </AdminRoute>
              } />
              <Route path="/reports/financial" element={
                <AdminRoute>
                  <FinancialReports />
                </AdminRoute>
              } />
              <Route path="/reports/elzami-costs" element={
                <AdminRoute>
                  <ElzamiCostsReport />
                </AdminRoute>
              } />
              <Route path="/reports/policies" element={
                <ProtectedRoute>
                  <PolicyReports />
                </ProtectedRoute>
              } />
              <Route path="/accidents" element={
                <ProtectedRoute>
                  <AccidentReports />
                </ProtectedRoute>
              } />
              {/* Direct accident report access by reportId only */}
              <Route path="/accidents/:reportId" element={
                <ProtectedRoute>
                  <AccidentReportForm />
                </ProtectedRoute>
              } />
              <Route path="/policies/:policyId/accident/:reportId?" element={
                <ProtectedRoute>
                  <AccidentReportForm />
                </ProtectedRoute>
              } />
              <Route path="/admin/accident-template-mapper/:companyId" element={
                <AdminRoute>
                  <AccidentTemplateMapper />
                </AdminRoute>
              } />
              <Route path="/admin/marketing-sms" element={
                <AdminRoute>
                  <MarketingSms />
                </AdminRoute>
              } />
              {/* Thiqa super admin announcement settings */}
              <Route path="/thiqa/announcements" element={
                <ThiqaAdminRoute>
                  <AnnouncementSettings />
                </ThiqaAdminRoute>
              } />
              {/* Admin correspondence letters */}
              <Route path="/admin/correspondence" element={
                <AdminRoute>
                  <CorrespondenceLetters />
                </AdminRoute>
              } />
              {/* Form Templates */}
              <Route path="/form-templates" element={
                <ProtectedRoute>
                  <FormTemplates />
                </ProtectedRoute>
              } />
              <Route path="/form-templates/edit/:fileId" element={
                <ProtectedRoute>
                  <FormTemplateEditor />
                </ProtectedRoute>
              } />
              {/* Leads from WhatsApp - accessible to all authenticated users */}
              <Route path="/leads" element={
                <ProtectedRoute>
                  <Leads />
                </ProtectedRoute>
              } />
              {/* Claims routes - accessible to all users */}
              <Route path="/admin/claims" element={
                <ProtectedRoute>
                  <RepairClaims />
                </ProtectedRoute>
              } />
              <Route path="/admin/claims/:claimId" element={
                <ProtectedRoute>
                  <RepairClaimDetail />
                </ProtectedRoute>
              } />
              {/* Public payment callback routes (loaded in iframe) */}
              <Route path="/payment/success" element={<PaymentSuccess />} />
              <Route path="/payment/fail" element={<PaymentFail />} />
              {/* Public signature page */}
              <Route path="/sign/:token" element={<SignaturePage />} />
              <Route path="/admin/branding" element={
                <AdminRoute>
                  <BrandingSettings />
                </AdminRoute>
              } />
              <Route path="/subscription" element={
                <ProtectedRoute>
                  <Subscription />
                </ProtectedRoute>
              } />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
            </PolicyWizardControllerProvider>
            </RecentClientProvider>
            </SidebarStateProvider>
            </AgentProvider>
            </SessionTrackerWrapper>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </HelmetProvider>
  </QueryClientProvider>
);

export default App;
