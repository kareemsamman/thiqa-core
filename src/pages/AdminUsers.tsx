import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { useAuth } from "@/hooks/useAuth";
import { useBranches } from "@/hooks/useBranches";
import { LockedBranchSelect } from "@/components/shared/LockedBranchSelect";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Navigate } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  UserCheck,
  UserX,
  Shield,
  ShieldCheck,
  User,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  History,
  UserPlus,
  Plus,
  KeyRound,
  Lock,
  Sparkles,
  Pencil,
} from "lucide-react";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { useAgentLimits } from "@/hooks/useAgentLimits";
import { useAgentContext } from "@/hooks/useAgentContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { arDZ as ar } from "date-fns/locale";
import { UserSessionsTab } from "@/components/admin/UserSessionsTab";
import { UserPermissionsDialog } from "@/components/admin/UserPermissionsDialog";
import { DefaultEmployeePermissionsCard } from "@/components/admin/DefaultEmployeePermissionsCard";
import { isPasswordValid } from "@/lib/authValidation";
import { digitsOnly } from "@/lib/validation";
import {
  DateRangeFilter,
  type DateRangeValue,
  DEFAULT_DATE_RANGE,
  resolveDateRange,
} from "@/components/admin/DateRangeFilter";

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  status: 'pending' | 'active' | 'blocked' | 'plan_locked';
  created_at: string;
  updated_at: string;
  branch_id: string | null;

}

interface UserRole {
  user_id: string;
  role: 'admin' | 'worker';
}

interface UserWithRole extends UserProfile {
  role?: 'admin' | 'worker';
}

interface LoginAttempt {
  id: string;
  email: string;
  created_at: string;
  success: boolean;
  ip_address: string | null;
}

export default function AdminUsers() {
  const { isAdmin, isSuperAdmin, profile, loading: authLoading } = useAuth();
  // A user is "the protected super admin" if the server marks them so via thiqa_super_admins.
  // Use a helper to identify rows that should be UI-locked, without leaking any email literal.
  const isProtectedSuperAdmin = (u: { id?: string }) =>
    !!isSuperAdmin && !!profile?.id && !!u.id && u.id === profile.id;
  const { branches, getBranchName } = useBranches();
  const { agentId } = useAgentContext();
  const { toast } = useToast();
  const { showUpgradePrompt, handleLimitError } = useUpgradePrompt();
  const { users: userLimit, loading: limitsLoading, refetch: refetchLimits } = useAgentLimits();
  // Only commit to the locked variant once limits have loaded — otherwise
  // we flash the amber lock on agents who are perfectly within quota.
  // During hydration the unlocked variant renders with disabled=true so
  // the flash can't be clicked through.
  const userLocked = !limitsLoading && userLimit.exceeded;

  const openUserUpgrade = () =>
    showUpgradePrompt({
      resource: 'users',
      current: userLimit.used,
      limit: userLimit.effective ?? 0,
    });
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loginAttempts, setLoginAttempts] = useState<LoginAttempt[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);
  const [attemptsRange, setAttemptsRange] = useState<DateRangeValue>(DEFAULT_DATE_RANGE);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<Record<string, 'admin' | 'worker'>>({});
  const [selectedBranch, setSelectedBranch] = useState<Record<string, string>>({});
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    userId: string;
    action: 'approve' | 'block' | 'unblock';
    userName: string;
  } | null>(null);

  // Per-user permissions dialog state. Opens from the "صلاحيات" button
  // on each active-user row.
  const [permissionsUser, setPermissionsUser] = useState<UserWithRole | null>(null);

  // Edit user form state — opens from the "تعديل" button on each
  // active-user row. Lets an admin update the worker's name, phone,
  // and (optionally) reset their password without leaving the page.
  // Password reset goes through the update-user-password edge function
  // because it requires service-role auth.
  const [editUser, setEditUser] = useState<UserWithRole | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editNewPassword, setEditNewPassword] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const openEditUser = (user: UserWithRole) => {
    setEditUser(user);
    setEditName(user.full_name || "");
    setEditEmail(user.email || "");
    setEditPhone(user.phone || "");
    setEditNewPassword("");
  };

  const closeEditUser = () => {
    setEditUser(null);
    setEditName("");
    setEditEmail("");
    setEditPhone("");
    setEditNewPassword("");
  };

  const handleSaveEdit = async () => {
    if (!editUser) return;

    const trimmedEmail = editEmail.trim().toLowerCase();
    const emailChanged = trimmedEmail !== (editUser.email || "").toLowerCase();
    if (emailChanged) {
      if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        toast({ title: "خطأ", description: "يرجى إدخال بريد إلكتروني صحيح", variant: "destructive" });
        return;
      }
    }

    const phoneDigits = digitsOnly(editPhone.trim());
    if (phoneDigits && phoneDigits.length !== 10) {
      toast({ title: "خطأ", description: "رقم الهاتف يجب أن يكون 10 أرقام", variant: "destructive" });
      return;
    }
    const trimmedPassword = editNewPassword.trim();
    if (trimmedPassword && !isPasswordValid(trimmedPassword)) {
      toast({
        title: "كلمة مرور ضعيفة",
        description: "كلمة المرور يجب أن تحتوي على 8 أحرف، حرف كبير، رقم، ورمز",
        variant: "destructive",
      });
      return;
    }

    setSavingEdit(true);
    try {
      const trimmedName = editName.trim();
      const nameChanged = (trimmedName || null) !== (editUser.full_name || null);
      const phoneChanged = (phoneDigits || null) !== (editUser.phone || null);

      if (nameChanged || phoneChanged) {
        const { error } = await supabase
          .from('profiles')
          .update({
            full_name: trimmedName || null,
            phone: phoneDigits || null,
          })
          .eq('id', editUser.id);
        if (error) throw error;
      }

      // Email and password both go through the edge function — it
      // owns the agent-admin auth check and is the only place with
      // service-role access to auth.users. Send them in one call when
      // both changed so we only round-trip once.
      if (emailChanged || trimmedPassword) {
        const body: { user_id: string; new_email?: string; new_password?: string } = {
          user_id: editUser.id,
        };
        if (emailChanged) body.new_email = trimmedEmail;
        if (trimmedPassword) body.new_password = trimmedPassword;
        const { data, error } = await supabase.functions.invoke('update-user-password', { body });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
      }

      toast({ title: "تم الحفظ", description: "تم تحديث بيانات المستخدم بنجاح" });
      closeEditUser();
      fetchUsers();
    } catch (err: unknown) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "فشل في حفظ التعديلات",
        variant: "destructive",
      });
    } finally {
      setSavingEdit(false);
    }
  };

  // Create user form state
  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserPhone, setNewUserPhone] = useState("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "worker">("worker");
  const [newUserBranch, setNewUserBranch] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);

  const resetCreateForm = () => {
    setNewUserName("");
    setNewUserEmail("");
    setNewUserPassword("");
    setNewUserPhone("");
    setNewUserRole("worker");
    // 'all' = no branch_id (user sees every branch). The admin can
    // pick a specific branch from the dropdown to scope the new
    // user. Defaulting to 'all' avoids silently locking new users
    // to whichever branch happened to be first in the list.
    setNewUserBranch('all');
  };

  const handleCreateUser = async () => {
    if (!agentId) return;
    // Pre-flight gate: if the agent is already at their user quota,
    // don't even hit the edge function — open the upgrade popup.
    if (userLimit.exceeded) {
      openUserUpgrade();
      return;
    }

    const email = newUserEmail.trim();
    const password = newUserPassword;
    const phoneDigits = digitsOnly(newUserPhone.trim());

    if (!email || !email.includes("@")) {
      toast({ title: "خطأ", description: "يرجى إدخال بريد إلكتروني صحيح", variant: "destructive" });
      return;
    }
    if (!isPasswordValid(password)) {
      toast({
        title: "كلمة مرور ضعيفة",
        description: "كلمة المرور يجب أن تحتوي على 8 أحرف، حرف كبير، رقم، ورمز",
        variant: "destructive",
      });
      return;
    }
    if (phoneDigits && phoneDigits.length !== 10) {
      toast({ title: "خطأ", description: "رقم الهاتف يجب أن يكون 10 أرقام", variant: "destructive" });
      return;
    }
    // 'all' = NULL branch_id (user sees every branch); a specific
    // UUID = scope to that branch. Either is valid; only an empty /
    // "none" value is invalid.
    if (branches.length > 0 && (!newUserBranch || newUserBranch === "none")) {
      toast({ title: "خطأ", description: "يرجى اختيار الفرع للمستخدم", variant: "destructive" });
      return;
    }

    setCreatingUser(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-agent-user', {
        body: {
          email,
          password,
          full_name: newUserName.trim() || null,
          phone: phoneDigits || null,
          agent_id: agentId,
          role: newUserRole,
          branch_id:
            newUserBranch && newUserBranch !== 'none' && newUserBranch !== 'all'
              ? newUserBranch
              : null,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({ title: "تم الإنشاء", description: "تم إنشاء المستخدم بنجاح" });
      resetCreateForm();
      setCreateSheetOpen(false);
      fetchUsers();
      refetchLimits();
    } catch (err: any) {
      // If the DB trigger raised LIMIT_EXCEEDED:users:..., swallow the
      // toast and open the upgrade dialog instead.
      if (handleLimitError(err)) {
        setCreateSheetOpen(false);
      } else {
        toast({ title: "خطأ", description: err.message || "فشل في إنشاء المستخدم", variant: "destructive" });
      }
    } finally {
      setCreatingUser(false);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      if (!agentId) {
        setUsers([]);
        return;
      }

      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone, status, created_at, updated_at, branch_id')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      const userIds = (profiles || []).map((profile) => profile.id);

      if (userIds.length === 0) {
        setUsers([]);
        return;
      }

      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .eq('agent_id', agentId);

      if (rolesError) throw rolesError;

      const usersWithRoles: UserWithRole[] = (profiles || []).map(profile => {
        const userRole = (roles || []).find(r => r.user_id === profile.id);
        return {
          ...profile,
          role: userRole?.role as 'admin' | 'worker' | undefined,
        };
      });

      setUsers(usersWithRoles);

      const roleSelections: Record<string, 'admin' | 'worker'> = {};
      const branchSelections: Record<string, string> = {};
      usersWithRoles.forEach(u => {
        if (u.status === 'pending') {
          roleSelections[u.id] = 'worker';
          if (branches.length > 0) {
            branchSelections[u.id] = branches[0].id;
          }
        }
      });
      setSelectedRole(roleSelections);
      setSelectedBranch(branchSelections);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast({
        title: "خطأ",
        description: "فشل في تحميل بيانات المستخدمين",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin && agentId) {
      fetchUsers();
    }
  }, [isAdmin, agentId, branches.length]);

  // login_attempts is scoped by agent_id (populated via DB trigger),
  // which captures failed attempts whose user_id stayed null but whose
  // email matched a profile in this agent. Fetched on its own so a
  // failure here doesn't block the users tabs, and so the date filter
  // can re-run this query without re-fetching every profile.
  const fetchLoginAttempts = async () => {
    if (!agentId) return;
    setAttemptsLoading(true);
    try {
      const { start, end } = resolveDateRange(attemptsRange);
      const { data, error } = await supabase
        .from('login_attempts')
        .select('*')
        .eq('agent_id', agentId)
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      setLoginAttempts((data || []) as LoginAttempt[]);
    } catch (error) {
      console.warn('Login attempts unavailable (migration may be pending):', error);
      setLoginAttempts([]);
    } finally {
      setAttemptsLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin && agentId) {
      fetchLoginAttempts();
    }
  }, [isAdmin, agentId, attemptsRange]);

  const handleApproveUser = async (userId: string) => {
    // Pre-flight: approving flips status pending → active, which will
    // trip enforce_user_limit if the agent is already at cap. Skip the
    // round-trip and open the upgrade dialog directly.
    if (userLimit.exceeded) {
      openUserUpgrade();
      setConfirmDialog(null);
      return;
    }
    setActionLoading(userId);
    try {
      const role = selectedRole[userId] || 'worker';
      const branchId = selectedBranch[userId] || (branches.length > 0 ? branches[0].id : null);

      // Update profile status to active and set branch
      const updateData: { status: 'active' | 'pending' | 'blocked' | 'plan_locked'; branch_id?: string } = { status: 'active' };
      if (branchId) {
        updateData.branch_id = branchId;
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', userId);

      if (profileError) throw profileError;

      if (!agentId) throw new Error('Missing agent context');

      // Add or update user role inside current agent only
      const { error: roleError } = await supabase
        .from('user_roles')
        .upsert({ user_id: userId, role, agent_id: agentId }, { onConflict: 'user_id,agent_id' });

      if (roleError) throw roleError;

      toast({
        title: "تم التفعيل",
        description: "تم تفعيل المستخدم بنجاح",
      });

      fetchUsers();
      refetchLimits();
    } catch (error: any) {
      if (handleLimitError(error)) {
        // upgrade dialog will be shown by the provider
      } else {
        console.error('Error approving user:', error);
        toast({
          title: "خطأ",
          description: error?.message || "فشل في تفعيل المستخدم",
          variant: "destructive",
        });
      }
    } finally {
      setActionLoading(null);
      setConfirmDialog(null);
    }
  };

  const handleBlockUser = async (userId: string) => {
    setActionLoading(userId);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({ status: 'blocked' })
        .eq('id', userId)
        .select('id');

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('لم يتم تحديث الحالة. تأكد من صلاحياتك.');
      }

      toast({
        title: "تم الحظر",
        description: "تم حظر المستخدم بنجاح",
      });

      fetchUsers();
    } catch (error) {
      console.error('Error blocking user:', error);
      toast({
        title: "خطأ",
        description: "فشل في حظر المستخدم",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
      setConfirmDialog(null);
    }
  };

  const handleUnblockUser = async (userId: string) => {
    // Unblocking flips blocked → active, which consumes a seat. If the
    // agent is already at their cap we'd get LIMIT_EXCEEDED from the
    // DB trigger; surface the upgrade flow up front instead.
    if (userLimit.exceeded) {
      openUserUpgrade();
      setConfirmDialog(null);
      return;
    }
    setActionLoading(userId);
    try {
      // Select the updated row back so we can detect when RLS silently
      // filters the update to zero rows — Supabase doesn't return an
      // error in that case, and without this check the UI would lie
      // and show a success toast.
      const { data, error } = await supabase
        .from('profiles')
        .update({ status: 'active' })
        .eq('id', userId)
        .select('id');

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('لم يتم تحديث الحالة. تأكد من صلاحياتك.');
      }

      toast({
        title: "تم إلغاء الحظر",
        description: "تم إلغاء حظر المستخدم بنجاح",
      });

      fetchUsers();
      refetchLimits();
    } catch (error: any) {
      if (handleLimitError(error)) {
        // upgrade dialog is shown by the provider
      } else {
        console.error('Error unblocking user:', error);
        toast({
          title: "خطأ",
          description: error?.message || "فشل في إلغاء حظر المستخدم",
          variant: "destructive",
        });
      }
    } finally {
      setActionLoading(null);
      setConfirmDialog(null);
    }
  };

  const handleChangeRole = async (userId: string, newRole: 'admin' | 'worker') => {
    setActionLoading(userId);
    try {
      if (!agentId) throw new Error('Missing agent context');

      // Update role for current agent only (do not touch other agent memberships)
      const { error } = await supabase
        .from('user_roles')
        .upsert({ user_id: userId, role: newRole, agent_id: agentId }, { onConflict: 'user_id,agent_id' });

      if (error) throw error;

      toast({
        title: "تم التحديث",
        description: "تم تحديث دور المستخدم بنجاح",
      });

      fetchUsers();
    } catch (error) {
      console.error('Error changing role:', error);
      toast({
        title: "خطأ",
        description: "فشل في تحديث دور المستخدم",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleChangeBranch = async (userId: string, branchId: string | null) => {
    setActionLoading(userId);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ branch_id: branchId })
        .eq('id', userId);

      if (error) throw error;

      toast({
        title: "تم التحديث",
        description: "تم تحديث فرع المستخدم بنجاح",
      });

      fetchUsers();
    } catch (error) {
      console.error('Error changing branch:', error);
      toast({
        title: "خطأ",
        description: "فشل في تحديث فرع المستخدم",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };


  const pendingUsers = users.filter(u => u.status === 'pending');
  // Plan-locked users show inside the "active" tab with a lock badge +
  // upgrade CTA — they appear locked in the UI but keep their slot in
  // the active list so the admin can tell a plan-overflow user apart
  // from someone they intentionally blocked.
  const activeUsers = users.filter(u => u.status === 'active' || u.status === 'plan_locked');
  const planLockedCount = users.filter(u => u.status === 'plan_locked').length;
  const blockedUsers = users.filter(u => u.status === 'blocked');

  // Redirect non-admins
  if (!authLoading && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30"><Clock className="h-3 w-3 ml-1" />معلق</Badge>;
      case 'active':
        return <Badge variant="outline" className="bg-success/10 text-success border-success/30"><CheckCircle className="h-3 w-3 ml-1" />نشط</Badge>;
      case 'blocked':
        return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30"><XCircle className="h-3 w-3 ml-1" />محظور</Badge>;
      case 'plan_locked':
        return <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400"><Lock className="h-3 w-3 ml-1" />مقفل — تجاوز حد الباقة</Badge>;
      default:
        return null;
    }
  };

  const getRoleBadge = (role?: string) => {
    if (role === 'admin') {
      return <Badge className="bg-primary/10 text-primary border-primary/30"><Shield className="h-3 w-3 ml-1" />مدير</Badge>;
    }
    return <Badge variant="secondary"><User className="h-3 w-3 ml-1" />موظف</Badge>;
  };

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), 'yyyy/MM/dd HH:mm', { locale: ar });
  };

  const renderTableSkeleton = () => (
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );

  return (
    <MainLayout>
      <Header
        title="المستخدمون"
        subtitle="إدارة المستخدمين والصلاحيات"
      />

      <div className="md:p-6 space-y-6">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2">
          {userLocked ? (
            <Button
              variant="outline"
              onClick={openUserUpgrade}
              className="gap-2 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
            >
              <Lock className="h-4 w-4" />
              إنشاء مستخدم
              <Sparkles className="h-3.5 w-3.5 opacity-70" />
            </Button>
          ) : (
            <Button
              onClick={() => {
                if (limitsLoading) return;
                resetCreateForm();
                setCreateSheetOpen(true);
              }}
              disabled={limitsLoading}
              className="gap-2"
            >
              <UserPlus className="h-4 w-4" />
              إنشاء مستخدم
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchUsers}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </Button>
        </div>

        {/* Stats Cards. Mobile: 2-col grid with smaller icons + tighter
            padding so all four stats fit in two rows instead of one
            stat per row. Desktop: original 4-col layout. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4">
          <div className="rounded-lg border bg-card p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-1.5 md:p-2 rounded-lg bg-warning/10 shrink-0">
                <Clock className="h-4 w-4 md:h-5 md:w-5 text-warning" />
              </div>
              <div className="min-w-0">
                <p className="text-xs md:text-sm text-muted-foreground truncate">بانتظار الموافقة</p>
                <p className="text-xl md:text-2xl font-bold ltr-nums leading-tight">{pendingUsers.length}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-1.5 md:p-2 rounded-lg bg-success/10 shrink-0">
                <CheckCircle className="h-4 w-4 md:h-5 md:w-5 text-success" />
              </div>
              <div className="min-w-0">
                <p className="text-xs md:text-sm text-muted-foreground truncate">مستخدمون نشطون</p>
                <p className="text-xl md:text-2xl font-bold ltr-nums leading-tight">{activeUsers.length}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-1.5 md:p-2 rounded-lg bg-destructive/10 shrink-0">
                <XCircle className="h-4 w-4 md:h-5 md:w-5 text-destructive" />
              </div>
              <div className="min-w-0">
                <p className="text-xs md:text-sm text-muted-foreground truncate">محظورون</p>
                <p className="text-xl md:text-2xl font-bold ltr-nums leading-tight">{blockedUsers.length}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-1.5 md:p-2 rounded-lg bg-primary/10 shrink-0">
                <User className="h-4 w-4 md:h-5 md:w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs md:text-sm text-muted-foreground truncate">إجمالي المستخدمين</p>
                <p className="text-xl md:text-2xl font-bold ltr-nums leading-tight">{users.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="active" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3 md:grid-cols-6 h-auto gap-1 p-1">
            <TabsTrigger value="active" className="gap-2 py-2.5">
              <CheckCircle className="h-4 w-4" />
              نشط ({activeUsers.length})
            </TabsTrigger>
            <TabsTrigger value="pending" className="gap-2 py-2.5">
              <Clock className="h-4 w-4" />
              معلق ({pendingUsers.length})
            </TabsTrigger>
            <TabsTrigger value="blocked" className="gap-2 py-2.5">
              <XCircle className="h-4 w-4" />
              محظور ({blockedUsers.length})
            </TabsTrigger>
            <TabsTrigger value="sessions" className="gap-2 py-2.5">
              <History className="h-4 w-4" />
              الجلسات
            </TabsTrigger>
            <TabsTrigger value="attempts" className="gap-2 py-2.5">
              <KeyRound className="h-4 w-4" />
              محاولات الدخول
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2 py-2.5">
              <Shield className="h-4 w-4" />
              الإعدادات
            </TabsTrigger>
          </TabsList>

          {/* Pending Users */}
          <TabsContent value="pending">
            <div className="rounded-lg border bg-card">
              {loading ? (
                <div className="p-4">{renderTableSkeleton()}</div>
              ) : pendingUsers.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>لا يوجد مستخدمون بانتظار الموافقة</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">الاسم</TableHead>
                      <TableHead className="text-right">البريد الإلكتروني</TableHead>
                      <TableHead className="text-right">تاريخ التسجيل</TableHead>
                      <TableHead className="text-right">الفرع</TableHead>
                      <TableHead className="text-right">الدور</TableHead>
                      <TableHead className="text-right">الإجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">
                          {user.full_name || 'غير محدد'}
                        </TableCell>
                        <TableCell className="text-right">
                          <bdi>{user.email}</bdi>
                        </TableCell>
                        <TableCell>{formatDate(user.created_at)}</TableCell>
                        <TableCell>
                          <Select
                            value={selectedBranch[user.id] || (branches.length > 0 ? branches[0].id : '')}
                            onValueChange={(value) => 
                              setSelectedBranch(prev => ({ ...prev, [user.id]: value }))
                            }
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue placeholder="اختر الفرع" />
                            </SelectTrigger>
                            <SelectContent>
                              {branches.map(branch => (
                                <SelectItem key={branch.id} value={branch.id}>
                                  {branch.name_ar || branch.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={selectedRole[user.id] || 'worker'}
                            onValueChange={(value: 'admin' | 'worker') => 
                              setSelectedRole(prev => ({ ...prev, [user.id]: value }))
                            }
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="worker">موظف</SelectItem>
                              <SelectItem value="admin">مدير</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            onClick={() => setConfirmDialog({
                              open: true,
                              userId: user.id,
                              action: 'approve',
                              userName: user.full_name || user.email,
                            })}
                            disabled={actionLoading === user.id}
                          >
                            {actionLoading === user.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <UserCheck className="h-4 w-4 ml-1" />
                                تفعيل
                              </>
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>

          {/* Active Users */}
          <TabsContent value="active">
            {planLockedCount > 0 && (
              <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
                <Lock className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 text-sm">
                  <p className="font-medium text-foreground">
                    {planLockedCount} مستخدم مقفل بسبب تجاوز حد الباقة
                  </p>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    هؤلاء المستخدمون لا يستطيعون تسجيل الدخول. قم بترقية الباقة أو أضف مستخدمين إضافيين لفتحهم تلقائياً.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                  onClick={() => showUpgradePrompt({ resource: 'users' })}
                >
                  <Sparkles className="h-4 w-4" />
                  ترقية الباقة
                </Button>
              </div>
            )}
            <div className="rounded-lg border bg-card">
              {loading ? (
                <div className="p-4">{renderTableSkeleton()}</div>
              ) : activeUsers.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>لا يوجد مستخدمون نشطون</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">الاسم</TableHead>
                      <TableHead className="text-right">البريد الإلكتروني</TableHead>
                      <TableHead className="text-right">الفرع</TableHead>
                      <TableHead className="text-right">الدور</TableHead>
                      <TableHead className="text-right">الإجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeUsers.map((user) => {
                      const isPlanLocked = user.status === 'plan_locked';
                      return (
                      <TableRow
                        key={user.id}
                        className={isPlanLocked ? 'bg-amber-500/5 hover:bg-amber-500/10' : undefined}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {isPlanLocked && (
                              <Lock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                            )}
                            <span className={isPlanLocked ? 'text-muted-foreground' : undefined}>
                              {user.full_name || 'غير محدد'}
                            </span>
                          </div>
                          {isPlanLocked && (
                            <div className="mt-1">
                              {getStatusBadge('plan_locked')}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <bdi className={isPlanLocked ? 'text-muted-foreground' : undefined}>
                            {user.email}
                          </bdi>
                        </TableCell>
                        <TableCell>
                          <LockedBranchSelect
                            value={user.branch_id || 'all'}
                            onValueChange={(value) => handleChangeBranch(user.id, value === 'all' ? null : value)}
                            branches={branches}
                            placeholder="اختر الفرع"
                            triggerClassName="w-32"
                            allOption={{ value: 'all', label: 'جميع الفروع' }}
                            disabled={actionLoading === user.id || isProtectedSuperAdmin(user) || isPlanLocked}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={user.role || 'worker'}
                            onValueChange={(value: 'admin' | 'worker') =>
                              handleChangeRole(user.id, value)
                            }
                            disabled={actionLoading === user.id || isProtectedSuperAdmin(user) || isPlanLocked}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="worker">موظف</SelectItem>
                              <SelectItem value="admin">مدير</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {isPlanLocked ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                              onClick={() => showUpgradePrompt({ resource: 'users' })}
                            >
                              <Sparkles className="h-4 w-4" />
                              ترقية الباقة
                            </Button>
                          ) : !isProtectedSuperAdmin(user) ? (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openEditUser(user)}
                                className="gap-1"
                                title="تعديل بيانات المستخدم"
                                disabled={actionLoading === user.id}
                              >
                                <Pencil className="h-4 w-4" />
                                تعديل
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setPermissionsUser(user)}
                                className="gap-1"
                                title="تعديل صلاحيات المستخدم"
                              >
                                <ShieldCheck className="h-4 w-4" />
                                صلاحيات
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setConfirmDialog({
                                  open: true,
                                  userId: user.id,
                                  action: 'block',
                                  userName: user.full_name || user.email,
                                })}
                                disabled={actionLoading === user.id}
                              >
                                {actionLoading === user.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <UserX className="h-4 w-4 ml-1" />
                                    حظر
                                  </>
                                )}
                              </Button>
                            </div>
                          ) : (
                            <Badge variant="outline" className="bg-primary/10 text-primary">
                              <Shield className="h-3 w-3 ml-1" />
                              مدير النظام
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>

          {/* Blocked Users */}
          <TabsContent value="blocked">
            <div className="rounded-lg border bg-card">
              {loading ? (
                <div className="p-4">{renderTableSkeleton()}</div>
              ) : blockedUsers.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <XCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>لا يوجد مستخدمون محظورون</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">الاسم</TableHead>
                      <TableHead className="text-right">البريد الإلكتروني</TableHead>
                      <TableHead className="text-right">الحالة</TableHead>
                      <TableHead className="text-right">الإجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {blockedUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">
                          {user.full_name || 'غير محدد'}
                        </TableCell>
                        <TableCell className="text-right">
                          <bdi>{user.email}</bdi>
                        </TableCell>
                        <TableCell>{getStatusBadge(user.status)}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmDialog({
                              open: true,
                              userId: user.id,
                              action: 'unblock',
                              userName: user.full_name || user.email,
                            })}
                            disabled={actionLoading === user.id}
                          >
                            {actionLoading === user.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <UserCheck className="h-4 w-4 ml-1" />
                                إلغاء الحظر
                              </>
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>

          {/* User Sessions Tab */}
          <TabsContent value="sessions">
            <UserSessionsTab />
          </TabsContent>

          {/* Login Attempts Tab */}
          <TabsContent value="attempts" className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center justify-between">
              <DateRangeFilter value={attemptsRange} onChange={setAttemptsRange} />
              <Button
                variant="outline"
                size="sm"
                onClick={fetchLoginAttempts}
                disabled={attemptsLoading}
                className="gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${attemptsLoading ? 'animate-spin' : ''}`} />
                تحديث
              </Button>
            </div>
            <div className="rounded-lg border bg-card">
              {attemptsLoading ? (
                <div className="p-4">{renderTableSkeleton()}</div>
              ) : loginAttempts.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <KeyRound className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>لا توجد محاولات دخول في هذه الفترة</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">البريد الإلكتروني</TableHead>
                      <TableHead className="text-right">الوقت</TableHead>
                      <TableHead className="text-right">النتيجة</TableHead>
                      <TableHead className="text-right">عنوان IP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loginAttempts.map((attempt) => (
                      <TableRow key={attempt.id}>
                        <TableCell className="text-right">
                          <bdi>{attempt.email}</bdi>
                        </TableCell>
                        <TableCell>{formatDate(attempt.created_at)}</TableCell>
                        <TableCell>
                          {attempt.success ? (
                            <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                              <CheckCircle className="h-3 w-3 ml-1" />
                              نجاح
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                              <XCircle className="h-3 w-3 ml-1" />
                              فشل
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          <bdi>{attempt.ip_address || '-'}</bdi>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>

          {/* Settings Tab — agent-level defaults for new employee permissions */}
          <TabsContent value="settings" className="space-y-4">
            <DefaultEmployeePermissionsCard />
          </TabsContent>
        </Tabs>
      </div>

      {/* Per-user permissions dialog */}
      <UserPermissionsDialog
        user={permissionsUser}
        open={!!permissionsUser}
        onOpenChange={(open) => !open && setPermissionsUser(null)}
        onSaved={fetchUsers}
      />

      {/* Edit User Sheet */}
      <Sheet open={!!editUser} onOpenChange={(open) => !open && !savingEdit && closeEditUser()}>
        <SheetContent side="left" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>تعديل بيانات المستخدم</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-2">
              <Label>البريد الإلكتروني</Label>
              <Input
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="user@example.com"
                dir="ltr"
                type="email"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                تغيير البريد الإلكتروني سيُحدّث بيانات تسجيل الدخول لهذا المستخدم
              </p>
            </div>
            <div className="space-y-2">
              <Label>الاسم الكامل</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="مثال: أحمد محمد"
              />
            </div>
            <div className="space-y-2">
              <Label>الهاتف</Label>
              <Input
                value={editPhone}
                onChange={(e) => setEditPhone(digitsOnly(e.target.value).slice(0, 10))}
                placeholder="0501234567"
                dir="ltr"
                inputMode="numeric"
                maxLength={10}
              />
              <p className="text-xs text-muted-foreground">10 أرقام بدون رموز أو مسافات</p>
            </div>
            <div className="space-y-2 pt-2 border-t">
              <Label>كلمة مرور جديدة</Label>
              <Input
                value={editNewPassword}
                onChange={(e) => setEditNewPassword(e.target.value)}
                placeholder="اتركه فارغاً للإبقاء على كلمة المرور الحالية"
                dir="ltr"
                type="password"
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                إذا أردت تغيير كلمة المرور، يجب أن تحتوي على 8 أحرف، حرف كبير، رقم، ورمز
              </p>
            </div>
            <div className="flex gap-2 pt-4">
              <Button onClick={handleSaveEdit} disabled={savingEdit} className="flex-1">
                {savingEdit ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
                حفظ التعديلات
              </Button>
              <Button variant="outline" onClick={closeEditUser} disabled={savingEdit}>
                إلغاء
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Create User Sheet */}
      <Sheet open={createSheetOpen} onOpenChange={setCreateSheetOpen}>
        <SheetContent side="left" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>إنشاء مستخدم جديد</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-2">
              <Label>الاسم الكامل</Label>
              <Input value={newUserName} onChange={e => setNewUserName(e.target.value)} placeholder="مثال: أحمد محمد" />
            </div>
            <div className="space-y-2">
              <Label>البريد الإلكتروني *</Label>
              <Input value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} placeholder="user@example.com" dir="ltr" type="email" />
            </div>
            <div className="space-y-2">
              <Label>كلمة المرور *</Label>
              <Input
                value={newUserPassword}
                onChange={e => setNewUserPassword(e.target.value)}
                placeholder="8 أحرف، حرف كبير، رقم، ورمز"
                dir="ltr"
                type="password"
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                يجب أن تحتوي على 8 أحرف على الأقل، حرف كبير، رقم، ورمز
              </p>
            </div>
            <div className="space-y-2">
              <Label>الهاتف</Label>
              <Input
                value={newUserPhone}
                onChange={e => setNewUserPhone(digitsOnly(e.target.value).slice(0, 10))}
                placeholder="0501234567"
                dir="ltr"
                inputMode="numeric"
                maxLength={10}
              />
              <p className="text-xs text-muted-foreground">10 أرقام بدون رموز أو مسافات</p>
            </div>
            <div className="space-y-2">
              <Label>الصلاحية *</Label>
              <Select value={newUserRole} onValueChange={(v) => setNewUserRole(v as 'admin' | 'worker')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">مدير (Admin)</SelectItem>
                  <SelectItem value="worker">موظف (Worker)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {branches.length > 0 && (
              <div className="space-y-2">
                <Label>الفرع *</Label>
                <LockedBranchSelect
                  value={newUserBranch}
                  onValueChange={setNewUserBranch}
                  branches={branches}
                  placeholder="اختر الفرع"
                  allOption={{ value: 'all', label: 'جميع الفروع' }}
                />
                <p className="text-xs text-muted-foreground">
                  اختر فرعاً محدداً ليرى المستخدم بياناته فقط، أو "جميع الفروع" ليرى بيانات الوكالة كاملة. ينطبق على المدير والموظف.
                </p>
              </div>
            )}
            <div className="flex gap-2 pt-4">
              <Button
                onClick={handleCreateUser}
                disabled={
                  creatingUser ||
                  !newUserEmail.trim() ||
                  !isPasswordValid(newUserPassword) ||
                  (branches.length > 0 && (!newUserBranch || newUserBranch === "none"))
                }
                className="flex-1"
              >
                {creatingUser ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Plus className="h-4 w-4 ml-2" />}
                إنشاء المستخدم
              </Button>
              <Button variant="outline" onClick={() => setCreateSheetOpen(false)} disabled={creatingUser}>
                إلغاء
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmDialog?.open} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDialog?.action === 'approve' && 'تأكيد تفعيل المستخدم'}
              {confirmDialog?.action === 'block' && 'تأكيد حظر المستخدم'}
              {confirmDialog?.action === 'unblock' && 'تأكيد إلغاء الحظر'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog?.action === 'approve' && (
                <>هل أنت متأكد من تفعيل المستخدم <strong>{confirmDialog?.userName}</strong>؟</>
              )}
              {confirmDialog?.action === 'block' && (
                <>هل أنت متأكد من حظر المستخدم <strong>{confirmDialog?.userName}</strong>؟ لن يتمكن من الوصول إلى النظام.</>
              )}
              {confirmDialog?.action === 'unblock' && (
                <>هل أنت متأكد من إلغاء حظر المستخدم <strong>{confirmDialog?.userName}</strong>؟</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDialog?.action === 'approve') {
                  handleApproveUser(confirmDialog.userId);
                } else if (confirmDialog?.action === 'block') {
                  handleBlockUser(confirmDialog.userId);
                } else if (confirmDialog?.action === 'unblock') {
                  handleUnblockUser(confirmDialog.userId);
                }
              }}
              className={confirmDialog?.action === 'block' ? 'bg-destructive hover:bg-destructive/90' : ''}
            >
              {confirmDialog?.action === 'approve' && 'تفعيل'}
              {confirmDialog?.action === 'block' && 'حظر'}
              {confirmDialog?.action === 'unblock' && 'إلغاء الحظر'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
