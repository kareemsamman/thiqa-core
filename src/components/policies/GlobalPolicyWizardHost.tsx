import { PolicyWizard } from "./PolicyWizard";
import { usePolicyWizardController } from "@/hooks/usePolicyWizardController";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useAuth } from "@/hooks/useAuth";

export function GlobalPolicyWizardHost() {
  const { user } = useAuth();
  const { isThiqaSuperAdmin } = useAgentContext();
  const {
    instances,
    activeId,
    closeInstance,
    minimizeInstance,
    setInstanceDraft,
  } = usePolicyWizardController();

  if (!user || isThiqaSuperAdmin) return null;

  // Render every instance, keyed by id so each keeps its own React state
  // across activation/minimization. Only the instance matching activeId
  // renders its dialog; the rest stay mounted but render null inside
  // PolicyWizard (`isCollapsed` path), so their wizard state survives.
  return (
    <>
      {instances.map((instance) => (
        <PolicyWizard
          key={instance.id}
          open={activeId === instance.id}
          isCollapsed={activeId !== instance.id}
          onOpenChange={(open) => {
            if (!open) closeInstance(instance.id);
          }}
          onMinimize={(origin) => minimizeInstance(instance.id, origin)}
          onComplete={() => {
            window.dispatchEvent(new CustomEvent("thiqa:policy-created"));
          }}
          preselectedClientId={instance.preselectedClientId}
          onDraftSummaryChange={(summary) =>
            setInstanceDraft(instance.id, summary)
          }
        />
      ))}
    </>
  );
}
