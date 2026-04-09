import { useState } from "react";
import { useAgentContext } from "@/hooks/useAgentContext";
import { ThaqibButton } from "./ThaqibButton";
import { ThaqibPanel } from "./ThaqibPanel";

export function ThaqibWidget() {
  const { hasFeature, isThiqaSuperAdmin } = useAgentContext();
  const [open, setOpen] = useState(false);

  if (isThiqaSuperAdmin || !hasFeature("ai_assistant")) return null;

  return (
    <>
      <ThaqibButton onClick={() => setOpen(true)} visible={!open} />
      <ThaqibPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
