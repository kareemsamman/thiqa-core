import { useState, useEffect, useMemo } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  Car,
  FileText,
  Building2,
  UserCog,
  Bell,
  BarChart3,
  Settings,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  LogOut,
  Wallet,
  CreditCard,
  Loader2,
  Image,
  Menu,
  MessageSquare,
  FileSignature,
  Upload,
  DollarSign,
  History,
  Activity,
  Truck,
  Shield,
  Megaphone,
  AlertTriangle,
  ListTodo,
  Contact,
  FileWarning,
  Mail,
  LucideIcon,
  UserCircle,
  MoreVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarNotificationBadge } from "./SidebarNotificationBadge";
import { SidebarDebtBadge } from "./SidebarDebtBadge";
import { SidebarTaskBadge } from "./SidebarTaskBadge";
import { SidebarClaimsBadge } from "./SidebarClaimsBadge";
import { SidebarAccidentsBadge } from "./SidebarAccidentsBadge";
import { SidebarRenewalsBadge } from "./SidebarRenewalsBadge";
import { SidebarSearch } from "./SidebarSearch";
import { ProfileEditDrawer } from "./ProfileEditDrawer";
import { Palette, Link2, Crown, HelpCircle } from "lucide-react";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useAgentContext } from "@/hooks/useAgentContext";
import thiqaLogo from "@/assets/thiqa-logo-full.svg";
import thiqaLogoIcon from "@/assets/thiqa-logo-icon.svg";
import { useSidebarState } from "@/hooks/useSidebarState";

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  thiqaSuperAdminOnly?: boolean;
  featureKey?: string;
  badge?: 'notifications' | 'debt' | 'tasks' | 'claims' | 'accidents' | 'renewals';
}

interface NavGroup {
  name: string;
  icon: LucideIcon;
  items: NavItem[];
  adminOnly?: boolean;
  defaultOpen?: boolean;
}

// Navigation structure with groups - exported for NavigationSearch
export const navigationGroups: NavGroup[] = [
  {
    name: "الرئيسية",
    icon: LayoutDashboard,
    defaultOpen: true,
    items: [
      { name: "لوحة التحكم", href: "/", icon: LayoutDashboard },
      { name: "المهام", href: "/tasks", icon: ListTodo, badge: 'tasks' },
      { name: "سجل النشاط", href: "/activity", icon: Activity },
      { name: "التنبيهات", href: "/notifications", icon: Bell, badge: 'notifications' },
    ],
  },
  {
    name: "إدارة العملاء",
    icon: Users,
    items: [
      { name: "العملاء", href: "/clients", icon: Users },
      { name: "السيارات", href: "/cars", icon: Car },
      { name: "الوثائق", href: "/policies", icon: FileText },
      { name: "جهات الاتصال", href: "/contacts", icon: Contact },
    ],
  },
  {
    name: "المالية",
    icon: Wallet,
    items: [
      { name: "الشيكات", href: "/cheques", icon: CreditCard, featureKey: 'cheques' },
      { name: "متابعة الديون", href: "/debt-tracking", icon: DollarSign, badge: 'debt' },
      { name: "شركات التأمين", href: "/companies", icon: Building2, adminOnly: true },
      { name: "الوسطاء", href: "/brokers", icon: Wallet, adminOnly: true, featureKey: 'broker_wallet' },
      { name: "سندات القبض والصرف", href: "/expenses", icon: DollarSign, adminOnly: true, featureKey: 'expenses' },
      { name: "الإيصالات", href: "/receipts", icon: FileText, featureKey: 'receipts' },
    ],
  },
  {
    name: "التقارير",
    icon: BarChart3,
    items: [
      { name: "تقارير الوثائق", href: "/reports/policies", icon: BarChart3, badge: 'renewals' },
      { name: "تقرير الشركات", href: "/reports/company-settlement", icon: BarChart3, adminOnly: true, featureKey: 'company_settlement' },
      { name: "التقارير المالية", href: "/reports/financial", icon: Wallet, adminOnly: true, featureKey: 'financial_reports' },
      { name: "المحاسبة", href: "/accounting", icon: DollarSign, adminOnly: true, featureKey: 'accounting' },
    ],
  },
  {
    name: "بلاغات وحوادث",
    icon: AlertTriangle,
    items: [
      { name: "بلاغات الحوادث", href: "/accidents", icon: AlertTriangle, badge: 'accidents', featureKey: 'accident_reports' },
      { name: "المطالبات", href: "/admin/claims", icon: FileWarning, badge: 'claims', featureKey: 'repair_claims' },
    ],
  },
  {
    name: "أخرى",
    icon: Image,
    items: [
      { name: "الوسائط", href: "/media", icon: Image },
      { name: "نماذج", href: "/form-templates", icon: FileText },
    ],
  },
  {
    name: "الإعدادات",
    icon: Settings,
    adminOnly: true,
    items: [
      { name: "المستخدمون", href: "/admin/users", icon: UserCog },
      { name: "الفروع", href: "/admin/branches", icon: Building2 },
      { name: "الترويسات", href: "/admin/correspondence", icon: Mail, featureKey: 'correspondence' },
      { name: "SMS تسويقية", href: "/admin/marketing-sms", icon: Megaphone, featureKey: 'marketing_sms' },
      { name: "أنواع التأمين", href: "/admin/insurance-categories", icon: FileText },
      { name: "خدمات الطريق", href: "/admin/road-services", icon: Truck, featureKey: 'road_services' },
      { name: "إعفاء رسوم الحادث", href: "/admin/accident-fee-services", icon: Shield, featureKey: 'accident_fees' },
      { name: "توقيعات العملاء", href: "/admin/customer-signatures", icon: FileSignature },
      { name: "سجل الرسائل", href: "/sms-history", icon: History, featureKey: 'sms' },
      { name: "العلامة التجارية", href: "/admin/branding", icon: Palette },
    ],
  },
  {
    name: "إدارة ثقة",
    icon: Crown,
    items: [
      { name: "لوحة التحكم", href: "/thiqa", icon: LayoutDashboard, thiqaSuperAdminOnly: true },
      { name: "الوكلاء", href: "/thiqa/agents", icon: Building2, thiqaSuperAdminOnly: true },
      { name: "سجل المدفوعات", href: "/thiqa/payments", icon: CreditCard, thiqaSuperAdminOnly: true },
      { name: "إعلانات النظام", href: "/thiqa/announcements", icon: Megaphone, thiqaSuperAdminOnly: true },
      { name: "إعدادات المنصة", href: "/thiqa/settings", icon: Settings, thiqaSuperAdminOnly: true },
      { name: "تحليلات الموقع", href: "/thiqa/analytics", icon: BarChart3, thiqaSuperAdminOnly: true },
    ],
  },
];

function SidebarContent({ collapsed, onCollapse, onNavigate }: { 
  collapsed: boolean; 
  onCollapse?: (val: boolean) => void;
  onNavigate?: () => void;
}) {
  const [signingOut, setSigningOut] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut, isAdmin, branchName, isSuperAdmin } = useAuth();
  const { data: siteSettings } = useSiteSettings();
  const { hasFeature, isThiqaSuperAdmin, agent } = useAgentContext();

  // Filter groups and items based on role + features
  // Thiqa super admin only sees the Thiqa management section
  const filteredGroups = navigationGroups
    .filter(group => {
      if (isThiqaSuperAdmin) return group.name === 'إدارة ثقة';
      if (group.adminOnly && !isAdmin) return false;
      return true;
    })
    .map(group => ({
      ...group,
      items: group.items.filter(item => {
        if (isThiqaSuperAdmin) return true; // Thiqa admin sees all items in their groups
        if (item.thiqaSuperAdminOnly && !isThiqaSuperAdmin) return false;
        if (item.superAdminOnly && !isSuperAdmin) return false;
        if (item.adminOnly && !isAdmin) return false;
        if (item.featureKey && !hasFeature(item.featureKey)) return false;
        return true;
      }),
    }))
    .filter(group => group.items.length > 0);

  // Check if any item in a group is active
  const isGroupActive = (group: NavGroup) => {
    return group.items.some(item => location.pathname === item.href);
  };

  // Initialize open states - all groups open by default
  useEffect(() => {
    const initialState: Record<string, boolean> = {};
    filteredGroups.forEach(group => {
      initialState[group.name] = true; // All groups open by default
    });
    setOpenGroups(initialState);
  }, []);

  // Update open state when route changes
  useEffect(() => {
    filteredGroups.forEach(group => {
      if (isGroupActive(group)) {
        setOpenGroups(prev => ({ ...prev, [group.name]: true }));
      }
    });
  }, [location.pathname]);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    navigate('/login', { replace: true });
  };

  const handleNavClick = () => {
    onNavigate?.();
  };

  const toggleGroup = (groupName: string) => {
    setOpenGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  const userName = profile?.full_name || profile?.email?.split('@')[0] || 'مستخدم';
  const userInitial = userName.charAt(0);
  const userRole = isAdmin ? 'مدير' : 'موظف';
  const userBranch = branchName;

  const renderBadge = (item: NavItem) => {
    if (!item.badge) return null;
    if (item.badge === 'notifications') return <SidebarNotificationBadge collapsed={collapsed} />;
    if (item.badge === 'debt') return <SidebarDebtBadge collapsed={collapsed} />;
    if (item.badge === 'tasks') return <SidebarTaskBadge collapsed={collapsed} />;
    if (item.badge === 'claims') return <SidebarClaimsBadge collapsed={collapsed} />;
    if (item.badge === 'accidents') return <SidebarAccidentsBadge collapsed={collapsed} />;
    if (item.badge === 'renewals') return <SidebarRenewalsBadge collapsed={collapsed} />;
    return null;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex h-20 items-center justify-between border-b border-white/[0.08] px-4">
        {!collapsed && (
          <div className="flex items-center gap-2">
            {isThiqaSuperAdmin ? (
              <img src={thiqaLogo} alt="Thiqa" className="rounded-lg object-contain" />
            ) : siteSettings?.logo_url ? (
              <>
                <img src={siteSettings.logo_url} alt="Logo" className="h-9 w-9 rounded-lg object-contain" />
                <span className="text-base font-semibold text-sidebar-foreground">
                  {siteSettings?.site_title || ''}
                </span>
              </>
            ) : (
              <img src={thiqaLogoIcon} alt="ثقة" className="h-9 w-9 rounded-lg object-contain" />
            )}
          </div>
        )}
        {collapsed && (
          isThiqaSuperAdmin ? (
            <img src={thiqaLogoIcon} alt="Thiqa" className="mx-auto h-8 w-8 object-contain" />
          ) : siteSettings?.logo_url ? (
            <img src={siteSettings.logo_url} alt="Logo" className="mx-auto h-9 w-9 rounded-lg object-contain" />
          ) : (
            <img src={thiqaLogoIcon} alt="ثقة" className="mx-auto h-8 w-8 object-contain" />
          )
        )}
      </div>

      {/* Search */}
      <SidebarSearch collapsed={collapsed} onNavigate={onNavigate} />

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-1 p-2 overflow-y-auto">
        {filteredGroups.map((group) => {
          const isOpen = openGroups[group.name] ?? false;
          const GroupIcon = group.icon;
          
          if (collapsed) {
            // When collapsed, show only icons without groups
            return (
              <div key={group.name} className="space-y-1">
                {group.items.map((item) => {
                  const isActiveRoute = location.pathname === item.href;
                  return (
                    <NavLink
                      key={item.name}
                      to={item.href}
                      onClick={handleNavClick}
                      title={item.name}
                      className={cn(
                        "flex items-center justify-center rounded-lg p-2.5 transition-all duration-200 relative",
                        isActiveRoute
                          ? "glass-dark bg-[hsl(var(--sidebar-active))]/10 text-[hsl(var(--sidebar-active))]"
                          : "text-sidebar-foreground hover:bg-[hsl(var(--sidebar-glass-bg))] hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <item.icon className={cn("h-5 w-5", isActiveRoute && "text-[hsl(var(--sidebar-active))]")} />
                      {renderBadge(item)}
                    </NavLink>
                  );
                })}
              </div>
            );
          }

          return (
            <Collapsible
              key={group.name}
              open={isOpen}
              onOpenChange={() => toggleGroup(group.name)}
              className="mb-1"
            >
              <CollapsibleTrigger
                className={cn(
                  "group flex items-center w-full px-3 py-2.5 rounded-md transition-all duration-200 gap-2.5",
                  "hover:bg-white/[0.05]",
                  isOpen && "bg-white/[0.03]",
                )}
              >
                <GroupIcon className="h-[18px] w-[18px] text-white shrink-0" strokeWidth={2.5} />
                <span className="text-[15px] font-extrabold tracking-[0.06em] text-white whitespace-nowrap">
                  {group.name}
                </span>
                <div className="flex-1 h-px bg-gradient-to-l from-white/15 to-transparent" />
                <ChevronDown
                  className={cn(
                    "h-[16px] w-[16px] text-white shrink-0 transition-transform duration-300",
                    isOpen && "rotate-180",
                  )}
                  strokeWidth={2.75}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-1 mr-2 space-y-0.5">
                {group.items.map((item) => {
                  const isActiveRoute = location.pathname === item.href;
                  return (
                    <NavLink
                      key={item.name}
                      to={item.href}
                      onClick={handleNavClick}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-medium transition-all duration-200 relative group",
                        isActiveRoute
                          ? "glass-dark bg-[hsl(var(--sidebar-active))]/10 text-[hsl(var(--sidebar-active))] border-r-2 border-[hsl(var(--sidebar-active))]"
                          : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
                      )}
                    >
                      <item.icon className={cn("h-[18px] w-[18px] flex-shrink-0 transition-colors", isActiveRoute ? "text-[hsl(var(--sidebar-active))]" : "text-slate-400 group-hover:text-white")} />
                      <span>{item.name}</span>
                      {item.badge === 'renewals' && (
                        <span className="text-xs text-sidebar-foreground/40">| التجديدات</span>
                      )}
                      {renderBadge(item)}
                    </NavLink>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </nav>

      {/* Collapse toggle - only on desktop */}
      {onCollapse && (
        <div className="px-3 pb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onCollapse(!collapsed)}
            className={cn(
              "w-full justify-center h-10 text-white/70 hover:text-white hover:bg-white/[0.08]",
              collapsed && "px-2"
            )}
          >
            {collapsed ? (
              <ChevronLeft className="h-5 w-5" strokeWidth={2.25} />
            ) : (
              <>
                <ChevronRight className="h-5 w-5" strokeWidth={2.25} />
                <span className="mr-2 text-sm font-medium">تصغير</span>
              </>
            )}
          </Button>
        </div>
      )}

      {/* User section */}
      <div className="border-t border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex w-full items-center gap-3 rounded-lg p-2 transition-colors hover:bg-sidebar-accent",
                collapsed && "justify-center"
              )}
            >
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={userName}
                  className="h-9 w-9 rounded-full object-cover ring-2 ring-primary/20 flex-shrink-0"
                />
              ) : (
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[hsl(var(--sidebar-active))] shadow-md">
                  <span className="text-sm font-bold text-white">{userInitial}</span>
                </div>
              )}
              {!collapsed && (
                <>
                  <div className="flex-1 min-w-0 text-right">
                    <p className="truncate text-sm font-medium text-sidebar-foreground">
                      {userName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {userRole}{userBranch ? ` • ${userBranch}` : ''}
                    </p>
                  </div>
                  <MoreVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-64 [direction:rtl]">
            <div className="px-3 py-2 border-b">
              <p className="text-sm font-medium">{userName}</p>
              <p className="text-xs text-muted-foreground">{profile?.email}</p>
              {!isThiqaSuperAdmin && agent && (() => {
                const isTrial = agent.subscription_status === 'trial' || (agent.monthly_price === 0 && agent.subscription_status === 'active');
                const endDate = agent.subscription_expires_at ? new Date(agent.subscription_expires_at) : null;
                const days = endDate ? Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / 86400000)) : null;
                const trialProgress = isTrial && days !== null ? Math.min(100, ((35 - days) / 35) * 100) : 0;

                return (
                  <div className="mt-1.5 space-y-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={cn(
                        "inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded",
                        isTrial ? 'bg-blue-100 text-blue-700' :
                        agent.subscription_status === 'active' ? 'bg-green-100 text-green-700' :
                        agent.subscription_status === 'paused' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      )}>
                        {isTrial ? 'تجربة مجانية' : agent.plan === 'pro' ? 'Pro' : 'Basic'}
                      </span>
                      {days !== null && (
                        <span className={cn("text-[10px] font-medium",
                          days <= 0 ? "text-destructive" : days <= 7 ? "text-yellow-600" : "text-muted-foreground"
                        )}>
                          {days <= 0 ? 'منتهي' : `${days} يوم متبقي`}
                        </span>
                      )}
                    </div>
                    {isTrial && days !== null && (
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all", days <= 7 ? "bg-destructive" : "bg-blue-500")}
                          style={{ width: `${trialProgress}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            <DropdownMenuItem onClick={() => setProfileOpen(true)} className="gap-2 cursor-pointer">
              <UserCircle className="h-4 w-4" />
              <span>الملف الشخصي</span>
            </DropdownMenuItem>
            {!isThiqaSuperAdmin && (
              <DropdownMenuItem onClick={() => navigate('/subscription')} className="gap-2 cursor-pointer">
                <Settings className="h-4 w-4" />
                <span>الإعدادات</span>
              </DropdownMenuItem>
            )}
            {isAdmin && !isThiqaSuperAdmin && (
              <DropdownMenuItem
                onClick={() => {
                  if (location.pathname === '/' || location.pathname === '') {
                    window.dispatchEvent(new Event('show-onboarding'));
                    return;
                  }

                  navigate('/');
                  setTimeout(() => {
                    window.dispatchEvent(new Event('show-onboarding'));
                  }, 150);
                }}
                className="gap-2 cursor-pointer"
              >
                <HelpCircle className="h-4 w-4" />
                <span>دليل البداية</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              disabled={signingOut}
              className="gap-2 cursor-pointer text-destructive focus:text-destructive"
            >
              {signingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              <span>تسجيل الخروج</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Profile Edit Drawer */}
      <ProfileEditDrawer open={profileOpen} onOpenChange={setProfileOpen} />
    </div>
  );
}

// ============================================================================
// MobileTopBar — fixed top bar on mobile with logo, a profile avatar button
// that opens the profile edit drawer, and a hamburger that opens the nav.
// ============================================================================
function MobileTopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { profile, isAdmin } = useAuth();
  const { data: siteSettings } = useSiteSettings();
  const { isThiqaSuperAdmin } = useAgentContext();
  const [profileOpen, setProfileOpen] = useState(false);

  const userName = profile?.full_name || profile?.email?.split('@')[0] || 'مستخدم';
  const userInitial = (userName.charAt(0) || '?').toUpperCase();

  return (
    <>
      <div
        className="fixed top-0 inset-x-0 z-50 md:hidden h-14 bg-[#122143] flex items-center justify-between px-3 shadow-lg"
        dir="rtl"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {isThiqaSuperAdmin ? (
            <img src={thiqaLogoIcon} alt="Thiqa" className="h-7 w-7 object-contain shrink-0" />
          ) : siteSettings?.logo_url ? (
            <img src={siteSettings.logo_url} alt="Logo" className="h-7 w-7 rounded object-contain shrink-0" />
          ) : (
            <img src={thiqaLogoIcon} alt="ثقة" className="h-7 w-7 object-contain shrink-0" />
          )}
          <span className="text-white/90 text-sm font-semibold truncate">
            {siteSettings?.site_title || 'Thiqa'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
            aria-label="الملف الشخصي"
          >
            <Avatar className="h-8 w-8 border border-white/20">
              {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt={userName} />}
              <AvatarFallback className="bg-white/10 text-white text-xs font-semibold">
                {userInitial}
              </AvatarFallback>
            </Avatar>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white/80 hover:text-white hover:bg-white/10 h-9 w-9"
            onClick={onOpenMenu}
            aria-label="فتح القائمة"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <ProfileEditDrawer open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  );
}

// ============================================================================
// MobileSidebarContent — redesigned mobile nav: light theme, clean rows,
// profile header, inline search, and an always-visible sign out at the bottom.
// The desktop sidebar still uses the dark SidebarContent above.
// ============================================================================
function MobileSidebarContent({ onNavigate }: { onNavigate: () => void }) {
  const [signingOut, setSigningOut] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut, isAdmin, branchName, isSuperAdmin } = useAuth();
  const { data: siteSettings } = useSiteSettings();
  const { hasFeature, isThiqaSuperAdmin } = useAgentContext();

  const filteredGroups = useMemo(() => {
    return navigationGroups
      .filter(group => {
        if (isThiqaSuperAdmin) return group.name === 'إدارة ثقة';
        if (group.adminOnly && !isAdmin) return false;
        return true;
      })
      .map(group => ({
        ...group,
        items: group.items.filter(item => {
          if (isThiqaSuperAdmin) return true;
          if (item.thiqaSuperAdminOnly && !isThiqaSuperAdmin) return false;
          if (item.superAdminOnly && !isSuperAdmin) return false;
          if (item.adminOnly && !isAdmin) return false;
          if (item.featureKey && !hasFeature(item.featureKey)) return false;
          return true;
        }),
      }))
      .filter(group => group.items.length > 0);
  }, [isAdmin, isSuperAdmin, isThiqaSuperAdmin, hasFeature]);

  // Apply text-search filter
  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filteredGroups;
    return filteredGroups
      .map(group => ({
        ...group,
        items: group.items.filter(item => item.name.toLowerCase().includes(q)),
      }))
      .filter(group => group.items.length > 0);
  }, [filteredGroups, query]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  const userName = profile?.full_name || profile?.email?.split('@')[0] || 'مستخدم';
  const userInitial = (userName.charAt(0) || '?').toUpperCase();
  const userRole = isAdmin ? 'مدير' : 'موظف';

  const renderBadge = (item: NavItem) => {
    if (!item.badge) return null;
    if (item.badge === 'notifications') return <SidebarNotificationBadge collapsed={false} />;
    if (item.badge === 'debt') return <SidebarDebtBadge collapsed={false} />;
    if (item.badge === 'tasks') return <SidebarTaskBadge collapsed={false} />;
    if (item.badge === 'claims') return <SidebarClaimsBadge collapsed={false} />;
    if (item.badge === 'accidents') return <SidebarAccidentsBadge collapsed={false} />;
    if (item.badge === 'renewals') return <SidebarRenewalsBadge collapsed={false} />;
    return null;
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      {/* Header: logo + site title. Logo sits on a tinted circle so white
          or light-colored logos stay visible against the white sheet bg.
          Drawer adds its own grab handle above this automatically. */}
      <div className="flex items-center gap-3 px-4 py-3 border-b mt-2">
        <div className="h-11 w-11 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0 p-1.5">
          {isThiqaSuperAdmin ? (
            <img src={thiqaLogo} alt="Thiqa" className="max-h-full max-w-full object-contain" />
          ) : siteSettings?.logo_url ? (
            <img src={siteSettings.logo_url} alt="Logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <img src={thiqaLogoIcon} alt="ثقة" className="max-h-full max-w-full object-contain" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">
            {siteSettings?.site_title || 'Thiqa'}
          </p>
          <p className="text-[11px] text-muted-foreground">نظام إدارة التأمين</p>
        </div>
      </div>

      {/* Profile card */}
      <button
        type="button"
        onClick={() => setProfileOpen(true)}
        className="flex items-center gap-3 px-4 py-3 border-b hover:bg-muted/40 transition-colors text-right"
      >
        <Avatar className="h-11 w-11 border">
          {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt={userName} />}
          <AvatarFallback className="bg-primary/10 text-primary font-semibold">
            {userInitial}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{userName}</p>
          <p className="text-xs text-muted-foreground truncate">
            {userRole}
            {branchName && <span className="mx-1">·</span>}
            {branchName}
          </p>
        </div>
        <ChevronLeft className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>

      {/* Search */}
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن صفحة..."
            className="h-10 pr-9 text-sm"
          />
        </div>
      </div>

      {/* Nav list */}
      <nav className="flex-1 overflow-y-auto p-2">
        {visibleGroups.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            لا توجد نتائج
          </div>
        ) : (
          visibleGroups.map((group) => {
            const GroupIcon = group.icon;
            return (
              <div key={group.name} className="mb-3">
                <div className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-foreground tracking-wide">
                  <GroupIcon className="h-4 w-4 text-muted-foreground" />
                  <span>{group.name}</span>
                </div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActiveRoute = location.pathname === item.href;
                    const ItemIcon = item.icon;
                    return (
                      <NavLink
                        key={item.name}
                        to={item.href}
                        onClick={onNavigate}
                        className={cn(
                          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                          isActiveRoute
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-muted/60 text-foreground"
                        )}
                      >
                        <div
                          className={cn(
                            "h-9 w-9 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                            isActiveRoute
                              ? "bg-primary/15 text-primary"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          <ItemIcon className="h-4 w-4" />
                        </div>
                        <span className="flex-1 truncate">{item.name}</span>
                        {renderBadge(item)}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}

        {/* Account & help — mirrors the desktop profile dropdown so mobile
            users can reach the same links without the profile menu. */}
        {!query && !isThiqaSuperAdmin && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              <UserCircle className="h-3 w-3" />
              <span>الحساب والمساعدة</span>
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  navigate('/subscription');
                  onNavigate();
                }}
                className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted/60 text-foreground text-right"
              >
                <div className="h-9 w-9 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                  <Settings className="h-4 w-4" />
                </div>
                <span className="flex-1 truncate">الإعدادات</span>
              </button>

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    onNavigate();
                    if (location.pathname === '/' || location.pathname === '') {
                      window.dispatchEvent(new Event('show-onboarding'));
                    } else {
                      navigate('/');
                      setTimeout(() => {
                        window.dispatchEvent(new Event('show-onboarding'));
                      }, 150);
                    }
                  }}
                  className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted/60 text-foreground text-right"
                >
                  <div className="h-9 w-9 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                    <HelpCircle className="h-4 w-4" />
                  </div>
                  <span className="flex-1 truncate">دليل البداية</span>
                </button>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* Sign out footer — extra bottom padding so the button clears the
          iOS home indicator / mobile browser chrome. */}
      <div className="px-3 pt-3 pb-6 border-t">
        <Button
          variant="outline"
          onClick={handleSignOut}
          disabled={signingOut}
          className="w-full gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20"
        >
          {signingOut ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4" />
          )}
          تسجيل الخروج
        </Button>
      </div>

      {/* Profile Edit Drawer */}
      <ProfileEditDrawer open={profileOpen} onOpenChange={setProfileOpen} />
    </div>
  );
}

export function Sidebar() {
  const { collapsed, setCollapsed } = useSidebarState();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <>
      {/* Mobile top navbar */}
      <MobileTopBar onOpenMenu={() => setMobileOpen(true)} />

      {/* Mobile nav — vaul-powered bottom drawer with native swipe-to-dismiss */}
      <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
        <DrawerContent className="h-[90vh] max-h-[90vh] p-0 bg-background text-foreground" dir="rtl">
          <MobileSidebarContent onNavigate={() => setMobileOpen(false)} />
        </DrawerContent>
      </Drawer>

      {/* Desktop sidebar - floating with margin */}
      <aside
        className={cn(
          "fixed right-2 top-2 bottom-2 z-40 rounded-2xl border border-white/[0.08] bg-[#122143] transition-all duration-300 shadow-lg hidden md:block overflow-hidden",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <SidebarContent 
          collapsed={collapsed} 
          onCollapse={setCollapsed}
        />
      </aside>
    </>
  );
}

// Export for MainLayout to know sidebar width
export function useSidebarWidth() {
  return { desktop: 256, collapsed: 64 };
}
