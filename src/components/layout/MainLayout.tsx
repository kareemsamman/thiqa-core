import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { BottomToolbar } from "./BottomToolbar";
import { AnnouncementPopup } from "./AnnouncementPopup";
import { TaskPopupReminder } from "@/components/tasks/TaskPopupReminder";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { ThaqibWidget } from "@/components/ai-assistant/ThaqibWidget";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useSidebarState } from "@/hooks/useSidebarState";
import { Button } from "@/components/ui/button";
import { ArrowRight, Building2 } from "lucide-react";

interface MainLayoutProps {
  children: ReactNode;
  onPolicyComplete?: () => void;
}

export function MainLayout({ children, onPolicyComplete }: MainLayoutProps) {
  const { isThiqaSuperAdmin, isImpersonating, impersonatedAgent, stopImpersonation } = useAgentContext();
  const { collapsed } = useSidebarState();
  const navigate = useNavigate();

  const handleExitImpersonation = () => {
    stopImpersonation();
    navigate('/thiqa');
  };

  // Desktop sidebar: 64px collapsed (w-16) + 8px gap, 256px expanded (w-64) + 8px gap
  const sidebarMargin = collapsed ? 'md:mr-[4.5rem]' : 'md:mr-[17.5rem]';

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Impersonation banner */}
      {isImpersonating && impersonatedAgent && (
        <div className="fixed top-0 inset-x-0 z-[60] bg-[#122143] text-white h-10 flex items-center justify-between px-4 shadow-md" dir="rtl">
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="h-4 w-4" />
            <span>أنت تتصفح نظام الوكيل:</span>
            <span className="font-bold">{impersonatedAgent.name_ar || impersonatedAgent.name}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-white/30 text-white hover:bg-white/10 gap-1"
            onClick={handleExitImpersonation}
          >
            <ArrowRight className="h-3 w-3" />
            العودة للوحة ثقة
          </Button>
        </div>
      )}

      <Sidebar />

      {/* Main content - responsive margins */}
      <main className={`min-h-screen transition-all duration-300 p-3 pt-[3.75rem] md:pt-6 md:p-6 ${sidebarMargin} ${isThiqaSuperAdmin ? 'pb-6' : 'pb-40'} ${isImpersonating ? 'mt-10' : ''}`}>
        <div className="max-w-full">{children}</div>
      </main>

      {/* Sticky bottom toolbar - hidden for Thiqa super admin */}
      {!isThiqaSuperAdmin && <BottomToolbar onPolicyComplete={onPolicyComplete} />}

      {/* Announcement popup */}
      {!isThiqaSuperAdmin && <AnnouncementPopup />}

      {/* Task reminder popup */}
      {!isThiqaSuperAdmin && <TaskPopupReminder />}

      {/* Onboarding wizard */}
      {!isThiqaSuperAdmin && <OnboardingWizard />}

      {/* AI Assistant */}
      <ThaqibWidget />
    </div>
  );
}