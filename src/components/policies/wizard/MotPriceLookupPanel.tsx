import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Copy, Minus, X, Maximize2, ExternalLink, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const MOT_URL = "https://carlistprice.mot.gov.il/";

export interface MotCarInfo {
  manufacturer: string;
  model: string;
  year: string;
  carNumber?: string;
  trimLevel?: string;
  ownership?: string;
}

interface Props {
  open: boolean;
  minimized: boolean;
  carInfo: MotCarInfo;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}

export function MotPriceLookupPanel({
  open,
  minimized,
  carInfo,
  onMinimize,
  onMaximize,
  onClose,
}: Props) {
  const { toast } = useToast();

  if (!open) return null;

  const copy = async (label: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: "تم النسخ", description: `${label}: ${value}` });
    } catch {
      toast({ title: "تعذر النسخ", variant: "destructive" });
    }
  };

  const copyAll = async () => {
    const parts = [
      carInfo.manufacturer && `الشركة: ${carInfo.manufacturer}`,
      carInfo.model && `الموديل: ${carInfo.model}`,
      carInfo.year && `السنة: ${carInfo.year}`,
      carInfo.carNumber && `رقم السيارة: ${carInfo.carNumber}`,
      carInfo.trimLevel && `مستوى التجهيز: ${carInfo.trimLevel}`,
      carInfo.ownership && `نوع الملكية: ${carInfo.ownership}`,
    ].filter(Boolean);
    if (parts.length === 0) {
      toast({ title: "لا توجد بيانات سيارة للنسخ", variant: "destructive" });
      return;
    }
    try {
      await navigator.clipboard.writeText(parts.join("\n"));
      toast({ title: "تم نسخ كل المعلومات" });
    } catch {
      toast({ title: "تعذر النسخ", variant: "destructive" });
    }
  };

  const summary = [carInfo.manufacturer, carInfo.model, carInfo.year]
    .filter(Boolean)
    .join(" / ");

  return createPortal(
    <>
      {!minimized && (
        <div
          className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm pointer-events-auto"
          onClick={onMinimize}
        />
      )}
      <div
        className={cn(
          "fixed z-[100] bg-background border shadow-2xl flex flex-col pointer-events-auto",
          minimized
            ? "bottom-4 left-4 w-[320px] rounded-lg overflow-hidden"
            : "inset-2 sm:inset-4 lg:inset-8 rounded-xl overflow-hidden"
        )}
        dir="rtl"
      >
        <div
          className={cn(
            "flex items-center justify-between px-4 py-2.5 border-b bg-muted/40 shrink-0",
            minimized && "cursor-pointer hover:bg-muted/60"
          )}
          onClick={() => {
            if (minimized) onMaximize();
          }}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Search className="h-4 w-4 text-primary shrink-0" />
            <span className="font-semibold text-sm truncate">
              מחירון משרד התחבורה
            </span>
            {minimized && summary && (
              <span className="text-xs text-muted-foreground truncate">
                ({summary})
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!minimized ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onMinimize}
                className="h-8 w-8 p-0"
                title="تصغير"
              >
                <Minus className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onMaximize();
                }}
                className="h-8 w-8 p-0"
                title="تكبير"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="h-8 w-8 p-0"
              title="إغلاق"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div
          className={cn(
            "flex flex-col flex-1 min-h-0",
            minimized && "hidden"
          )}
        >
          <div className="p-4 border-b bg-muted/20 space-y-3 shrink-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-sm font-semibold">معلومات السيارة من الفورم</h3>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={copyAll}>
                  <Copy className="h-3.5 w-3.5 ml-1.5" />
                  نسخ الكل
                </Button>
                <a
                  href={MOT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  فتح في tab جديد
                </a>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <CopyField
                label="الشركة المصنعة"
                value={carInfo.manufacturer}
                onCopy={(v) => copy("الشركة المصنعة", v)}
              />
              <CopyField
                label="الموديل"
                value={carInfo.model}
                onCopy={(v) => copy("الموديل", v)}
              />
              <CopyField
                label="السنة"
                value={carInfo.year}
                onCopy={(v) => copy("السنة", v)}
              />
              <CopyField
                label="رقم السيارة"
                value={carInfo.carNumber || ""}
                onCopy={(v) => copy("رقم السيارة", v)}
              />
              <CopyField
                label="مستوى التجهيز"
                value={carInfo.trimLevel || ""}
                onCopy={(v) => copy("مستوى التجهيز", v)}
              />
              <CopyField
                label="نوع الملكية"
                value={carInfo.ownership || ""}
                onCopy={(v) => copy("نوع الملكية", v)}
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 bg-white">
            <iframe
              src={MOT_URL}
              className="w-full h-full border-0"
              title="מחירון משרד התחבורה"
            />
          </div>

          <div className="px-4 py-2 border-t bg-muted/20 text-xs text-muted-foreground shrink-0">
            انسخ المعلومات أعلاه، الصقها داخل النموذج بالموقع، حلّ الـ captcha، ثم خذ السعر الذي يظهر واكتبه في حقل "قيمة السيارة".
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

function CopyField({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: (v: string) => void;
}) {
  return (
    <div className="space-y-1 min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center gap-1.5 bg-background border rounded px-2 py-1.5">
        <span className="flex-1 text-sm truncate">{value || "—"}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 shrink-0"
          onClick={() => onCopy(value)}
          disabled={!value}
          title="نسخ"
        >
          <Copy className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
