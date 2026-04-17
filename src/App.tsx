import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GlobalQuotaDialogHost } from "@/components/subscription/GlobalQuotaDialogHost";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { RecentClientProvider } from "@/hooks/useRecentClient";
import { PolicyWizardControllerProvider } from "@/hooks/usePolicyWizardController";
import { GlobalPolicyWizardHost } from "@/components/policies/GlobalPolicyWizardHost";
import { ThaqibWidget } from "@/components/ai-assistant/ThaqibWidget";
import { useSessionTracker } from "@/hooks/useSessionTracker";
import { SidebarStateProvider } from "@/hooks/useSidebarState";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AdminRoute } from "@/components/auth/AdminRoute";
import Index from "./pages/Index";
import Login from "./pages/Login";
import NoAccess from "./pages/NoAccess";
import Clients from "./pages/Clients";
import Cars from "./pages/Cars";
import Policies from "./pages/Policies";
import Companies from "./pages/Companies";
import Brokers from "./pages/Brokers";
import BrokerWallet from "./pages/BrokerWallet";
import Cheques from "./pages/Cheques";
import Media from "./pages/Media";
import AdminUsers from "./pages/AdminUsers";
import BranchManagement from "./pages/BranchManagement";
import SmsOnboarding from "./pages/SmsOnboarding";
import Receipts from "./pages/Receipts";
import Accounting from "./pages/Accounting";
import CompanySettlement from "./pages/CompanySettlement";
import CompanySettlementDetail from "./pages/CompanySettlementDetail";

import InvoiceTemplates from "./pages/InvoiceTemplates";
import InsuranceCategories from "./pages/InsuranceCategories";
import RoadServices from "./pages/RoadServices";
import AccidentFeeServices from "./pages/AccidentFeeServices";
import PaymentSettings from "./pages/PaymentSettings";
import SmsSettings from "./pages/SmsSettings";
import CustomerSignatures from "./pages/CustomerSignatures";
import PaymentSuccess from "./pages/PaymentSuccess";
import PaymentFail from "./pages/PaymentFail";
import SignaturePage from "./pages/SignaturePage";
import Notifications from "./pages/Notifications";
import WordPressImport from "./pages/WordPressImport";
import DatabaseMigration from "./pages/DatabaseMigration";
import NotFound from "./pages/NotFound";
import SmsHistory from "./pages/SmsHistory";
import DebtTracking from "./pages/DebtTracking";
import AuthSettings from "./pages/AuthSettings";
import FinancialReports from "./pages/FinancialReports";
import CompanyWallet from "./pages/CompanyWallet";
import ElzamiCostsReport from "./pages/ElzamiCostsReport";
import PolicyReports from "./pages/PolicyReports";
import MarketingSms from "./pages/MarketingSms";
import AccidentReports from "./pages/AccidentReports";
import AccidentReportForm from "./pages/AccidentReportForm";
import AccidentTemplateMapper from "./pages/AccidentTemplateMapper";
import AnnouncementSettings from "./pages/AnnouncementSettings";
import Tasks from "./pages/Tasks";
import BusinessContacts from "./pages/BusinessContacts";
import RepairClaims from "./pages/RepairClaims";
import RepairClaimDetail from "./pages/RepairClaimDetail";
import CorrespondenceLetters from "./pages/CorrespondenceLetters";
import Leads from "./pages/Leads";
import FormTemplates from "./pages/FormTemplates";
import FormTemplateEditor from "./pages/FormTemplateEditor";
import ActivityLog from "./pages/ActivityLog";
import BrandingSettings from "./pages/BrandingSettings";
// XService removed — not available in Thiqa platform
import { SiteHelmet } from "@/components/layout/SiteHelmet";
import { AgentProvider } from "@/hooks/useAgentContext";
import { ThiqaAdminRoute } from "@/components/auth/ThiqaAdminRoute";
import SubscriptionExpired from "./pages/SubscriptionExpired";
import Subscription from "./pages/Subscription";
import ThiqaAgents from "./pages/ThiqaAgents";
import ThiqaAgentDetail from "./pages/ThiqaAgentDetail";
import ThiqaCreateAgent from "./pages/ThiqaCreateAgent";
import ThiqaPayments from "./pages/ThiqaPayments";
import ThiqaDashboard from "./pages/ThiqaDashboard";
import ThiqaSettings from "./pages/ThiqaSettings";
import ThiqaLandingCMS from "./pages/ThiqaLandingCMS";
import ThiqaAnalytics from "./pages/ThiqaAnalytics";
import Landing from "./pages/Landing";
import VerifyEmail from "./pages/VerifyEmail";
import Pricing from "./pages/Pricing";
import ResetPassword from "./pages/ResetPassword";
import ForgotPassword from "./pages/ForgotPassword";

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

// Root route: getthiqa.com serves the marketing landing to logged-out
// visitors. Logged-in users are redirected to the canonical /dashboard
// URL so the app UI lives under its own path instead of "/". The
// loader lock prevents a landing-page flash while the session hydrates.
function HomeRoute() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) return <Landing />;
  return <Navigate to="/dashboard" replace />;
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
            <Routes>
              <Route path="/landing" element={<Landing />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Login />} />
              <Route path="/no-access" element={<NoAccess />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
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
              <Route path="/" element={<HomeRoute />} />
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
