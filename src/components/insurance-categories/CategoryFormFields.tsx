import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Car, FileText } from "lucide-react";

export interface CategoryFormValue {
  name: string;
  name_ar: string;
  name_he: string;
  slug: string;
  mode: "FULL" | "LIGHT";
  is_active: boolean;
  is_default: boolean;
}

export const emptyCategoryForm: CategoryFormValue = {
  name: "",
  name_ar: "",
  name_he: "",
  slug: "",
  mode: "LIGHT",
  is_active: true,
  is_default: false,
};

interface CategoryFormFieldsProps {
  value: CategoryFormValue;
  onChange: (value: CategoryFormValue) => void;
  slugLocked?: boolean;
}

export function CategoryFormFields({ value, onChange, slugLocked }: CategoryFormFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 space-y-2">
          <Label>الاسم (إنجليزي) *</Label>
          <Input
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder="Car Insurance"
            className="ltr-input"
          />
        </div>
        <div className="space-y-2">
          <Label>الاسم (عربي)</Label>
          <Input
            value={value.name_ar}
            onChange={(e) => onChange({ ...value, name_ar: e.target.value })}
            placeholder="تأمين السيارات"
          />
        </div>
        <div className="space-y-2">
          <Label>الاسم (عبري)</Label>
          <Input
            value={value.name_he}
            onChange={(e) => onChange({ ...value, name_he: e.target.value })}
            placeholder="ביטוח רכב"
            dir="rtl"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>المعرف (Slug) *</Label>
        <Input
          value={value.slug}
          onChange={(e) =>
            onChange({ ...value, slug: e.target.value.toUpperCase().replace(/[^A-Z_]/g, "") })
          }
          placeholder="NEW_TYPE"
          className="ltr-input"
          disabled={slugLocked}
        />
        <p className="text-xs text-muted-foreground">
          معرف فريد بالإنجليزية الكبيرة (لا يمكن تغييره لاحقاً)
        </p>
      </div>

      <div className="space-y-2">
        <Label>نوع المعالجة</Label>
        <Select
          value={value.mode}
          onValueChange={(v: "FULL" | "LIGHT") => onChange({ ...value, mode: v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="FULL">
              <div className="flex items-center gap-2">
                <Car className="h-4 w-4" />
                FULL - تأمين كامل مع سيارة
              </div>
            </SelectItem>
            <SelectItem value="LIGHT">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                LIGHT - تأمين بسيط
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label>نشط</Label>
        <Switch
          checked={value.is_active}
          onCheckedChange={(checked) => onChange({ ...value, is_active: checked })}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label>افتراضي</Label>
        <Switch
          checked={value.is_default}
          onCheckedChange={(checked) => onChange({ ...value, is_default: checked })}
        />
      </div>
    </div>
  );
}
