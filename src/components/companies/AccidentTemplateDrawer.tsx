import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AccidentTemplateTab } from "./AccidentTemplateTab";
import type { Tables } from "@/integrations/supabase/types";

type Company = Tables<"insurance_companies">;

interface AccidentTemplateDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
}

export function AccidentTemplateDrawer({
  open,
  onOpenChange,
  company,
}: AccidentTemplateDrawerProps) {
  if (!company) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-2xl overflow-y-auto" dir="rtl">
        <SheetHeader className="mb-6">
          <SheetTitle className="text-right">
            قالب بلاغ الحادث - {company.name_ar || company.name}
          </SheetTitle>
        </SheetHeader>

        <AccidentTemplateTab companyId={company.id} />
      </SheetContent>
    </Sheet>
  );
}
