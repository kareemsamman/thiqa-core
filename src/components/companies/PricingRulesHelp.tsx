import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Info, ChevronDown, Car } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Collapsible help panel explaining how pricing rules compose into a
 * policy's profit. Lives on top of the pricing rules table inside
 * PricingRulesDrawer. Worked examples are the important part — the
 * rule names alone don't tell an agent what will happen.
 */
export function PricingRulesHelp() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5">
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-auto py-3 px-4 flex items-center justify-between gap-2 hover:bg-primary/10"
      >
        <div className="flex items-center gap-2 text-right">
          <div className="rounded-lg bg-primary/10 p-1.5">
            <Info className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm text-foreground">كيف تعمل قواعد التسعير؟</p>
            <p className="text-xs text-muted-foreground">شرح سريع + أمثلة لحساب الربح</p>
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </Button>

      {open && (
        <div className="border-t border-primary/15 p-4 space-y-5 text-sm">
          {/* Rule type definitions */}
          <section className="space-y-3">
            <h4 className="font-semibold text-foreground">أنواع القواعد</h4>
            <div className="grid gap-2.5">
              <RuleRow
                label="THIRD_PRICE"
                arabic="سعر الطرف الثالث"
                desc="المبلغ الذي يأخذه مُلزِم/الشركة عن معاملة من نوع «ثالث». الربح = سعر التأمين − قيمة هذه القاعدة."
              />
              <RuleRow
                label="FULL_PERCENT"
                arabic="نسبة الشامل"
                desc="نسبة مئوية من قيمة السيارة تأخذها شركة التأمين للمعاملات الشاملة. يمكن تحديد نطاق قيمة السيارة (من/إلى) لنسب مختلفة."
              />
              <RuleRow
                label="DISCOUNT"
                arabic="الخصم"
                desc="مبلغ ثابت يُخصم من المستحق للشركة في المعاملات الشاملة — أي يزيد من ربح الوكيل."
              />
              <RuleRow
                label="MIN_PRICE"
                arabic="الحد الأدنى"
                desc="أدنى سعر يمكن بيع الشامل به. إذا خرج الحساب أقل منه يُرفع إلى هذا الحد."
              />
              <RuleRow
                label="ROAD_SERVICE_*"
                arabic="خدمات الطريق"
                desc="أسعار أساسية وإضافات خدمات الطريق (مثلاً رسم إضافي للسيارات قبل 2007)."
              />
            </div>
          </section>

          {/* Example 1: Private car THIRD */}
          <section className="rounded-lg border bg-card p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Car className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h4 className="font-semibold text-foreground">مثال 1 — خصوصي، ثالث</h4>
            </div>
            <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">القاعدة:</span>
              <span><Badge variant="outline" className="mr-0.5">THIRD_PRICE</Badge> = ₪700 للخصوصي، كل الأعمار</span>
              <span className="font-medium text-foreground">سعر البيع:</span>
              <span className="ltr-nums">₪1,200</span>
              <span className="font-medium text-foreground">المعادلة:</span>
              <span className="ltr-nums">1,200 − 700 = <strong className="text-success">₪500 ربح</strong></span>
            </div>
          </section>

          {/* Example 2: Private car FULL */}
          <section className="rounded-lg border bg-card p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Car className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h4 className="font-semibold text-foreground">مثال 2 — خصوصي، شامل</h4>
            </div>
            <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">القواعد:</span>
              <span>
                <Badge variant="outline">FULL_PERCENT</Badge> 1.75% للسيارات ≤ ₪100,000 ·
                <Badge variant="outline" className="mr-1">DISCOUNT</Badge> ₪700 ·
                <Badge variant="outline" className="mr-1">MIN_PRICE</Badge> ₪1,200
              </span>
              <span className="font-medium text-foreground">قيمة السيارة:</span>
              <span className="ltr-nums">₪80,000</span>
              <span className="font-medium text-foreground">الحساب:</span>
              <span className="ltr-nums leading-6">
                80,000 × 1.75% = 1,400 ← مستحق الشركة<br />
                1,400 − 700 (خصم) = 700<br />
                لكن 700 أقل من MIN_PRICE → يُرفع إلى 1,200
              </span>
              <span className="font-medium text-foreground">سعر البيع:</span>
              <span className="ltr-nums">₪1,800 → <strong className="text-success">₪600 ربح</strong></span>
            </div>
          </section>

          {/* Example 3: Commercial */}
          <section className="rounded-lg border bg-card p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Car className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <h4 className="font-semibold text-foreground">مثال 3 — تجاري أقل من 4 طن، ثالث</h4>
            </div>
            <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">القاعدة:</span>
              <span><Badge variant="outline" className="mr-0.5">THIRD_PRICE</Badge> = ₪1,300</span>
              <span className="font-medium text-foreground">سعر البيع:</span>
              <span className="ltr-nums">₪1,800</span>
              <span className="font-medium text-foreground">المعادلة:</span>
              <span className="ltr-nums">1,800 − 1,300 = <strong className="text-success">₪500 ربح</strong></span>
            </div>
          </section>

          <p className="text-xs text-muted-foreground leading-5">
            ملاحظة: القواعد تُطابَق حسب «نوع السيارة + الفئة العمرية» أولاً،
            ثم يتم الرجوع للقواعد العامة إذا لم يوجد تطابق دقيق. إن لم توجد
            أي قاعدة لشركة ما، يُعتبر كامل سعر البيع ربحاً.
          </p>
        </div>
      )}
    </div>
  );
}

function RuleRow({ label, arabic, desc }: { label: string; arabic: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md bg-card p-2.5 border">
      <Badge variant="outline" className="font-mono text-[11px] shrink-0">{label}</Badge>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">{arabic}</p>
        <p className="text-xs text-muted-foreground leading-5 mt-0.5">{desc}</p>
      </div>
    </div>
  );
}
