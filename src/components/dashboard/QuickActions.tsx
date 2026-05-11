import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Plus, Lock, Search, Calculator } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useAgentLimits } from "@/hooks/useAgentLimits";
import { usePermissions } from "@/hooks/usePermissions";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { usePolicyWizardController } from "@/hooks/usePolicyWizardController";

export function QuickActions() {
  const navigate = useNavigate();
  const { openWizard } = usePolicyWizardController();
  const { hasFeature } = useAgentContext();
  const { policies: policiesLimit, loading: limitsLoading } = useAgentLimits();
  const { can, loading: permLoading } = usePermissions();
  const { showUpgradePrompt } = useUpgradePrompt();

  const policiesLocked = !limitsLoading && policiesLimit.exceeded;
  const accountingFeature = hasFeature("accounting");
  // Hide the chip entirely when the worker lacks page.accounting —
  // matches sidebar behavior. Plan-level lock still applies on top.
  const showAccounting = !permLoading && can("page.accounting");

  const onNewPolicy = () => {
    if (limitsLoading) return;
    if (policiesLocked) {
      showUpgradePrompt({
        resource: "policies",
        current: policiesLimit.used,
        limit: policiesLimit.effective ?? 0,
      });
      return;
    }
    openWizard({});
  };

  const onAccounting = () => {
    if (accountingFeature) {
      navigate("/accounting");
    } else {
      showUpgradePrompt({ featureKey: "accounting", featureLabel: "المحاسبة" });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm font-medium text-muted-foreground shrink-0 ml-1">إجراءات سريعة:</span>

      <Chip onClick={onNewPolicy} locked={policiesLocked} tone="foreground" Icon={policiesLocked ? Lock : Plus}>
        معاملة جديدة
      </Chip>

      <Chip onClick={() => navigate("/clients")} tone="blue" Icon={Search}>
        بحث عن عميل
      </Chip>

      {showAccounting && (
        <Chip onClick={onAccounting} locked={!accountingFeature} tone="amber" Icon={accountingFeature ? Calculator : Lock}>
          المحاسبة
        </Chip>
      )}
    </div>
  );
}

function Chip({
  children,
  onClick,
  Icon,
  tone,
  locked,
}: {
  children: React.ReactNode;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  tone: "foreground" | "blue" | "amber";
  locked?: boolean;
}) {
  const toneClass = locked
    ? "border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 bg-transparent"
    : tone === "foreground"
    ? "bg-foreground text-background hover:bg-foreground/90"
    : tone === "blue"
    ? "bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20 border border-blue-500/20"
    : "bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 border border-amber-500/20";

  return (
    <Button
      onClick={onClick}
      variant={locked ? "outline" : "default"}
      className={cn("h-10 px-4 rounded-full gap-2 shadow-sm text-sm font-medium", toneClass)}
    >
      <Icon className="h-4 w-4" />
      {children}
    </Button>
  );
}
