import { useState, useEffect } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
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
import { Sheet, SheetContent } from "@/components/ui/sheet";
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
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full px-3 py-2 text-sm font-semibold text-sidebar-foreground/60 hover:text-sidebar-foreground/80 hover:bg-[hsl(var(--sidebar-glass-bg))] rounded-lg transition-all duration-200 uppercase tracking-wide">
                <div className="flex items-center gap-2">
                  <GroupIcon className="h-3.5 w-3.5" />
                  <span>{group.name}</span>
                </div>
                <ChevronDown 
                  className={cn(
                    "h-3 w-3 transition-transform duration-300 text-sidebar-foreground/30",
                    isOpen && "rotate-180 text-[hsl(var(--sidebar-active))]/60"
                  )} 
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-0.5 mr-2 space-y-0.5">
                {group.items.map((item) => {
                  const isActiveRoute = location.pathname === item.href;
                  return (
                    <NavLink
                      key={item.name}
                      to={item.href}
                      onClick={handleNavClick}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium transition-all duration-200 relative group",
                        isActiveRoute
                          ? "glass-dark bg-[hsl(var(--sidebar-active))]/10 text-[hsl(var(--sidebar-active))] border-r-2 border-[hsl(var(--sidebar-active))]"
                          : "text-sidebar-foreground hover:bg-[hsl(var(--sidebar-glass-bg))] hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <item.icon className={cn("h-4 w-4 flex-shrink-0 transition-colors", isActiveRoute ? "text-[hsl(var(--sidebar-active))]" : "group-hover:text-sidebar-accent-foreground")} />
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
              "w-full justify-center text-muted-foreground hover:text-foreground",
              collapsed && "px-2"
            )}
          >
            {collapsed ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <>
                <ChevronRight className="h-4 w-4" />
                <span className="mr-2">تصغير</span>
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
                <CreditCard className="h-4 w-4" />
                <span>الاشتراك</span>
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
      <div className="fixed top-0 inset-x-0 z-50 md:hidden h-14 bg-[#122143] flex items-center justify-between px-4 shadow-lg" dir="rtl">
        <div className="flex items-center gap-2.5">
          <img src={thiqaLogoIcon} alt="Thiqa" className="h-7 w-7 object-contain" />
          <span className="text-white/90 text-sm font-semibold">Thiqa</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-white/80 hover:text-white hover:bg-white/10 h-9 w-9"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent 
          side="right" 
          className="w-64 p-0 border-l bg-[#122143] border-white/[0.08] text-white/85"
        >
          <SidebarContent 
            collapsed={false} 
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

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
