import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { cn } from "@/lib/utils";
import { digitsOnly } from "@/lib/validation";
import type { NewClientForm, ValidationErrors } from "./types";

interface CreateClientFormProps {
  form: NewClientForm;
  onChange: (field: keyof NewClientForm, value: string) => void;
  errors: ValidationErrors;
  checkingDuplicate?: boolean;
}

export function CreateClientForm({ form, onChange, errors, checkingDuplicate }: CreateClientFormProps) {
  return (
    <div className="space-y-4 p-4 bg-muted/30 rounded-xl border">
      <h4 className="font-semibold text-sm">إنشاء عميل جديد</h4>
      
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Full Name */}
        <div className="space-y-1.5">
          <Label className="text-sm">
            الاسم الكامل <span className="text-destructive">*</span>
          </Label>
          <Input
            value={form.full_name}
            onChange={(e) => onChange('full_name', e.target.value)}
            placeholder="أدخل الاسم الكامل"
            className={cn(errors.full_name && "border-destructive")}
          />
          {errors.full_name && (
            <p className="text-xs text-destructive">{errors.full_name}</p>
          )}
        </div>
        
        {/* ID Number */}
        <div className="space-y-1.5">
          <Label className="text-sm">
            رقم الهوية <span className="text-destructive">*</span>
          </Label>
          <Input
            value={form.id_number}
            onChange={(e) => onChange('id_number', digitsOnly(e.target.value).slice(0, 9))}
            placeholder="9 أرقام"
            maxLength={9}
            className={cn("ltr-input", errors.id_number && "border-destructive")}
          />
          {checkingDuplicate && (
            <p className="text-xs text-muted-foreground">جاري التحقق...</p>
          )}
          {errors.id_number && (
            <p className="text-xs text-destructive">{errors.id_number}</p>
          )}
        </div>
        
        {/* Birth Date */}
        <div className="space-y-1.5">
          <Label className="text-sm">تاريخ الميلاد</Label>
          <ArabicDatePicker
            value={form.birth_date}
            onChange={(date) => onChange('birth_date', date)}
            placeholder="اختر التاريخ"
            isBirthDate
          />
        </div>
        
        {/* Phone 1 */}
        <div className="space-y-1.5">
          <Label className="text-sm">
            رقم الهاتف <span className="text-destructive">*</span>
          </Label>
          <Input
            value={form.phone_number}
            onChange={(e) => onChange('phone_number', digitsOnly(e.target.value).slice(0, 10))}
            placeholder="10 أرقام"
            maxLength={10}
            className={cn("ltr-input", errors.phone_number && "border-destructive")}
          />
          {errors.phone_number && (
            <p className="text-xs text-destructive">{errors.phone_number}</p>
          )}
        </div>
        
        {/* Phone 2 */}
        <div className="space-y-1.5">
          <Label className="text-sm">هاتف إضافي (اختياري)</Label>
          <Input
            value={form.phone_number_2}
            onChange={(e) => onChange('phone_number_2', digitsOnly(e.target.value).slice(0, 10))}
            placeholder="10 أرقام"
            maxLength={10}
            className={cn("ltr-input", errors.phone_number_2 && "border-destructive")}
          />
          {errors.phone_number_2 && (
            <p className="text-xs text-destructive">{errors.phone_number_2}</p>
          )}
        </div>
        
        {/* Under 24 Type */}
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-sm">أقل من 24 سنة</Label>
          <Select
            value={form.under24_type}
            onValueChange={(v) => onChange('under24_type', v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">لا</SelectItem>
              <SelectItem value="client">نعم – العميل نفسه أقل من 24</SelectItem>
              <SelectItem value="additional_driver">نعم – سائق إضافي (ابن/ابنة) أقل من 24</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {/* Additional Driver Fields */}
        {form.under24_type === 'additional_driver' && (
          <>
            <div className="space-y-1.5">
              <Label className="text-sm">
                اسم السائق الإضافي <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.under24_driver_name}
                onChange={(e) => onChange('under24_driver_name', e.target.value)}
                placeholder="اسم السائق"
                className={cn(errors.under24_driver_name && "border-destructive")}
              />
              {errors.under24_driver_name && (
                <p className="text-xs text-destructive">{errors.under24_driver_name}</p>
              )}
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-sm">
                رقم هوية السائق <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.under24_driver_id}
                onChange={(e) => onChange('under24_driver_id', digitsOnly(e.target.value).slice(0, 9))}
                placeholder="9 أرقام"
                maxLength={9}
                className={cn("ltr-input", errors.under24_driver_id && "border-destructive")}
              />
              {errors.under24_driver_id && (
                <p className="text-xs text-destructive">{errors.under24_driver_id}</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
