import { PolicyWizard } from "./PolicyWizard";
import { usePolicyWizardController } from "@/hooks/usePolicyWizardController";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useAuth } from "@/hooks/useAuth";

export function GlobalPolicyWizardHost() {
  const { user } = useAuth();
  const { isThiqaSuperAdmin } = useAgentContext();
  const {
    isOpen,
    isCollapsed,
    preselectedClientId,
    closeWizard,
    setCollapsed,
  } = usePolicyWizardController();

  if (!user || isThiqaSuperAdmin) return null;

  return (
    <PolicyWizard
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) closeWizard();
      }}
      onComplete={() => {
        window.dispatchEvent(new CustomEvent("thiqa:policy-created"));
      }}
      isCollapsed={isCollapsed}
      onCollapsedChange={setCollapsed}
      preselectedClientId={preselectedClientId}
    />
  );
}
