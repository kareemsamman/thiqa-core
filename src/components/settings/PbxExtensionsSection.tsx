import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Phone, Plus, Trash2, Star, Loader2, Eye, EyeOff, AlertCircle } from "lucide-react";

interface PbxExtension {
  id: string;
  extension_number: string;
  extension_name: string | null;
  password_plain: string;
  is_default: boolean;
  created_at: string;
}

interface PbxExtensionsSectionProps {
  ippbxEnabled: boolean;
  onIppbxEnabledChange: (enabled: boolean) => void;
  ippbxTokenId: string;
  onTokenIdChange: (tokenId: string) => void;
}

export function PbxExtensionsSection({
  ippbxEnabled,
  onIppbxEnabledChange,
  ippbxTokenId,
  onTokenIdChange,
}: PbxExtensionsSectionProps) {
  const [extensions, setExtensions] = useState<PbxExtension[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [testingCall, setTestingCall] = useState<string | null>(null);
  
  const [newExtension, setNewExtension] = useState({
    extension_number: "",
    extension_name: "",
    password_plain: "",
    is_default: false,
  });

  useEffect(() => {
    fetchExtensions();
  }, []);

  const fetchExtensions = async () => {
    try {
      const { data, error } = await supabase
        .from("pbx_extensions")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) throw error;
      setExtensions(data || []);
    } catch (error) {
      console.error("Error fetching extensions:", error);
      toast.error("فشل في تحميل التحويلات");
    } finally {
      setLoading(false);
    }
  };

  const handleAddExtension = async () => {
    if (!newExtension.extension_number || !newExtension.password_plain) {
      toast.error("يرجى إدخال رقم التحويلة وكلمة المرور");
      return;
    }

    setSaving(true);
    try {
      // If this is the first extension or marked as default, unset other defaults
      if (newExtension.is_default || extensions.length === 0) {
        await supabase
          .from("pbx_extensions")
          .update({ is_default: false } as any)
          .neq("id", "00000000-0000-0000-0000-000000000000");
      }

      const { data, error } = await supabase
        .from("pbx_extensions")
        .insert({
          extension_number: newExtension.extension_number,
          extension_name: newExtension.extension_name || null,
          password_plain: newExtension.password_plain,
          password_md5: "", // Will be computed by trigger
          is_default: newExtension.is_default || extensions.length === 0,
        } as any)
        .select()
        .single();

      if (error) throw error;

      setExtensions([...extensions, data]);
      setIsDialogOpen(false);
      setNewExtension({
        extension_number: "",
        extension_name: "",
        password_plain: "",
        is_default: false,
      });
      toast.success("تمت إضافة التحويلة بنجاح");
    } catch (error) {
      console.error("Error adding extension:", error);
      toast.error("فشل في إضافة التحويلة");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExtension = async (id: string) => {
    if (!confirm("هل أنت متأكد من حذف هذه التحويلة؟")) return;

    try {
      const { error } = await supabase
        .from("pbx_extensions")
        .delete()
        .eq("id", id);

      if (error) throw error;

      setExtensions(extensions.filter((ext) => ext.id !== id));
      toast.success("تم حذف التحويلة");
    } catch (error) {
      console.error("Error deleting extension:", error);
      toast.error("فشل في حذف التحويلة");
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      // Unset all defaults
      await supabase
        .from("pbx_extensions")
        .update({ is_default: false })
        .neq("id", "00000000-0000-0000-0000-000000000000");

      // Set new default
      const { error } = await supabase
        .from("pbx_extensions")
        .update({ is_default: true })
        .eq("id", id);

      if (error) throw error;

      setExtensions(
        extensions.map((ext) => ({
          ...ext,
          is_default: ext.id === id,
        }))
      );
      toast.success("تم تعيين التحويلة الافتراضية");
    } catch (error) {
      console.error("Error setting default:", error);
      toast.error("فشل في تعيين التحويلة الافتراضية");
    }
  };

  const handleTestCall = async (extensionId: string) => {
    const testPhone = prompt("أدخل رقم هاتف للاختبار:");
    if (!testPhone) return;

    setTestingCall(extensionId);
    try {
      const { data, error } = await supabase.functions.invoke("click2call", {
        body: {
          phone_number: testPhone,
          extension_id: extensionId,
        },
      });

      if (error) throw error;

      if (data?.success) {
        toast.success(data.message || "تم بدء الاتصال بنجاح");
      } else {
        toast.error(data?.message || "فشل في بدء الاتصال");
      }
    } catch (error) {
      console.error("Error testing call:", error);
      toast.error("فشل في اختبار الاتصال");
    } finally {
      setTestingCall(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>الاتصال السريع (Click-to-Call)</CardTitle>
            <CardDescription>
              إعدادات نظام IPPBX للاتصال المباشر بالعملاء
            </CardDescription>
          </div>
          <Switch
            checked={ippbxEnabled}
            onCheckedChange={onIppbxEnabledChange}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            أدخل رمز التوثيق وأضف التحويلات المتاحة. كلمة المرور ستُحوَّل تلقائياً إلى MD5.
          </AlertDescription>
        </Alert>

        {/* Token ID */}
        <div className="space-y-2">
          <Label htmlFor="ippbx_token_id">رمز التوثيق (Token ID)</Label>
          <Input
            id="ippbx_token_id"
            value={ippbxTokenId}
            onChange={(e) => onTokenIdChange(e.target.value)}
            className="ltr-input max-w-md"
            placeholder="أدخل Token ID"
          />
        </div>

        {/* Extensions Table */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">التحويلات المتاحة</h4>
            <Button
              size="sm"
              onClick={() => setIsDialogOpen(true)}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              إضافة تحويلة
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : extensions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Phone className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>لا توجد تحويلات. أضف تحويلة جديدة للبدء.</p>
            </div>
          ) : (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">رقم التحويلة</TableHead>
                    <TableHead>الاسم</TableHead>
                    <TableHead className="w-24">افتراضي</TableHead>
                    <TableHead className="w-32 text-center">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {extensions.map((ext) => (
                    <TableRow key={ext.id}>
                      <TableCell className="font-mono font-medium">
                        {ext.extension_number}
                      </TableCell>
                      <TableCell>{ext.extension_name || "-"}</TableCell>
                      <TableCell>
                        {ext.is_default ? (
                          <span className="inline-flex items-center gap-1 text-primary">
                            <Star className="h-4 w-4 fill-current" />
                            افتراضي
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSetDefault(ext.id)}
                            className="text-muted-foreground hover:text-primary"
                          >
                            جعلها افتراضي
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleTestCall(ext.id)}
                            disabled={testingCall === ext.id || !ippbxEnabled}
                            title="اختبار"
                          >
                            {testingCall === ext.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Phone className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteExtension(ext.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Add Extension Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5 text-primary" />
                إضافة تحويلة جديدة
              </DialogTitle>
              <DialogDescription>
                أدخل بيانات التحويلة. كلمة المرور ستُحوَّل تلقائياً إلى MD5.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="ext_number">رقم التحويلة *</Label>
                <Input
                  id="ext_number"
                  value={newExtension.extension_number}
                  onChange={(e) =>
                    setNewExtension({
                      ...newExtension,
                      extension_number: e.target.value,
                    })
                  }
                  placeholder="101"
                  className="ltr-input"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ext_name">اسم التحويلة</Label>
                <Input
                  id="ext_name"
                  value={newExtension.extension_name}
                  onChange={(e) =>
                    setNewExtension({
                      ...newExtension,
                      extension_name: e.target.value,
                    })
                  }
                  placeholder="المكتب الرئيسي"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ext_password">كلمة المرور *</Label>
                <div className="relative">
                  <Input
                    id="ext_password"
                    type={showPassword ? "text" : "password"}
                    value={newExtension.password_plain}
                    onChange={(e) =>
                      setNewExtension({
                        ...newExtension,
                        password_plain: e.target.value,
                      })
                    }
                    placeholder="كلمة المرور العادية (ليس MD5)"
                    className="ltr-input"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute left-0 top-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  أدخل كلمة المرور العادية وسيتم تحويلها تلقائياً إلى MD5
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="ext_default"
                  checked={newExtension.is_default}
                  onCheckedChange={(checked) =>
                    setNewExtension({ ...newExtension, is_default: checked })
                  }
                />
                <Label htmlFor="ext_default">جعلها التحويلة الافتراضية</Label>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
                disabled={saving}
              >
                إلغاء
              </Button>
              <Button onClick={handleAddExtension} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                    جاري الإضافة...
                  </>
                ) : (
                  <>
                    <Plus className="ml-2 h-4 w-4" />
                    إضافة
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
