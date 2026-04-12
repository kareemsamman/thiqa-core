import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface BranchFormValue {
  name: string;
  name_ar: string;
  is_active: boolean;
  is_default: boolean;
}

export const emptyBranchForm: BranchFormValue = {
  name: "",
  name_ar: "",
  is_active: true,
  is_default: false,
};

interface BranchFormFieldsProps {
  value: BranchFormValue;
  onChange: (value: BranchFormValue) => void;
}

export function BranchFormFields({ value, onChange }: BranchFormFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>اسم الفرع (عربي)</Label>
        <Input
          value={value.name_ar}
          onChange={(e) => onChange({ ...value, name_ar: e.target.value })}
          placeholder="مثال: فرع بيت حنينا"
        />
      </div>
      <div className="space-y-2">
        <Label>اسم الفرع (English)</Label>
        <Input
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="e.g. Beit Hanina Branch"
          dir="ltr"
        />
      </div>
      <div className="flex items-center justify-between">
        <Label>فعال</Label>
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
