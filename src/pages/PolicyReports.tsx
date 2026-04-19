import React, { useState, useEffect, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { PolicyWizard } from '@/components/policies/PolicyWizard';
import { RenewalData } from '@/components/policies/wizard/types';
import {
  Search,
  FileText,
  Calendar,
  Phone,
  Download,
  Send,
  MoreVertical,
  CheckCircle,
  AlertCircle,
  Clock,
  XCircle,
  MessageSquare,
  Loader2,
  RefreshCw,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CreditCard,
  Banknote,
  Package,
  Users,
  ArrowLeftRight,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { extractFunctionErrorMessage } from '@/lib/functionError';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import { useAuth } from '@/hooks/useAuth';
import { useAgentContext } from '@/hooks/useAgentContext';
import { ClickablePhone } from '@/components/shared/ClickablePhone';
import { getInsuranceTypeLabel } from '@/lib/insuranceTypes';
import { RenewalAssistant } from '@/components/reports/RenewalAssistant';

const policyTypeLabels: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  FULL: 'شامل',
  THIRD: 'ثالث',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
  HEALTH: 'تأمين صحي',
  LIFE: 'تأمين حياة',
  PROPERTY: 'تأمين ممتلكات',
  TRAVEL: 'تأمين سفر',
  BUSINESS: 'تأمين أعمال',
  OTHER: 'أخرى',
  PACKAGE: 'باقة',
};

// Labels for filter dropdowns only - excludes child types
const policyTypeFilterLabels: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
  HEALTH: 'تأمين صحي',
  LIFE: 'تأمين حياة',
  PROPERTY: 'تأمين ممتلكات',
  TRAVEL: 'تأمين سفر',
  BUSINESS: 'تأمين أعمال',
  OTHER: 'أخرى',
};

const renewalStatusLabels: Record<string, string> = {
  not_contacted: 'لم يتم التواصل',
  sms_sent: 'تم إرسال SMS',
  called: 'تم الاتصال',
  renewed: 'تم التجديد',
  not_interested: 'غير مهتم',
};

const renewalStatusColors: Record<string, string> = {
  not_contacted: 'bg-gray-100 text-gray-700 border-gray-200',
  sms_sent: 'bg-blue-100 text-blue-700 border-blue-200',
  called: 'bg-amber-100 text-amber-700 border-amber-200',
  renewed: 'bg-green-100 text-green-700 border-green-200',
  not_interested: 'bg-red-100 text-red-700 border-red-200',
};

interface PolicyPaymentActivity {
  id: string;
  amount: number;
  payment_date: string;
  payment_type: string;
  created_at: string;
}

// Matches new report_created_policies return type
interface CreatedPolicy {
  id: string;
  group_key: string;
  is_package: boolean;
  package_types: string[] | null;
  package_policy_ids: string[] | null;
  package_count: number;
  client_id: string;
  client_name: string;
  client_file_number: string | null;
  client_phone: string | null;
  car_id: string | null;
  car_number: string | null;
  company_id: string | null;
  company_name: string | null;
  company_name_ar: string | null;
  policy_type_parent: string;
  policy_type_child: string | null;
  policy_number: string | null;
  start_date: string;
  end_date: string;
  insurance_price: number;
  profit: number;
  total_paid: number;
  remaining: number;
  payment_status: string;
  created_at: string;
  created_by_admin_id: string | null;
  created_by_name: string | null;
  branch_name: string | null;
  total_count: number;
  package_companies: string[] | null;
  package_service_names: string[] | null;
}

// Matches new report_renewals return type - grouped by client
interface RenewalClient {
  client_id: string;
  client_name: string;
  client_file_number: string | null;
  client_phone: string | null;
  policies_count: number;
  earliest_end_date: string;
  days_remaining: number;
  total_insurance_price: number;
  policy_types: string[] | null;
  policy_ids: string[] | null;
  car_numbers: string[] | null;
  worst_renewal_status: string;
  renewal_notes: string | null;
  total_count: number;
}

// Client's individual policy details
interface RenewalPolicy {
  id: string;
  car_id: string | null;
  car_number: string | null;
  policy_type_parent: string;
  policy_type_child: string | null;
  company_id: string | null;
  company_name: string | null;
  company_name_ar: string | null;
  start_date: string;
  end_date: string;
  days_remaining: number;
  insurance_price: number;
  renewal_status: string;
  renewal_notes: string | null;
  reminder_sent_at: string | null;
}

interface RenewalSummary {
  total_expiring: number;
  not_contacted: number;
  sms_sent: number;
  called: number;
  renewed: number;
  not_interested: number;
  // New fields for enhanced stats
  total_packages: number;
  total_single: number;
  total_value: number;
}

// Renewed client for the new tab
interface RenewedClient {
  client_id: string;
  client_name: string;
  client_file_number: string | null;
  client_phone: string | null;
  policies_count: number;
  earliest_end_date: string;
  total_insurance_price: number;
  policy_types: string[] | null;
  policy_ids: string[] | null;
  new_policies_count: number;
  new_policy_ids: string[] | null;
  new_policy_types: string[] | null;
  new_total_price: number;
  new_start_date: string | null;
  has_package: boolean;
  renewed_by_admin_id: string | null;
  renewed_by_name: string | null;
  total_count: number;
}

interface Company {
  id: string;
  name: string;
  name_ar: string | null;
}

interface User {
  id: string;
  display_name: string;
}

const PAGE_SIZE = 25;

export default function PolicyReports() {
  const navigate = useNavigate();
  const { isAdmin, user } = useAuth();
  const { agentId } = useAgentContext();
  const [activeTab, setActiveTab] = useState('created');
  // Sub-tab inside the Renewals top-tab. Starts on "pending" — the
  // legacy list — and flips to "renewed" whenever a follow-up is
  // marked as renewed (via the assistant or the wizard onSaved).
  const [renewalSubTab, setRenewalSubTab] = useState<'pending' | 'declined' | 'renewed'>('pending');
  const [renewalAssistantOpen, setRenewalAssistantOpen] = useState(false);
  const [declinedFollowups, setDeclinedFollowups] = useState<Array<{
    client_id: string;
    client_name: string;
    client_phone: string | null;
    follow_up_month: string;
    decline_reason: string | null;
    updated_at: string;
  }>>([]);
  const [declinedLoading, setDeclinedLoading] = useState(false);
  
  // Created Policies State
  const [createdPolicies, setCreatedPolicies] = useState<CreatedPolicy[]>([]);
  const [createdLoading, setCreatedLoading] = useState(true);
  const [createdPage, setCreatedPage] = useState(0);
  const [createdTotalRows, setCreatedTotalRows] = useState(0);
  const [createdDatePreset, setCreatedDatePreset] = useState('today');
  const [createdFromDate, setCreatedFromDate] = useState<string>('');
  const [createdToDate, setCreatedToDate] = useState<string>('');
  const [createdByFilter, setCreatedByFilter] = useState<string>('all');
  const [createdPolicyTypeFilter, setCreatedPolicyTypeFilter] = useState<string>('all');
  const [createdCompanyFilter, setCreatedCompanyFilter] = useState<string>('all');
  const [createdSearch, setCreatedSearch] = useState('');
  
  // Renewals State - now grouped by client
  const [renewalClients, setRenewalClients] = useState<RenewalClient[]>([]);
  const [renewalsLoading, setRenewalsLoading] = useState(true);
  const [renewalsPage, setRenewalsPage] = useState(0);
  const [renewalsTotalRows, setRenewalsTotalRows] = useState(0);
  const [renewalsSummary, setRenewalsSummary] = useState<RenewalSummary | null>(null);
  const [renewalsMonth, setRenewalsMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [renewalsDaysFilter, setRenewalsDaysFilter] = useState<string>('month');
  const [renewalsPolicyTypeFilter, setRenewalsPolicyTypeFilter] = useState<string>('all');
  const [renewalsCreatedByFilter, setRenewalsCreatedByFilter] = useState<string>('all');
  const [renewalsSearch, setRenewalsSearch] = useState('');
  
  // Renewed Clients State (new tab)
  const [renewedClients, setRenewedClients] = useState<RenewedClient[]>([]);
  const [renewedLoading, setRenewedLoading] = useState(true);
  const [renewedPage, setRenewedPage] = useState(0);
  const [renewedTotalRows, setRenewedTotalRows] = useState(0);
  const [renewedMonth, setRenewedMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [renewedPolicyTypeFilter, setRenewedPolicyTypeFilter] = useState<string>('all');
  const [renewedCreatedByFilter, setRenewedCreatedByFilter] = useState<string>('all');
  const [renewedSearch, setRenewedSearch] = useState('');
  const [expandedRenewedClientId, setExpandedRenewedClientId] = useState<string | null>(null);
  
  // Reference Data
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  
  // Modals
  const [updateStatusOpen, setUpdateStatusOpen] = useState(false);
  const [selectedRenewalClient, setSelectedRenewalClient] = useState<RenewalClient | null>(null);
  const [newStatus, setNewStatus] = useState('');
  const [statusNotes, setStatusNotes] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [sendingSingleSms, setSendingSingleSms] = useState<string | null>(null);
  
  // Renewal Wizard State
  const [wizardOpen, setWizardOpen] = useState(false);
  const [renewalData, setRenewalData] = useState<RenewalData | null>(null);
  const [renewingClientId, setRenewingClientId] = useState<string | null>(null);
  
  // Expandable row for payment activity (created policies)
  const [expandedPolicyId, setExpandedPolicyId] = useState<string | null>(null);
  const [policyPayments, setPolicyPayments] = useState<Record<string, PolicyPaymentActivity[]>>({});
  const [loadingPayments, setLoadingPayments] = useState<string | null>(null);
  
  // Expandable row for client policies (renewals)
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);
  const [clientPolicies, setClientPolicies] = useState<Record<string, RenewalPolicy[]>>({});
  const [loadingClientPolicies, setLoadingClientPolicies] = useState<string | null>(null);

  // Fetch reference data
  useEffect(() => {
    const fetchReferenceData = async () => {
      const [companiesRes, usersRes] = await Promise.all([
        supabase.from('insurance_companies').select('id, name, name_ar').eq('active', true).order('name_ar'),
        supabase.rpc('user_directory_list_active')
      ]);
      
      if (companiesRes.data) setCompanies(companiesRes.data);
      if (usersRes.data) setUsers(usersRes.data);
    };
    fetchReferenceData();
  }, []);

  // Calculate date range based on preset
  const getDateRange = () => {
    const today = new Date();
    let fromDate: string | null = null;
    let toDate: string | null = null;
    
    switch (createdDatePreset) {
      case 'today':
        fromDate = today.toISOString().split('T')[0];
        toDate = fromDate;
        break;
      case 'yesterday': {
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        fromDate = toDate = yesterday.toISOString().split('T')[0];
        break;
      }
      case 'last_7_days': {
        const d7 = new Date(today);
        d7.setDate(today.getDate() - 6);
        fromDate = d7.toISOString().split('T')[0];
        toDate = today.toISOString().split('T')[0];
        break;
      }
      case 'last_30_days': {
        const d30 = new Date(today);
        d30.setDate(today.getDate() - 29);
        fromDate = d30.toISOString().split('T')[0];
        toDate = today.toISOString().split('T')[0];
        break;
      }
      case 'this_week': {
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        fromDate = weekStart.toISOString().split('T')[0];
        toDate = today.toISOString().split('T')[0];
        break;
      }
      case 'last_week': {
        const lastWeekEnd = new Date(today);
        lastWeekEnd.setDate(today.getDate() - today.getDay() - 1);
        const lastWeekStart = new Date(lastWeekEnd);
        lastWeekStart.setDate(lastWeekEnd.getDate() - 6);
        fromDate = lastWeekStart.toISOString().split('T')[0];
        toDate = lastWeekEnd.toISOString().split('T')[0];
        break;
      }
      case 'this_month':
        fromDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
        toDate = today.toISOString().split('T')[0];
        break;
      case 'last_month': {
        const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        fromDate = lastMonth.toISOString().split('T')[0];
        toDate = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().split('T')[0];
        break;
      }
      case 'specific_date':
        fromDate = toDate = createdFromDate || null;
        break;
      case 'custom':
        fromDate = createdFromDate || null;
        toDate = createdToDate || null;
        break;
    }
    
    return { fromDate, toDate };
  };

  // Format date range for display badge
  const formatDateRangeDisplay = () => {
    const { fromDate, toDate } = getDateRange();
    if (!fromDate) return '';
    if (fromDate === toDate) {
      return new Date(fromDate).toLocaleDateString('en-GB');
    }
    return `${new Date(fromDate).toLocaleDateString('en-GB')} - ${new Date(toDate!).toLocaleDateString('en-GB')}`;
  };

  // Fetch created policies
  const fetchCreatedPolicies = async () => {
    setCreatedLoading(true);
    try {
      const { fromDate, toDate } = getDateRange();
      if (!fromDate || !toDate) {
        setCreatedPolicies([]);
        setCreatedTotalRows(0);
        setCreatedLoading(false);
        return;
      }
      
      // Workers can filter by created_by but see all policies in their branch (RLS handles access)
      // Admins can filter by specific user or see all
      const effectiveCreatedBy = createdByFilter !== 'all' ? createdByFilter : null;
      
      const { data, error } = await supabase.rpc('report_created_policies', {
        p_start_date: fromDate,
        p_end_date: toDate,
        p_created_by: effectiveCreatedBy,
        p_policy_type: createdPolicyTypeFilter !== 'all' ? createdPolicyTypeFilter : null,
        p_company_id: createdCompanyFilter !== 'all' ? createdCompanyFilter : null,
        p_search: createdSearch || null,
        p_page_size: PAGE_SIZE,
        p_page: createdPage + 1 // 1-indexed
      });

      if (error) throw error;
      setCreatedPolicies((data as CreatedPolicy[]) || []);
      setCreatedTotalRows((data as CreatedPolicy[])?.[0]?.total_count || 0);
    } catch (error) {
      console.error('Error fetching created policies:', error);
      toast.error('فشل في تحميل البيانات');
    } finally {
      setCreatedLoading(false);
    }
  };

  // Fetch renewals - compute date range from month/days filter
  const getRenewalDateRange = () => {
    if (renewalsDaysFilter === 'month' && renewalsMonth) {
      // Full month
      const [year, month] = renewalsMonth.split('-').map(Number);
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);
      return {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0]
      };
    } else {
      // Next N days from today
      const today = new Date();
      const daysAhead = parseInt(renewalsDaysFilter) || 30;
      const endDate = new Date(today);
      endDate.setDate(today.getDate() + daysAhead);
      return {
        startDate: today.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0]
      };
    }
  };

  const fetchRenewals = async () => {
    setRenewalsLoading(true);
    setRenewalsSummary(null); // Reset summary to prevent stale data
    try {
      const { startDate, endDate } = getRenewalDateRange();
      
      const [renewalsRes, summaryRes] = await Promise.all([
        supabase.rpc('report_renewals', {
          p_start_date: startDate,
          p_end_date: endDate,
          p_policy_type: renewalsPolicyTypeFilter !== 'all' ? renewalsPolicyTypeFilter : null,
          p_created_by: renewalsCreatedByFilter !== 'all' ? renewalsCreatedByFilter : null,
          p_search: renewalsSearch || null,
          p_page_size: PAGE_SIZE,
          p_page: renewalsPage + 1 // 1-indexed
        }),
        // Pass the same filters to summary so numbers always match
        supabase.rpc('report_renewals_summary', {
          p_end_month: renewalsMonth ? `${renewalsMonth}-01` : null,
          p_policy_type: renewalsPolicyTypeFilter !== 'all' ? renewalsPolicyTypeFilter : null,
          p_created_by: renewalsCreatedByFilter !== 'all' ? renewalsCreatedByFilter : null,
          p_search: renewalsSearch || null
        })
      ]);

      if (renewalsRes.error) throw renewalsRes.error;
      // Cast to unknown first to handle type mismatch during types.ts regeneration
      const clientData = (renewalsRes.data as unknown as RenewalClient[]) || [];
      setRenewalClients(clientData);
      setRenewalsTotalRows(clientData[0]?.total_count || 0);
      
      // Handle summary separately to show errors clearly
      if (summaryRes.error) {
        console.error('Error fetching renewals summary:', summaryRes.error);
        toast.error('فشل في تحميل ملخص التجديدات');
      } else if (summaryRes.data && summaryRes.data.length > 0) {
        setRenewalsSummary(summaryRes.data[0] as unknown as RenewalSummary);
      } else {
        // No data returned, set default empty summary
        setRenewalsSummary({
          total_expiring: 0,
          not_contacted: 0,
          sms_sent: 0,
          called: 0,
          renewed: 0,
          not_interested: 0,
          total_packages: 0,
          total_single: 0,
          total_value: 0
        });
      }
    } catch (error) {
      console.error('Error fetching renewals:', error);
      toast.error('فشل في تحميل البيانات');
    } finally {
      setRenewalsLoading(false);
    }
  };

  // "رافضون" sub-tab. Pulls clients from renewal_followups where the
  // agent flagged them as declined_renewal for the month currently in
  // view. The decline_reason is shown in the table so staff can see
  // why the customer bailed without opening the client page.
  const fetchDeclinedFollowups = async () => {
    if (!renewalsMonth) return;
    setDeclinedLoading(true);
    try {
      const { data, error } = await supabase
        .from('renewal_followups' as any)
        .select(`
          client_id, follow_up_month, decline_reason, updated_at,
          client:clients(full_name, phone_number)
        `)
        .eq('follow_up_month', renewalsMonth)
        .eq('status', 'declined_renewal')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      const rows = ((data as any[]) || []).map((r) => ({
        client_id: r.client_id,
        client_name: r.client?.full_name || 'غير معروف',
        client_phone: r.client?.phone_number || null,
        follow_up_month: r.follow_up_month,
        decline_reason: r.decline_reason,
        updated_at: r.updated_at,
      }));
      setDeclinedFollowups(rows);
    } catch (error) {
      console.error('Error fetching declined followups:', error);
      toast.error('فشل في تحميل قائمة الرافضين');
    } finally {
      setDeclinedLoading(false);
    }
  };

  // Fetch client's detailed policies for expansion
  const fetchClientPolicies = async (clientId: string) => {
    if (clientPolicies[clientId]) {
      // Already loaded, toggle
      setExpandedClientId(expandedClientId === clientId ? null : clientId);
      return;
    }
    
    setLoadingClientPolicies(clientId);
    try {
      const { startDate, endDate } = getRenewalDateRange();
      
      const { data, error } = await supabase.rpc('get_client_renewal_policies', {
        p_client_id: clientId,
        p_start_date: startDate,
        p_end_date: endDate
      });
      
      if (error) throw error;
      
      setClientPolicies(prev => ({ ...prev, [clientId]: (data as RenewalPolicy[]) || [] }));
      setExpandedClientId(clientId);
    } catch (error) {
      console.error('Error fetching client policies:', error);
      toast.error('فشل في تحميل المعاملات');
    } finally {
      setLoadingClientPolicies(null);
    }
  };

  // Fetch payment activity for a policy or package
  const fetchPolicyPayments = async (policyId: string, policyIds?: string[] | null) => {
    const cacheKey = policyId;
    if (policyPayments[cacheKey]) {
      // Already loaded
      setExpandedPolicyId(expandedPolicyId === cacheKey ? null : cacheKey);
      return;
    }
    
    setLoadingPayments(policyId);
    try {
      // For packages, fetch payments for all policies in the package
      const idsToQuery = policyIds && policyIds.length > 0 ? policyIds : [policyId];
      
      const { data, error } = await supabase
        .from('policy_payments')
        .select('id, amount, payment_date, payment_type, created_at')
        .in('policy_id', idsToQuery)
        .order('payment_date', { ascending: false });
      
      if (error) throw error;
      
      setPolicyPayments(prev => ({ ...prev, [cacheKey]: data || [] }));
      setExpandedPolicyId(cacheKey);
    } catch (error) {
      console.error('Error fetching payments:', error);
      toast.error('فشل في تحميل الدفعات');
    } finally {
      setLoadingPayments(null);
    }
  };

  const paymentTypeLabels: Record<string, string> = {
    cash: 'نقداً',
    cheque: 'شيك',
    credit: 'بطاقة',
    bank_transfer: 'تحويل بنكي',
    tranzila: 'ترانزيلا',
    customer_cheque: 'شيك عميل',
  };

  // Refresh data based on active tab
  useEffect(() => {
    if (activeTab === 'created') {
      fetchCreatedPolicies();
    }
  }, [activeTab, createdPage, createdDatePreset, createdFromDate, createdToDate, createdByFilter, createdPolicyTypeFilter, createdCompanyFilter, createdSearch]);

  useEffect(() => {
    if (activeTab === 'renewals') {
      fetchRenewals();
    }
  }, [activeTab, renewalsPage, renewalsMonth, renewalsDaysFilter, renewalsPolicyTypeFilter, renewalsCreatedByFilter, renewalsSearch]);

  // Sub-tab data fetchers — declined list comes from renewal_followups,
  // the tam-altajdid list reuses fetchRenewedClients with the renewals
  // tab's month filter so the user doesn't have to retype it.
  useEffect(() => {
    if (activeTab !== 'renewals') return;
    if (renewalSubTab === 'declined') {
      fetchDeclinedFollowups();
    } else if (renewalSubTab === 'renewed') {
      // Align the inner "tam altajdid" view with the renewals month so
      // the two sub-tabs reconcile. We call fetchRenewedClients via the
      // same month filter used by the pending list.
      if (renewalsMonth) {
        // Keep the existing renewedMonth in state too, so the top-level
        // "tam altajdid" tab stays in sync if the user jumps there.
        setRenewedMonth(renewalsMonth);
      }
      fetchRenewedClients();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, renewalSubTab, renewalsMonth]);

  // Fetch renewed clients
  const fetchRenewedClients = async () => {
    setRenewedLoading(true);
    try {
      const { data, error } = await supabase.rpc('report_renewed_clients', {
        p_end_month: renewedMonth ? `${renewedMonth}-01` : null,
        p_policy_type: renewedPolicyTypeFilter !== 'all' ? renewedPolicyTypeFilter : null,
        p_created_by: renewedCreatedByFilter !== 'all' ? renewedCreatedByFilter : null,
        p_search: renewedSearch || null,
        p_limit: PAGE_SIZE,
        p_offset: renewedPage * PAGE_SIZE
      });

      if (error) throw error;
      const clientData = (data as unknown as RenewedClient[]) || [];
      setRenewedClients(clientData);
      setRenewedTotalRows(clientData[0]?.total_count || 0);
    } catch (error) {
      console.error('Error fetching renewed clients:', error);
      toast.error('فشل في تحميل البيانات');
    } finally {
      setRenewedLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'renewed') {
      fetchRenewedClients();
    }
  }, [activeTab, renewedPage, renewedMonth, renewedPolicyTypeFilter, renewedCreatedByFilter, renewedSearch]);

  // Update renewal status for all policies of a client
  const handleUpdateStatus = async () => {
    if (!selectedRenewalClient || !newStatus) return;
    
    setUpdatingStatus(true);
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      
      // Update tracking for ALL policies of this client
      const policyIds = selectedRenewalClient.policy_ids || [];
      
      for (const policyId of policyIds) {
        const { error } = await supabase
          .from('policy_renewal_tracking')
          .upsert({
            policy_id: policyId,
            renewal_status: newStatus,
            notes: statusNotes || null,
            last_contacted_at: ['called', 'renewed', 'not_interested'].includes(newStatus) ? new Date().toISOString() : null,
            contacted_by: userId
          }, { onConflict: 'policy_id' });

        if (error) throw error;
      }
      
      toast.success(`تم تحديث الحالة لـ ${policyIds.length} معاملة`);
      setUpdateStatusOpen(false);
      setSelectedRenewalClient(null);
      setNewStatus('');
      setStatusNotes('');
      // Clear cached policies
      setClientPolicies({});
      setExpandedClientId(null);
      fetchRenewals();
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('فشل في تحديث الحالة');
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Generate PDF
  const handleGeneratePdf = async () => {
    setGeneratingPdf(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-renewals-report', {
        body: { 
          month: renewalsMonth,
          days_filter: renewalsDaysFilter !== 'month' ? parseInt(renewalsDaysFilter) : null,
          policy_type: renewalsPolicyTypeFilter !== 'all' ? renewalsPolicyTypeFilter : null
        }
      });

      if (error) throw error;
      
      if (data?.url) {
        window.open(data.url, '_blank');
        toast.success('تم إنشاء التقرير');
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('فشل في إنشاء التقرير');
    } finally {
      setGeneratingPdf(false);
    }
  };

  // Send bulk SMS reminders
  const handleSendReminders = async () => {
    setSendingReminders(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-renewal-reminders', {
        body: { 
          month: renewalsMonth,
          days_remaining: renewalsDaysFilter !== 'month' ? parseInt(renewalsDaysFilter) : 30
        }
      });

      if (error) throw error;
      
      const remaining = data?.remaining || 0;
      const sentSoFar = data?.sent_count || 0;
      if (remaining > 0) {
        toast.success(`تم إرسال ${sentSoFar} رسالة حتى الآن، يتم إرسال ${remaining} رسالة إضافية تلقائياً...`);
      } else {
        toast.success(`تم إرسال ${sentSoFar} رسالة تذكير`);
      }
      fetchRenewals();
    } catch (error: any) {
      console.error('Error sending reminders:', error);
      const msg = await extractFunctionErrorMessage(error);
      toast.error(msg || 'فشل في إرسال التذكيرات');
    } finally {
      setSendingReminders(false);
    }
  };

  // Send single renewal reminder SMS for ALL client's policies
  const handleSendSingleSms = async (client: RenewalClient) => {
    if (!client.client_phone) {
      toast.error('رقم هاتف العميل مطلوب');
      return;
    }

    setSendingSingleSms(client.client_id);
    try {
      // Build message with all policy types
      const typesText = (client.policy_types || []).map(t => policyTypeLabels[t] || t).join(' و ');
      const endDate = formatDate(client.earliest_end_date);
      
      const message = `مرحباً ${client.client_name}، نذكرك بأن تأمين (${typesText}) سينتهي بتاريخ ${endDate}. يرجى التواصل معنا أو زيارة المكتب للتجديد.`;

      const { error } = await supabase.functions.invoke('send-sms', {
        body: { phone: client.client_phone, message }
      });

      if (error) throw error;

      // Update renewal tracking for ALL policies
      const policyIds = client.policy_ids || [];
      for (const policyId of policyIds) {
        await supabase.from('policy_renewal_tracking').upsert({
          policy_id: policyId,
          renewal_status: 'sms_sent',
          reminder_sent_at: new Date().toISOString()
        }, { onConflict: 'policy_id' });
      }

      toast.success(`تم إرسال التذكير لـ ${policyIds.length} معاملة`);
      // Clear cached policies
      setClientPolicies({});
      setExpandedClientId(null);
      fetchRenewals();
    } catch (error: any) {
      console.error('Error sending SMS:', error);
      const msg = await extractFunctionErrorMessage(error);
      toast.error(msg || 'فشل في إرسال الرسالة');
    } finally {
      setSendingSingleSms(null);
    }
  };

  // Handle renew from report - opens PolicyWizard with pre-filled data
  const handleRenewFromReport = async (client: RenewalClient) => {
    setRenewingClientId(client.client_id);
    
    try {
      // Fetch client's policies for renewal
      const { startDate, endDate } = getRenewalDateRange();
      const { data: policies, error } = await supabase.rpc('get_client_renewal_policies', {
        p_client_id: client.client_id,
        p_start_date: startDate,
        p_end_date: endDate
      });
      
      if (error) throw error;
      
      if (!policies?.length) {
        toast.error('لم يتم العثور على المعاملات');
        return;
      }
      
      // Determine main policy (THIRD_FULL or ELZAMI takes priority)
      const mainPolicy = policies.find((p: RenewalPolicy) => 
        p.policy_type_parent === 'THIRD_FULL' || p.policy_type_parent === 'ELZAMI'
      ) || policies[0];
      
      // Build addons from other policies
      const addons = policies
        .filter((p: any) => p.id !== (mainPolicy as any).id)
        .map((p: any) => ({
          type: p.policy_type_parent.toLowerCase() as 'elzami' | 'third_full' | 'road_service' | 'accident_fee_exemption',
          companyId: p.company_id || '',
          insurancePrice: p.insurance_price,
          policyTypeChild: p.policy_type_child || undefined,
        }));
      
      // Prepare renewal data
      const mp = mainPolicy as any;
      const renewal: RenewalData = {
        clientId: client.client_id,
        carId: mp.car_id,
        categorySlug: 'THIRD_FULL', // For cars
        policyTypeParent: mp.policy_type_parent,
        policyTypeChild: mp.policy_type_child || undefined,
        companyId: mp.company_id || '',
        insurancePrice: mp.insurance_price,
        packageAddons: addons.length > 0 ? addons : undefined,
        originalEndDate: mp.end_date,
      };
      
      setRenewalData(renewal);
      setWizardOpen(true);
    } catch (error) {
      console.error('Error preparing renewal:', error);
      toast.error('فشل في تحضير التجديد');
    } finally {
      setRenewingClientId(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-GB');
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return `${date.toLocaleDateString('en-GB')} ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  };

  const createdTotalPages = Math.ceil(createdTotalRows / PAGE_SIZE);
  const renewalsTotalPages = Math.ceil(renewalsTotalRows / PAGE_SIZE);
  const renewedTotalPages = Math.ceil(renewedTotalRows / PAGE_SIZE);

  return (
    <MainLayout>
      <Helmet>
        <title>تقارير المعاملات | ثقة للتأمين</title>
      </Helmet>

      <Header
        title="تقارير المعاملات والتجديدات"
        subtitle="متابعة المعاملات المنشأة والتجديدات"
      />

      <div className="p-6 space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="created" className="gap-2">
              <FileText className="h-4 w-4" />
              المعاملات المنشأة
            </TabsTrigger>
            <TabsTrigger value="renewals" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              التجديدات
            </TabsTrigger>
            <TabsTrigger value="renewed" className="gap-2">
              <CheckCircle className="h-4 w-4" />
              تم التجديد
            </TabsTrigger>
          </TabsList>

          {/* Created Policies Tab */}
          <TabsContent value="created" className="space-y-4 mt-6">
            {/* Filters */}
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Select value={createdDatePreset} onValueChange={(v) => { setCreatedDatePreset(v); setCreatedPage(0); }}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">اليوم</SelectItem>
                    <SelectItem value="yesterday">أمس</SelectItem>
                    <SelectItem value="last_7_days">آخر 7 أيام</SelectItem>
                    <SelectItem value="last_30_days">آخر 30 يوم</SelectItem>
                    <SelectItem value="this_week">هذا الأسبوع</SelectItem>
                    <SelectItem value="last_week">الأسبوع الماضي</SelectItem>
                    <SelectItem value="this_month">هذا الشهر</SelectItem>
                    <SelectItem value="last_month">الشهر الماضي</SelectItem>
                    <SelectItem value="specific_date">تاريخ محدد</SelectItem>
                    <SelectItem value="custom">نطاق مخصص</SelectItem>
                  </SelectContent>
                </Select>

                {/* Single date picker for specific date */}
                {createdDatePreset === 'specific_date' && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">التاريخ:</span>
                    <ArabicDatePicker
                      value={createdFromDate}
                      onChange={(date) => {
                        setCreatedFromDate(date);
                        setCreatedToDate(date);
                      }}
                    />
                  </div>
                )}

                {/* Two date pickers for custom range */}
                {createdDatePreset === 'custom' && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">من:</span>
                    <ArabicDatePicker
                      value={createdFromDate}
                      onChange={(date) => setCreatedFromDate(date)}
                    />
                    <span className="text-sm text-muted-foreground">إلى:</span>
                    <ArabicDatePicker
                      value={createdToDate}
                      onChange={(date) => setCreatedToDate(date)}
                    />
                  </div>
                )}

                {/* Date range display badge for preset selections */}
                {createdDatePreset !== 'custom' && createdDatePreset !== 'specific_date' && formatDateRangeDisplay() && (
                  <Badge variant="outline" className="px-2 py-1 font-mono text-xs h-10 flex items-center">
                    <Calendar className="h-3 w-3 ml-1" />
                    {formatDateRangeDisplay()}
                  </Badge>
                )}

                {/* Created By filter - Admin only */}
                {isAdmin && (
                  <Select value={createdByFilter} onValueChange={(v) => { setCreatedByFilter(v); setCreatedPage(0); }}>
                    <SelectTrigger className="w-[160px]">
                      <SelectValue placeholder="أنشأه" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">كل المستخدمين</SelectItem>
                      {users.map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.display_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <Select value={createdPolicyTypeFilter} onValueChange={(v) => { setCreatedPolicyTypeFilter(v); setCreatedPage(0); }}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="النوع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الأنواع</SelectItem>
                    {Object.entries(policyTypeFilterLabels).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={createdCompanyFilter} onValueChange={(v) => { setCreatedCompanyFilter(v); setCreatedPage(0); }}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="الشركة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الشركات</SelectItem>
                    {companies.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name_ar || c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث بالاسم، الهاتف، الهوية، رقم الملف، رقم السيارة..."
                    value={createdSearch}
                    onChange={(e) => { setCreatedSearch(e.target.value); setCreatedPage(0); }}
                    className="pr-10"
                  />
                </div>
              </div>
            </Card>

            {/* Table */}
            <Card className="overflow-hidden">
              {createdLoading ? (
                <div className="p-4 space-y-2">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : createdPolicies.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
                  <p className="text-muted-foreground">لا توجد معاملات</p>
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="w-10"></TableHead>
                        <TableHead className="text-right">تاريخ الإنشاء</TableHead>
                        <TableHead className="text-right">أنشأه</TableHead>
                        <TableHead className="text-right">العميل</TableHead>
                        <TableHead className="text-right">الهاتف</TableHead>
                        <TableHead className="text-right">السيارة</TableHead>
                        <TableHead className="text-right">النوع</TableHead>
                        <TableHead className="text-right">الشركة</TableHead>
                        <TableHead className="text-right">الفترة</TableHead>
                        <TableHead className="text-right">السعر</TableHead>
                        <TableHead className="text-right">الحالة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {createdPolicies.map(policy => (
                        <React.Fragment key={policy.id}>
                          <TableRow 
                            className={cn(
                              "hover:bg-muted/30 cursor-pointer",
                              expandedPolicyId === policy.id && "bg-muted/40"
                            )}
                            onClick={() => fetchPolicyPayments(policy.id, policy.package_policy_ids)}
                          >
                            <TableCell className="w-10">
                              {loadingPayments === policy.id ? (
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              ) : (
                                <ChevronDown 
                                  className={cn(
                                    "h-4 w-4 text-muted-foreground transition-transform",
                                    expandedPolicyId === policy.id && "rotate-180"
                                  )} 
                                />
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{formatDateTime(policy.created_at)}</TableCell>
                            <TableCell>
                              <div>
                                <p className="font-medium text-sm">{policy.created_by_name || '-'}</p>
                                {policy.branch_name && (
                                  <p className="text-xs text-muted-foreground">{policy.branch_name}</p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div>
                                <p className="font-medium">{policy.client_name}</p>
                                {policy.client_file_number && (
                                  <p className="text-xs text-muted-foreground">{policy.client_file_number}</p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <ClickablePhone phone={policy.client_phone} />
                            </TableCell>
                            <TableCell className="font-mono">{policy.car_number || '-'}</TableCell>
                            <TableCell>
                              {policy.is_package ? (
                                <div className="flex flex-col gap-1">
                                  <Badge variant="default" className="text-xs gap-1 bg-primary">
                                    <Package className="h-3 w-3" />
                                    باقة ({policy.package_count})
                                  </Badge>
                                  <div className="text-[10px] text-muted-foreground leading-relaxed">
                                    {(() => {
                                      const serviceTypes = ['ROAD_SERVICE', 'ACCIDENT_FEE_EXEMPTION'];
                                      const mainTypes = (policy.package_types || []).filter(t => !serviceTypes.includes(t));
                                      const hasServices = (policy.package_types || []).some(t => serviceTypes.includes(t));
                                      const serviceNames = policy.package_service_names?.filter(Boolean) || [];
                                      
                                      const parts = mainTypes.map(t => policyTypeLabels[t] || t);
                                      
                                      if (hasServices) {
                                        if (serviceNames.length > 0) {
                                          parts.push(`خدمات الطريق (${serviceNames.join(' + ')})`);
                                        } else {
                                          // fallback to generic labels
                                          (policy.package_types || []).filter(t => serviceTypes.includes(t)).forEach(t => {
                                            parts.push(policyTypeLabels[t] || t);
                                          });
                                        }
                                      }
                                      
                                      return parts.join(' + ');
                                    })()}
                                  </div>
                                </div>
                              ) : (
                                <Badge variant="secondary" className="text-xs">
                                {getInsuranceTypeLabel(policy.policy_type_parent as any, policy.policy_type_child as any)}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {policy.is_package && policy.package_companies?.length > 0 ? (
                                <div className="flex flex-col gap-0.5">
                                  {policy.package_companies.filter(Boolean).map((name: string, i: number) => (
                                    <span key={i} className="text-sm">{name}</span>
                                  ))}
                                </div>
                              ) : (
                                policy.company_name_ar || policy.company_name || '-'
                              )}
                            </TableCell>
                            <TableCell className="text-xs">
                              {formatDate(policy.start_date)} - {formatDate(policy.end_date)}
                            </TableCell>
                            <TableCell className="font-bold">₪{policy.insurance_price.toLocaleString()}</TableCell>
                            <TableCell>
                              <Badge 
                                variant={policy.payment_status === 'paid' ? 'success' : policy.payment_status === 'partial' ? 'warning' : 'destructive'}
                                className="gap-1"
                              >
                                {policy.payment_status === 'paid' && <CheckCircle className="h-3 w-3" />}
                                {policy.payment_status === 'partial' && <Clock className="h-3 w-3" />}
                                {policy.payment_status === 'unpaid' && <AlertCircle className="h-3 w-3" />}
                                {policy.payment_status === 'paid' ? 'مدفوع' : policy.payment_status === 'partial' ? `باقي ₪${policy.remaining.toLocaleString()}` : 'غير مدفوع'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                          
                          {/* Expanded Payment Activity Row */}
                          {expandedPolicyId === policy.id && policyPayments[policy.id] && (
                            <TableRow key={`${policy.id}-payments`} className="bg-muted/20">
                              <TableCell colSpan={11} className="p-0">
                                <div className="px-6 py-4 border-t border-dashed">
                                  <div className="flex items-center gap-2 mb-3">
                                    <CreditCard className="h-4 w-4 text-primary" />
                                    <span className="font-medium text-sm">سجل الدفعات</span>
                                    <Badge variant="outline" className="text-xs">
                                      {policyPayments[policy.id].length} دفعة
                                    </Badge>
                                  </div>
                                  
                                  {policyPayments[policy.id].length === 0 ? (
                                    <p className="text-sm text-muted-foreground py-2">لا توجد دفعات مسجلة</p>
                                  ) : (
                                    <div className="space-y-2">
                                      {policyPayments[policy.id].map((payment, idx) => (
                                        <div 
                                          key={payment.id} 
                                          className="flex items-center gap-4 p-3 rounded-lg bg-background border text-sm"
                                        >
                                          <div className={cn(
                                            "rounded-full p-2",
                                            payment.payment_type === 'cash' ? "bg-success/10 text-success" :
                                            payment.payment_type === 'cheque' || payment.payment_type === 'customer_cheque' ? "bg-warning/10 text-warning" :
                                            "bg-primary/10 text-primary"
                                          )}>
                                            {payment.payment_type === 'cash' ? (
                                              <Banknote className="h-4 w-4" />
                                            ) : (
                                              <CreditCard className="h-4 w-4" />
                                            )}
                                          </div>
                                          <div className="flex-1">
                                            <p className="font-medium">
                                              ₪{payment.amount.toLocaleString()}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                              {paymentTypeLabels[payment.payment_type] || payment.payment_type}
                                            </p>
                                          </div>
                                          <div className="text-left">
                                            <p className="font-mono text-xs">{formatDate(payment.payment_date)}</p>
                                            <p className="text-xs text-muted-foreground">
                                              أنشئت: {formatDateTime(payment.created_at)}
                                            </p>
                                          </div>
                                        </div>
                                      ))}
                                      
                                      {/* Summary */}
                                      <div className="flex items-center justify-between pt-2 border-t mt-2">
                                        <span className="text-sm font-medium">المجموع المدفوع:</span>
                                        <span className="font-bold text-success">
                                          ₪{policyPayments[policy.id].reduce((sum, p) => sum + p.amount, 0).toLocaleString()}
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      ))}
                    </TableBody>
                  </Table>

                  {/* Pagination */}
                  <div className="flex items-center justify-between p-4 border-t">
                    <p className="text-sm text-muted-foreground">
                      إجمالي: {createdTotalRows} معاملة/باقة
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCreatedPage(p => Math.max(0, p - 1))}
                        disabled={createdPage === 0}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <span className="text-sm">
                        {createdPage + 1} / {createdTotalPages || 1}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCreatedPage(p => p + 1)}
                        disabled={createdPage >= createdTotalPages - 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </Card>
          </TabsContent>

          {/* Renewals Tab */}
          <TabsContent value="renewals" className="space-y-4 mt-6">
            {/* Enhanced Summary Cards - with Skeleton for loading */}
            {renewalsLoading && !renewalsSummary ? (
              <div className="space-y-4">
                {/* Main Stats Row - 3 Large Cards Skeleton */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[1, 2, 3].map((i) => (
                    <Card key={i} className="p-6">
                      <div className="flex items-center justify-between">
                        <div className="space-y-3 flex-1">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-10 w-24" />
                          <Skeleton className="h-3 w-28" />
                        </div>
                        <Skeleton className="h-12 w-12 rounded-full" />
                      </div>
                    </Card>
                  ))}
                </div>
                {/* Secondary Stats Row - 5 Small Cards Skeleton */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Card key={i} className="p-4 text-center">
                      <Skeleton className="h-3 w-20 mx-auto mb-2" />
                      <Skeleton className="h-8 w-12 mx-auto" />
                    </Card>
                  ))}
                </div>
              </div>
            ) : renewalsSummary && (
              <div className="space-y-4">
                {/* Main Stats Row - 3 Large Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* إجمالي بحاجة للتجديد */}
                  <Card className="p-6 bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">إجمالي بحاجة للتجديد</p>
                        <p className="text-4xl font-bold text-primary mt-1">{renewalsSummary.total_expiring}</p>
                        <p className="text-xs text-muted-foreground mt-2">
                          عميل • ₪{(renewalsSummary.total_value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                      <RefreshCw className="h-12 w-12 text-primary/30" />
                    </div>
                  </Card>

                  {/* لم يتم التواصل - أولوية عالية */}
                  <Card className="p-6 bg-gradient-to-br from-amber-500/10 to-amber-500/5 border-amber-500/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">لم يتم التواصل</p>
                        <p className="text-4xl font-bold text-amber-600 mt-1">{renewalsSummary.not_contacted}</p>
                        <p className="text-xs text-amber-600/70 mt-2">بحاجة لاتخاذ إجراء</p>
                      </div>
                      <AlertCircle className="h-12 w-12 text-amber-500/30" />
                    </div>
                  </Card>

                  {/* تم التجديد */}
                  <Card className="p-6 bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-500/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">تم التجديد</p>
                        <p className="text-4xl font-bold text-green-600 mt-1">{renewalsSummary.renewed}</p>
                        <p className="text-xs text-green-600/70 mt-2">
                          {renewalsSummary.total_expiring > 0 
                            ? `${Math.round((renewalsSummary.renewed / renewalsSummary.total_expiring) * 100)}% نسبة التحويل`
                            : '0% نسبة التحويل'}
                        </p>
                      </div>
                      <CheckCircle className="h-12 w-12 text-green-500/30" />
                    </div>
                  </Card>
                </div>

                {/* Secondary Stats Row - 5 Small Cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <Card className="p-4 text-center">
                    <p className="text-xs text-muted-foreground">تم إرسال SMS</p>
                    <p className="text-2xl font-bold text-blue-600">{renewalsSummary.sms_sent}</p>
                  </Card>
                  <Card className="p-4 text-center">
                    <p className="text-xs text-muted-foreground">تم الاتصال</p>
                    <p className="text-2xl font-bold text-amber-600">{renewalsSummary.called}</p>
                  </Card>
                  <Card className="p-4 text-center">
                    <p className="text-xs text-muted-foreground">غير مهتم</p>
                    <p className="text-2xl font-bold text-red-600">{renewalsSummary.not_interested}</p>
                  </Card>
                  <Card className="p-4 text-center">
                    <p className="text-xs text-muted-foreground">باقات</p>
                    <p className="text-2xl font-bold text-purple-600">{renewalsSummary.total_packages || 0}</p>
                  </Card>
                  <Card className="p-4 text-center">
                    <p className="text-xs text-muted-foreground">معاملات مفردة</p>
                    <p className="text-2xl font-bold text-slate-600">{renewalsSummary.total_single || 0}</p>
                  </Card>
                </div>
              </div>
            )}

            {/* Filters */}
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground shrink-0">الشهر:</span>
                  <ArabicDatePicker
                    value={renewalsMonth ? `${renewalsMonth}-01` : ''}
                    onChange={(date) => {
                      setRenewalsMonth(date ? date.slice(0, 7) : '');
                      setRenewalsPage(0);
                    }}
                    placeholder="اختر الشهر"
                    compact
                  />
                </div>

                <Select value={renewalsDaysFilter} onValueChange={(v) => { setRenewalsDaysFilter(v); setRenewalsPage(0); }}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">كل الشهر</SelectItem>
                    <SelectItem value="7">خلال 7 أيام</SelectItem>
                    <SelectItem value="14">خلال 14 يوم</SelectItem>
                    <SelectItem value="30">خلال 30 يوم</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={renewalsPolicyTypeFilter} onValueChange={(v) => { setRenewalsPolicyTypeFilter(v); setRenewalsPage(0); }}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="النوع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الأنواع</SelectItem>
                    {Object.entries(policyTypeFilterLabels).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={renewalsCreatedByFilter} onValueChange={(v) => { setRenewalsCreatedByFilter(v); setRenewalsPage(0); }}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="أنشأه" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل المستخدمين</SelectItem>
                    {users.map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث..."
                    value={renewalsSearch}
                    onChange={(e) => { setRenewalsSearch(e.target.value); setRenewalsPage(0); }}
                    className="pr-10"
                  />
                </div>

                <div className="flex gap-2 mr-auto">
                  {/* مساعد التجديد — guided walkthrough of every client
                      whose policies expire this month, posting to the
                      renewal_followups table. */}
                  <Button
                    onClick={() => setRenewalAssistantOpen(true)}
                    disabled={!agentId || renewalClients.length === 0}
                  >
                    <Users className="h-4 w-4 ml-2" />
                    مساعد التجديد
                  </Button>
                  {/* PDF للمسؤولين فقط */}
                  {isAdmin && (
                    <Button variant="outline" onClick={handleGeneratePdf} disabled={generatingPdf}>
                      {generatingPdf ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Download className="h-4 w-4 ml-2" />}
                      تصدير PDF
                    </Button>
                  )}
                  {/* SMS للجميع */}
                  <Button variant="outline" onClick={handleSendReminders} disabled={sendingReminders || renewalClients.length === 0}>
                    {sendingReminders ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Send className="h-4 w-4 ml-2" />}
                    إرسال تذكيرات SMS {renewalClients.length > 0 && `(${renewalsTotalRows})`}
                  </Button>
                </div>
              </div>
            </Card>

            {/* Sub-tabs: معلقون / رافضون / تم التجديد. The existing
                pending list stays as "معلقون" — we only wrap it so the
                user can flip between three views without leaving the
                Renewals top-tab. */}
            <Tabs value={renewalSubTab} onValueChange={(v) => setRenewalSubTab(v as 'pending' | 'declined' | 'renewed')}>
              <TabsList className="grid w-full max-w-lg grid-cols-3">
                <TabsTrigger value="pending" className="gap-2">
                  <Clock className="h-4 w-4" />
                  معلقون
                </TabsTrigger>
                <TabsTrigger value="declined" className="gap-2">
                  <XCircle className="h-4 w-4" />
                  رافضون
                </TabsTrigger>
                <TabsTrigger value="renewed" className="gap-2">
                  <CheckCircle className="h-4 w-4" />
                  تم التجديد
                </TabsTrigger>
              </TabsList>

              <TabsContent value="pending" className="mt-4">
            {/* Table - Grouped by Customer */}
            <Card className="overflow-hidden">
              {renewalsLoading ? (
                <div className="p-4 space-y-2">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : renewalClients.length === 0 ? (
                <div className="text-center py-12">
                  <Calendar className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
                  <p className="text-muted-foreground">لا يوجد عملاء لديهم معاملات منتهية في هذه الفترة</p>
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="w-10"></TableHead>
                        <TableHead className="text-right">العميل</TableHead>
                        <TableHead className="text-right">الهاتف</TableHead>
                        <TableHead className="text-right">المعاملات</TableHead>
                        <TableHead className="text-right">السيارات</TableHead>
                        <TableHead className="text-right">الأنواع</TableHead>
                        <TableHead className="text-right">أقرب انتهاء</TableHead>
                        <TableHead className="text-right">الأيام المتبقية</TableHead>
                        <TableHead className="text-right">إجمالي السعر</TableHead>
                        <TableHead className="text-right">الحالة</TableHead>
                        <TableHead className="text-right">ملاحظات</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {renewalClients.map(client => (
                        <React.Fragment key={client.client_id}>
                          <TableRow 
                            className={cn(
                              "hover:bg-muted/30 cursor-pointer",
                              expandedClientId === client.client_id && "bg-muted/40"
                            )}
                            onClick={() => fetchClientPolicies(client.client_id)}
                          >
                            <TableCell className="w-10">
                              {loadingClientPolicies === client.client_id ? (
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              ) : (
                                <ChevronDown 
                                  className={cn(
                                    "h-4 w-4 text-muted-foreground transition-transform",
                                    expandedClientId === client.client_id && "rotate-180"
                                  )} 
                                />
                              )}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <div>
                                <button
                                  onClick={() => navigate(`/clients/${client.client_id}`, { 
                                    state: { from: '/reports/policies', tab: 'renewals' }
                                  })}
                                  className="font-medium hover:text-primary hover:underline transition-colors text-right"
                                >
                                  {client.client_name}
                                </button>
                                {client.client_file_number && (
                                  <p className="text-xs text-muted-foreground">{client.client_file_number}</p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <ClickablePhone phone={client.client_phone} />
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-bold">
                                {client.policies_count} معاملة
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {client.car_numbers?.slice(0, 3).map((num, i) => (
                                  <span key={i} className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                                    {num}
                                  </span>
                                ))}
                                {(client.car_numbers?.length || 0) > 3 && (
                                  <span className="text-xs text-muted-foreground">+{client.car_numbers!.length - 3}</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {client.policy_types?.map(type => (
                                  <Badge key={type} variant="secondary" className="text-xs">
                                    {getInsuranceTypeLabel(type as any, null)}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono">{formatDate(client.earliest_end_date)}</TableCell>
                            <TableCell>
                              <Badge variant={client.days_remaining <= 7 ? 'destructive' : client.days_remaining <= 14 ? 'warning' : 'secondary'}>
                                {client.days_remaining} يوم
                              </Badge>
                            </TableCell>
                            <TableCell className="font-bold">₪{client.total_insurance_price.toLocaleString()}</TableCell>
                            <TableCell>
                              <Badge className={cn('border', renewalStatusColors[client.worst_renewal_status])}>
                                {renewalStatusLabels[client.worst_renewal_status]}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-[150px] truncate text-xs text-muted-foreground">
                              {client.renewal_notes || '-'}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => {
                                    setSelectedRenewalClient(client);
                                    setNewStatus(client.worst_renewal_status);
                                    setStatusNotes(client.renewal_notes || '');
                                    setUpdateStatusOpen(true);
                                  }}>
                                    <MessageSquare className="h-4 w-4 ml-2" />
                                    تحديث الحالة ({client.policies_count} معاملة)
                                  </DropdownMenuItem>
                                  {client.client_phone && (
                                    <>
                                      <DropdownMenuItem 
                                        onClick={() => handleSendSingleSms(client)}
                                        disabled={sendingSingleSms === client.client_id}
                                      >
                                        {sendingSingleSms === client.client_id ? (
                                          <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                                        ) : (
                                          <Send className="h-4 w-4 ml-2" />
                                        )}
                                        إرسال تذكير SMS ({client.policies_count} معاملة)
                                      </DropdownMenuItem>
                                      <DropdownMenuItem asChild>
                                        <a href={`tel:${client.client_phone}`}>
                                          <Phone className="h-4 w-4 ml-2" />
                                          اتصال
                                        </a>
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem 
                                    onClick={() => handleRenewFromReport(client)}
                                    disabled={renewingClientId === client.client_id}
                                  >
                                    {renewingClientId === client.client_id ? (
                                      <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                                    ) : (
                                      <RefreshCw className="h-4 w-4 ml-2" />
                                    )}
                                    تجديد ({client.policies_count} معاملة)
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                          
                          {/* Expanded Policies Row */}
                          {expandedClientId === client.client_id && clientPolicies[client.client_id] && (
                            <TableRow key={`${client.client_id}-policies`} className="bg-muted/20">
                              <TableCell colSpan={12} className="p-0">
                                <div className="px-6 py-4 border-t border-dashed">
                                  <div className="flex items-center gap-2 mb-3">
                                    <FileText className="h-4 w-4 text-primary" />
                                    <span className="font-medium text-sm">المعاملات المنتهية</span>
                                    <Badge variant="outline" className="text-xs">
                                      {clientPolicies[client.client_id].length} معاملة
                                    </Badge>
                                  </div>
                                  
                                  <div className="space-y-2">
                                    {clientPolicies[client.client_id].map((policy) => (
                                      <div 
                                        key={policy.id} 
                                        className="flex items-center gap-4 p-3 rounded-lg bg-background border text-sm"
                                      >
                                        <div className="flex-1 grid grid-cols-6 gap-4">
                                          <div>
                                            <p className="text-xs text-muted-foreground">السيارة</p>
                                            <p className="font-mono">{policy.car_number || '-'}</p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-muted-foreground">النوع</p>
                                            <Badge variant="secondary" className="text-xs">
                                              {getInsuranceTypeLabel(policy.policy_type_parent as any, policy.policy_type_child as any)}
                                            </Badge>
                                          </div>
                                          <div>
                                            <p className="text-xs text-muted-foreground">الشركة</p>
                                            <p>{policy.company_name_ar || policy.company_name || '-'}</p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-muted-foreground">تاريخ الانتهاء</p>
                                            <p className="font-mono">{formatDate(policy.end_date)}</p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-muted-foreground">السعر</p>
                                            <p className="font-bold">₪{policy.insurance_price.toLocaleString()}</p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-muted-foreground">الحالة</p>
                                            <Badge className={cn('border text-xs', renewalStatusColors[policy.renewal_status])}>
                                              {renewalStatusLabels[policy.renewal_status]}
                                            </Badge>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      ))}
                    </TableBody>
                  </Table>

                  {/* Pagination */}
                  <div className="flex items-center justify-between p-4 border-t">
                    <p className="text-sm text-muted-foreground">
                      إجمالي: {renewalsTotalRows} عميل
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRenewalsPage(p => Math.max(0, p - 1))}
                        disabled={renewalsPage === 0}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <span className="text-sm">
                        {renewalsPage + 1} / {renewalsTotalPages || 1}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRenewalsPage(p => p + 1)}
                        disabled={renewalsPage >= renewalsTotalPages - 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </Card>
              </TabsContent>

              {/* رافضون — clients whose follow-up status was flipped to
                  'declined_renewal' for the renewals-month in view. */}
              <TabsContent value="declined" className="mt-4">
                <Card className="overflow-hidden">
                  {declinedLoading ? (
                    <div className="p-4 space-y-2">
                      {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                    </div>
                  ) : declinedFollowups.length === 0 ? (
                    <div className="text-center py-12">
                      <XCircle className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
                      <p className="text-muted-foreground">لا يوجد عملاء مسجلين كرافضي التجديد لهذا الشهر</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="text-right">العميل</TableHead>
                          <TableHead className="text-right">الهاتف</TableHead>
                          <TableHead className="text-right">سبب الرفض</TableHead>
                          <TableHead className="text-right">تاريخ التسجيل</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {declinedFollowups.map((row) => (
                          <TableRow key={`${row.client_id}-${row.follow_up_month}`} className="hover:bg-muted/30">
                            <TableCell>
                              <button
                                onClick={() => navigate(`/clients/${row.client_id}`, {
                                  state: { from: '/reports/policies', tab: 'renewals' },
                                })}
                                className="font-medium hover:text-primary hover:underline transition-colors text-right"
                              >
                                {row.client_name}
                              </button>
                            </TableCell>
                            <TableCell>
                              <ClickablePhone phone={row.client_phone} />
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {row.decline_reason || '—'}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {formatDate(row.updated_at)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Card>
              </TabsContent>

              {/* تم التجديد — reuses report_renewed_clients with a
                  slimmer column set (old → new per car + price delta).
                  The detail-heavy top-level "renewed" tab stays intact;
                  this one is a quick snapshot inside the renewals flow. */}
              <TabsContent value="renewed" className="mt-4">
                <Card className="overflow-hidden">
                  {renewedLoading ? (
                    <div className="p-4 space-y-2">
                      {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                    </div>
                  ) : renewedClients.length === 0 ? (
                    <div className="text-center py-12">
                      <CheckCircle className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
                      <p className="text-muted-foreground">لا يوجد عملاء قاموا بالتجديد لهذا الشهر</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="text-right">العميل</TableHead>
                          <TableHead className="text-right">النوع (قديم → جديد)</TableHead>
                          <TableHead className="text-right">السعر (قديم → جديد)</TableHead>
                          <TableHead className="text-right">فرق السعر</TableHead>
                          <TableHead className="text-right">تاريخ التجديد</TableHead>
                          <TableHead className="text-right">التجديد بواسطة</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {renewedClients.map((client) => {
                          const priceDiff = (client.new_total_price || 0) - (client.total_insurance_price || 0);
                          const oldTypesLabel = (client.policy_types || []).map((t) =>
                            getInsuranceTypeLabel(t as any, null)
                          ).join(' + ') || '—';
                          const newTypesLabel = (client.new_policy_types || []).map((t) =>
                            getInsuranceTypeLabel(t as any, null)
                          ).join(' + ') || '—';
                          return (
                            <TableRow key={client.client_id} className="hover:bg-muted/30">
                              <TableCell>
                                <button
                                  onClick={() => navigate(`/clients/${client.client_id}`, {
                                    state: { from: '/reports/policies', tab: 'renewals' },
                                  })}
                                  className="font-medium hover:text-primary hover:underline transition-colors text-right"
                                >
                                  {client.client_name}
                                </button>
                                {client.client_file_number && (
                                  <p className="text-xs text-muted-foreground">{client.client_file_number}</p>
                                )}
                              </TableCell>
                              <TableCell className="text-sm">
                                <span className="text-muted-foreground">{oldTypesLabel}</span>
                                <ArrowLeftRight className="inline h-3 w-3 mx-1 text-muted-foreground" />
                                <span className="font-medium">{newTypesLabel}</span>
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                <span className="text-muted-foreground">
                                  ₪{(client.total_insurance_price || 0).toLocaleString('en-US')}
                                </span>
                                <ArrowLeftRight className="inline h-3 w-3 mx-1 text-muted-foreground" />
                                <span className="font-medium">
                                  ₪{(client.new_total_price || 0).toLocaleString('en-US')}
                                </span>
                              </TableCell>
                              <TableCell className={cn(
                                "font-bold font-mono",
                                priceDiff > 0 ? "text-green-600" : priceDiff < 0 ? "text-destructive" : "",
                              )}>
                                {priceDiff > 0 ? '+' : ''}₪{priceDiff.toLocaleString('en-US')}
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                {client.new_start_date ? formatDate(client.new_start_date) : '—'}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {client.renewed_by_name || '—'}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </Card>
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* Renewed Clients Tab */}
          <TabsContent value="renewed" className="space-y-4 mt-6">
            {/* Filters */}
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground shrink-0">الشهر:</span>
                  <ArabicDatePicker
                    value={renewedMonth ? `${renewedMonth}-01` : ''}
                    onChange={(date) => {
                      setRenewedMonth(date ? date.slice(0, 7) : '');
                      setRenewedPage(0);
                    }}
                    placeholder="اختر الشهر"
                    compact
                  />
                </div>

                <Select value={renewedPolicyTypeFilter} onValueChange={(v) => { setRenewedPolicyTypeFilter(v); setRenewedPage(0); }}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="النوع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الأنواع</SelectItem>
                    {Object.entries(policyTypeFilterLabels).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={renewedCreatedByFilter} onValueChange={(v) => { setRenewedCreatedByFilter(v); setRenewedPage(0); }}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="أنشأه" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل المستخدمين</SelectItem>
                    {users.map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث..."
                    value={renewedSearch}
                    onChange={(e) => { setRenewedSearch(e.target.value); setRenewedPage(0); }}
                    className="pr-10"
                  />
                </div>
              </div>
            </Card>

            {/* Table */}
            <Card className="overflow-hidden">
              {renewedLoading ? (
                <div className="p-4 space-y-2">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : renewedClients.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
                  <p className="text-muted-foreground">لا يوجد عملاء قاموا بالتجديد في هذه الفترة</p>
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="w-10"></TableHead>
                        <TableHead className="text-right">العميل</TableHead>
                        <TableHead className="text-right">الهاتف</TableHead>
                        <TableHead className="text-right">المعاملات القديمة</TableHead>
                        <TableHead className="text-right">انتهت بتاريخ</TableHead>
                        <TableHead className="text-right">السعر القديم</TableHead>
                        <TableHead className="text-right">المعاملات الجديدة</TableHead>
                        <TableHead className="text-right">بدأت بتاريخ</TableHead>
                        <TableHead className="text-right">السعر الجديد</TableHead>
                        <TableHead className="text-right">التجديد بواسطة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {renewedClients.map(client => (
                        <React.Fragment key={client.client_id}>
                          <TableRow 
                            className={cn(
                              "hover:bg-muted/30 cursor-pointer",
                              expandedRenewedClientId === client.client_id && "bg-muted/40"
                            )}
                            onClick={() => setExpandedRenewedClientId(
                              expandedRenewedClientId === client.client_id ? null : client.client_id
                            )}
                          >
                            <TableCell className="w-10">
                              <ChevronDown 
                                className={cn(
                                  "h-4 w-4 text-muted-foreground transition-transform",
                                  expandedRenewedClientId === client.client_id && "rotate-180"
                                )} 
                              />
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <div>
                                <button
                                  onClick={() => navigate(`/clients/${client.client_id}`, { 
                                    state: { from: '/reports/policies', tab: 'renewed' }
                                  })}
                                  className="font-medium hover:text-primary hover:underline transition-colors text-right"
                                >
                                  {client.client_name}
                                </button>
                                {client.client_file_number && (
                                  <p className="text-xs text-muted-foreground">{client.client_file_number}</p>
                                )}
                                {client.has_package && (
                                  <Badge variant="default" className="text-xs gap-1 mt-1 bg-primary">
                                    <Package className="h-3 w-3" />
                                    باقة
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <ClickablePhone phone={client.client_phone} />
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-bold">
                                {client.policies_count} معاملة
                              </Badge>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {client.policy_types?.map(type => (
                                  <span key={type} className="text-[10px] text-muted-foreground">
                                    {policyTypeLabels[type] || type}
                                  </span>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono">{formatDate(client.earliest_end_date)}</TableCell>
                            <TableCell className="font-bold text-muted-foreground">₪{client.total_insurance_price.toLocaleString()}</TableCell>
                            <TableCell>
                              <Badge variant="default" className="font-bold bg-green-600">
                                {client.new_policies_count} معاملة
                              </Badge>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {client.new_policy_types?.map(type => (
                                  <span key={type} className="text-[10px] text-green-600">
                                    {policyTypeLabels[type] || type}
                                  </span>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-green-600">{formatDate(client.new_start_date)}</TableCell>
                            <TableCell className="font-bold text-green-600">₪{client.new_total_price.toLocaleString()}</TableCell>
                            <TableCell>
                              {client.renewed_by_name ? (
                                <div className="flex items-center gap-2">
                                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                                    <span className="text-xs font-medium text-primary">
                                      {client.renewed_by_name.charAt(0)}
                                    </span>
                                  </div>
                                  <span className="text-sm">{client.renewed_by_name}</span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-sm">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                          
                          {/* Expanded Details Row */}
                          {expandedRenewedClientId === client.client_id && (
                            <TableRow key={`${client.client_id}-details`} className="bg-muted/20">
                              <TableCell colSpan={10} className="p-0">
                                <div className="px-6 py-4 border-t border-dashed">
                                  <div className="grid grid-cols-2 gap-6">
                                    {/* Old Policies */}
                                    <div>
                                      <div className="flex items-center gap-2 mb-3">
                                        <XCircle className="h-4 w-4 text-muted-foreground" />
                                        <span className="font-medium text-sm">المعاملات المنتهية</span>
                                        <Badge variant="outline" className="text-xs">
                                          {client.policies_count} معاملة
                                        </Badge>
                                      </div>
                                      <div className="space-y-2">
                                        {client.policy_types?.map((type, idx) => (
                                          <div key={idx} className="flex items-center gap-2 p-2 rounded bg-background border text-sm">
                                            <Badge variant="secondary" className="text-xs">
                                              {policyTypeLabels[type] || type}
                                            </Badge>
                                            <span className="text-muted-foreground">انتهت: {formatDate(client.earliest_end_date)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                    
                                    {/* New Policies */}
                                    <div>
                                      <div className="flex items-center gap-2 mb-3">
                                        <CheckCircle className="h-4 w-4 text-green-600" />
                                        <span className="font-medium text-sm text-green-600">المعاملات الجديدة</span>
                                        <Badge variant="default" className="text-xs bg-green-600">
                                          {client.new_policies_count} معاملة
                                        </Badge>
                                      </div>
                                      <div className="space-y-2">
                                        {client.new_policy_types?.map((type, idx) => (
                                          <div key={idx} className="flex items-center gap-2 p-2 rounded bg-green-50 border border-green-200 text-sm">
                                            <Badge className="text-xs bg-green-600">
                                              {policyTypeLabels[type] || type}
                                            </Badge>
                                            <span className="text-green-700">بدأت: {formatDate(client.new_start_date)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      ))}
                    </TableBody>
                  </Table>

                  {/* Pagination */}
                  <div className="flex items-center justify-between p-4 border-t">
                    <p className="text-sm text-muted-foreground">
                      إجمالي: {renewedTotalRows} عميل تم تجديد وثائقهم
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRenewedPage(p => Math.max(0, p - 1))}
                        disabled={renewedPage === 0}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <span className="text-sm">
                        {renewedPage + 1} / {renewedTotalPages || 1}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRenewedPage(p => p + 1)}
                        disabled={renewedPage >= renewedTotalPages - 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Update Status Dialog */}
      <Dialog open={updateStatusOpen} onOpenChange={setUpdateStatusOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تحديث حالة التجديد</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2">العميل: {selectedRenewalClient?.client_name}</p>
              <p className="text-sm text-muted-foreground">عدد المعاملات: {selectedRenewalClient?.policies_count} معاملة</p>
              <p className="text-xs text-muted-foreground mt-1">
                سيتم تطبيق الحالة على جميع معاملات هذا العميل
              </p>
            </div>
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الحالة" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(renewalStatusLabels).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              placeholder="ملاحظات..."
              value={statusNotes}
              onChange={(e) => setStatusNotes(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateStatusOpen(false)}>إلغاء</Button>
            <Button onClick={handleUpdateStatus} disabled={updatingStatus || !newStatus}>
              {updatingStatus && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Policy Wizard for Renewal */}
      <PolicyWizard
        open={wizardOpen}
        onOpenChange={(open) => {
          setWizardOpen(open);
          if (!open) {
            setRenewalData(null);
          }
        }}
        onSaved={() => {
          setWizardOpen(false);
          setRenewalData(null);
          toast.success('تم تجديد المعاملة بنجاح');
          // Refresh data - client will move to "Renewed" automatically via DB trigger
          setClientPolicies({});
          setExpandedClientId(null);
          fetchRenewals();
          // Auto-switch the sub-tab to "tam altajdid" and refetch so the
          // user sees the just-renewed client immediately. fetchRenewedClients
          // is also keyed on the sub-tab effect, but call it explicitly in
          // case the sub-tab was already on 'renewed' (the effect would
          // have already been coasting on stale data).
          setRenewalSubTab('renewed');
          fetchRenewedClients();
        }}
        renewalData={renewalData ?? undefined}
      />

      {/* Renewal Assistant — guided walkthrough modal. agentId is
          required so renewal_followups rows get the right tenant. */}
      {agentId && (
        <RenewalAssistant
          open={renewalAssistantOpen}
          onOpenChange={setRenewalAssistantOpen}
          agentId={agentId}
          month={renewalsMonth}
          onActionComplete={(status) => {
            // Always refetch the pending list so counts update.
            fetchRenewals();
            if (status === 'declined_renewal') {
              fetchDeclinedFollowups();
            }
            if (status === 'renewed') {
              // Client likely has new policies now — jump them to the
              // tam-altajdid sub-tab and refetch it.
              setRenewalSubTab('renewed');
              fetchRenewedClients();
            }
          }}
        />
      )}
    </MainLayout>
  );
}
