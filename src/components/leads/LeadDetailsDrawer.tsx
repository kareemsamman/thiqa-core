import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { MessageSquare, X } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { LeadChatView } from "./LeadChatView";
import { LeadInfoBanner } from "./LeadInfoBanner";

interface Lead {
  id: string;
  phone: string;
  customer_name: string | null;
  car_number: string | null;
  car_manufacturer: string | null;
  car_model: string | null;
  car_year: string | null;
  car_color: string | null;
  insurance_types: string[] | null;
  driver_over_24: boolean | null;
  has_accidents: boolean | null;
  total_price: number | null;
  status: string;
  notes: string | null;
  source: string | null;
  requires_callback?: boolean | null;
  created_at: string;
  updated_at: string;
}

interface LeadDetailsDrawerProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusOptions = [
  { value: "new", label: "جديد", color: "bg-blue-500" },
  { value: "contacted", label: "تم التواصل", color: "bg-yellow-500" },
  { value: "converted", label: "تم التحويل", color: "bg-green-500" },
  { value: "rejected", label: "مرفوض", color: "bg-red-500" },
];

export function LeadDetailsDrawer({
  lead,
  open,
  onOpenChange,
}: LeadDetailsDrawerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentLead, setCurrentLead] = useState<Lead | null>(lead);

  // Update current lead when prop changes
  useEffect(() => {
    if (lead) {
      setCurrentLead(lead);
    }
  }, [lead]);

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const { error } = await supabase
        .from("leads")
        .update({ status: newStatus })
        .eq("id", lead!.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast({
        title: "تم تحديث الحالة",
        description: "تم تحديث حالة العميل المحتمل بنجاح",
      });
    },
    onError: (error) => {
      toast({
        title: "خطأ",
        description: "فشل تحديث الحالة: " + error.message,
        variant: "destructive",
      });
    },
  });

  const handleStatusChange = (newStatus: string) => {
    if (currentLead) {
      setCurrentLead({ ...currentLead, status: newStatus });
    }
    updateStatusMutation.mutate(newStatus);
  };

  const handleSyncComplete = (requiresCallback: boolean) => {
    if (currentLead && requiresCallback) {
      setCurrentLead({ ...currentLead, requires_callback: true });
    }
    // Refresh lead data
    queryClient.invalidateQueries({ queryKey: ["leads"] });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = statusOptions.find((s) => s.value === status);
    return (
      <Badge
        variant="outline"
        className={`${statusConfig?.color} text-white border-0`}
      >
        {statusConfig?.label || status}
      </Badge>
    );
  };

  if (!currentLead) return null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh] h-[85vh] flex flex-col max-w-lg mx-auto">
        {/* WhatsApp-style Header */}
        <DrawerHeader className="border-b bg-[#075e54] text-white p-0">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <DrawerTitle className="text-lg text-white">
                  {currentLead.customer_name || currentLead.phone}
                </DrawerTitle>
                <DrawerDescription className="text-white/70 text-xs flex items-center gap-2">
                  {currentLead.source || "whatsapp"}
                  <span>•</span>
                  {format(new Date(currentLead.created_at), "PP", { locale: ar })}
                </DrawerDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {getStatusBadge(currentLead.status)}
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </DrawerHeader>

        {/* Info Banner */}
        <LeadInfoBanner
          lead={currentLead}
          onStatusChange={handleStatusChange}
          isUpdating={updateStatusMutation.isPending}
        />

        {/* Chat View - Main Content */}
        <div className="flex-1 overflow-hidden min-h-[400px]">
          <LeadChatView
            leadId={currentLead.id}
            phone={currentLead.phone}
            onSyncComplete={handleSyncComplete}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
