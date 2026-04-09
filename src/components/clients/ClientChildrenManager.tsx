import { useState } from "react";
import { Plus, Trash2, AlertCircle, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { digitsOnly, isValidIsraeliId } from "@/lib/validation";
import { ClientChild, NewChildForm, RELATION_OPTIONS, createEmptyChildForm } from "@/types/clientChildren";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ClientChildrenManagerProps {
  existingChildren: ClientChild[];
  newChildren: NewChildForm[];
  onNewChildrenChange: (children: NewChildForm[]) => void;
  onRemoveExisting?: (childId: string) => void;
  onExistingChildUpdated?: (updatedChild: ClientChild) => void;
  linkedChildIds?: string[]; // IDs of children linked to policies (cannot delete)
  compact?: boolean;
}

interface EditingChild {
  id: string;
  full_name: string;
  id_number: string;
  relation: string;
  phone: string;
  birth_date: string;
}

export function ClientChildrenManager({
  existingChildren,
  newChildren,
  onNewChildrenChange,
  onRemoveExisting,
  onExistingChildUpdated,
  linkedChildIds = [],
  compact = false,
}: ClientChildrenManagerProps) {
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});
  const [editingChildId, setEditingChildId] = useState<string | null>(null);
  const [editingData, setEditingData] = useState<EditingChild | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const validateChild = (child: NewChildForm, allNewChildren: NewChildForm[]): Record<string, string> => {
    const childErrors: Record<string, string> = {};
    
    if (!child.full_name.trim()) {
      childErrors.full_name = "الاسم مطلوب";
    }
    
    if (!child.id_number.trim()) {
      childErrors.id_number = "رقم الهوية مطلوب";
    } else if (!isValidIsraeliId(child.id_number)) {
      childErrors.id_number = "رقم هوية غير صالح";
    }
    
    const normalized = digitsOnly(child.id_number).trim();

    // Check for duplicate ID within new children
    const duplicateInNew = allNewChildren.some(
      c => c.id !== child.id && digitsOnly(c.id_number).trim() === normalized
    );
    
    // Check for duplicate ID within existing children
    const duplicateInExisting = existingChildren.some(
      c => digitsOnly(c.id_number).trim() === normalized
    );
    
    if (duplicateInNew || duplicateInExisting) {
      childErrors.id_number = "رقم الهوية مكرر";
    }
    
    return childErrors;
  };

  const handleAddChild = () => {
    onNewChildrenChange([...newChildren, createEmptyChildForm()]);
  };

  const handleUpdateChild = (index: number, field: keyof NewChildForm, value: string) => {
    const updated = [...newChildren];
    updated[index] = { ...updated[index], [field]: value };
    onNewChildrenChange(updated);
    
    // Recompute errors for all rows to keep duplicate validation in sync
    const nextErrors: Record<string, Record<string, string>> = {};
    for (const c of updated) {
      nextErrors[c.id] = validateChild(c, updated);
    }
    setErrors(nextErrors);
  };

  const handleRemoveNewChild = (index: number) => {
    const updated = newChildren.filter((_, i) => i !== index);
    onNewChildrenChange(updated);

    const nextErrors: Record<string, Record<string, string>> = {};
    for (const c of updated) {
      nextErrors[c.id] = validateChild(c, updated);
    }
    setErrors(nextErrors);
  };

  const isChildLinked = (childId: string) => linkedChildIds.includes(childId);

  // Start editing an existing child
  const handleStartEdit = (child: ClientChild) => {
    setEditingChildId(child.id);
    setEditingData({
      id: child.id,
      full_name: child.full_name,
      id_number: child.id_number,
      relation: child.relation || 'سائق إضافي',
      phone: child.phone || '',
      birth_date: child.birth_date || '',
    });
  };

  // Cancel editing
  const handleCancelEdit = () => {
    setEditingChildId(null);
    setEditingData(null);
  };

  // Save edited child
  const handleSaveEdit = async () => {
    if (!editingData) return;
    
    // Validate
    if (!editingData.full_name.trim()) {
      toast.error('الاسم مطلوب');
      return;
    }
    if (!editingData.id_number.trim() || !isValidIsraeliId(editingData.id_number)) {
      toast.error('رقم هوية غير صالح');
      return;
    }

    setSavingEdit(true);
    try {
      const { data, error } = await supabase
        .from('client_children')
        .update({
          full_name: editingData.full_name.trim(),
          id_number: editingData.id_number.trim(),
          relation: editingData.relation || null,
          phone: editingData.phone || null,
          birth_date: editingData.birth_date || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingData.id)
        .select()
        .single();

      if (error) throw error;

      toast.success('تم تحديث بيانات السائق');
      setEditingChildId(null);
      setEditingData(null);
      
      // Notify parent to update local state
      if (onExistingChildUpdated && data) {
        onExistingChildUpdated(data as ClientChild);
      }
    } catch (error) {
      console.error('Error updating child:', error);
      toast.error('فشل في تحديث البيانات');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">السائقين الإضافيين / التابعين</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddChild}
          className="gap-1"
        >
          <Plus className="h-4 w-4" />
          إضافة سائق/تابع
        </Button>
      </div>

      {/* Existing Children */}
      {existingChildren.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">الاسم</TableHead>
                <TableHead className="w-[120px]">رقم الهوية</TableHead>
                <TableHead className="w-[100px]">الصلة</TableHead>
                {!compact && <TableHead className="w-[120px]">تاريخ الميلاد</TableHead>}
                {!compact && <TableHead className="w-[100px]">الهاتف</TableHead>}
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {existingChildren.map((child) => (
                <TableRow key={child.id}>
                  {editingChildId === child.id && editingData ? (
                    // Edit mode
                    <>
                      <TableCell>
                        <Input
                          value={editingData.full_name}
                          onChange={(e) => setEditingData({ ...editingData, full_name: e.target.value })}
                          placeholder="الاسم"
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={editingData.id_number}
                          onChange={(e) => setEditingData({ ...editingData, id_number: digitsOnly(e.target.value).slice(0, 9) })}
                          placeholder="رقم الهوية"
                          maxLength={9}
                          className="h-8 ltr-input"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={editingData.relation}
                          onValueChange={(v) => setEditingData({ ...editingData, relation: v })}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {RELATION_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      {!compact && (
                        <TableCell>
                          <ArabicDatePicker
                            value={editingData.birth_date}
                            onChange={(date) => setEditingData({ ...editingData, birth_date: date })}
                            isBirthDate
                            compact
                          />
                        </TableCell>
                      )}
                      {!compact && (
                        <TableCell>
                          <Input
                            value={editingData.phone}
                            onChange={(e) => setEditingData({ ...editingData, phone: digitsOnly(e.target.value).slice(0, 10) })}
                            placeholder="الهاتف"
                            maxLength={10}
                            className="h-8 ltr-input"
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-green-600 hover:text-green-700"
                            onClick={handleSaveEdit}
                            disabled={savingEdit}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground"
                            onClick={handleCancelEdit}
                            disabled={savingEdit}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </>
                  ) : (
                    // View mode
                    <>
                      <TableCell className="font-medium">{child.full_name}</TableCell>
                      <TableCell className="font-mono text-sm">{child.id_number}</TableCell>
                      <TableCell>{child.relation || "-"}</TableCell>
                      {!compact && (
                        <TableCell className="font-mono text-sm ltr-nums">
                          {child.birth_date ? new Date(child.birth_date).toLocaleDateString("en-GB") : "-"}
                        </TableCell>
                      )}
                      {!compact && <TableCell>{child.phone || "-"}</TableCell>}
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleStartEdit(child)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {onRemoveExisting && (
                            isChildLinked(child.id) ? (
                              <span className="text-xs text-muted-foreground" title="مرتبط بوثيقة">
                                <AlertCircle className="h-4 w-4 text-amber-500" />
                              </span>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => onRemoveExisting(child.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )
                          )}
                        </div>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* New Children Forms */}
      {newChildren.map((child, index) => {
        const childErrors = errors[child.id] || {};
        
        return (
          <div
            key={child.id}
            className="p-4 rounded-lg border bg-muted/30 space-y-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                سائق/تابع جديد #{index + 1}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => handleRemoveNewChild(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            
            {/* Responsive grid: 1 col mobile, 2 col tablet, 4 col desktop */}
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              {/* Full Name */}
              <div className="space-y-1.5">
                <Label className="text-xs">
                  الاسم الكامل <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={child.full_name}
                  onChange={(e) => handleUpdateChild(index, 'full_name', e.target.value)}
                  placeholder="الاسم"
                  className={cn(childErrors.full_name && "border-destructive")}
                />
                {childErrors.full_name && (
                  <p className="text-xs text-destructive">{childErrors.full_name}</p>
                )}
              </div>
              
              {/* ID Number */}
              <div className="space-y-1.5">
                <Label className="text-xs">
                  رقم الهوية <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={child.id_number}
                  onChange={(e) => handleUpdateChild(index, 'id_number', digitsOnly(e.target.value).slice(0, 9))}
                  placeholder="9 أرقام"
                  maxLength={9}
                  className={cn("ltr-input", childErrors.id_number && "border-destructive")}
                />
                {childErrors.id_number && (
                  <p className="text-xs text-destructive">{childErrors.id_number}</p>
                )}
              </div>
              
              {/* Relation */}
              <div className="space-y-1.5">
                <Label className="text-xs">الصلة</Label>
                <Select
                  value={child.relation}
                  onValueChange={(v) => handleUpdateChild(index, 'relation', v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RELATION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {/* Phone */}
              <div className="space-y-1.5">
                <Label className="text-xs">الهاتف</Label>
                <Input
                  value={child.phone}
                  onChange={(e) => handleUpdateChild(index, 'phone', digitsOnly(e.target.value).slice(0, 10))}
                  placeholder="10 أرقام"
                  maxLength={10}
                  className="ltr-input"
                />
              </div>
            </div>
            
            {/* Birth Date - full width row on mobile, inline on desktop */}
            {!compact && (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">تاريخ الميلاد</Label>
                  <ArabicDatePicker
                    value={child.birth_date}
                    onChange={(date) => handleUpdateChild(index, 'birth_date', date)}
                    placeholder="اختر التاريخ"
                    isBirthDate
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}

      {existingChildren.length === 0 && newChildren.length === 0 && (
        <Alert>
          <AlertDescription className="text-sm text-muted-foreground">
            لا يوجد سائقين إضافيين أو تابعين. اضغط "إضافة سائق/تابع" لإضافة أول سائق.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
