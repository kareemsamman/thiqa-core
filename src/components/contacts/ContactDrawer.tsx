import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, ClipboardCheck, Building2, Wrench, Users } from "lucide-react";

const CATEGORY_OPTIONS = [
  { value: "appraiser", label: "مخمن", icon: ClipboardCheck },
  { value: "insurance_company", label: "شركة تأمين", icon: Building2 },
  { value: "garage", label: "كراج", icon: Wrench },
  { value: "other", label: "أخرى", icon: Users },
];

const formSchema = z.object({
  name: z.string().min(1, "الاسم مطلوب"),
  phone: z.string().optional(),
  email: z.string().email("بريد إلكتروني غير صالح").optional().or(z.literal("")),
  category: z.string().min(1, "النوع مطلوب"),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface ContactDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    category: string;
    notes: string | null;
  } | null;
  onSuccess: () => void;
}

export function ContactDrawer({
  open,
  onOpenChange,
  contact,
  onSuccess,
}: ContactDrawerProps) {
  const [saving, setSaving] = useState(false);
  const isEditing = !!contact;

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      category: "other",
      notes: "",
    },
  });

  useEffect(() => {
    if (open) {
      if (contact) {
        form.reset({
          name: contact.name,
          phone: contact.phone || "",
          email: contact.email || "",
          category: contact.category,
          notes: contact.notes || "",
        });
      } else {
        form.reset({
          name: "",
          phone: "",
          email: "",
          category: "other",
          notes: "",
        });
      }
    }
  }, [open, contact, form]);

  const onSubmit = async (data: FormData) => {
    setSaving(true);
    try {
      if (isEditing && contact) {
        const { error } = await supabase
          .from("business_contacts")
          .update({
            name: data.name,
            phone: data.phone || null,
            email: data.email || null,
            category: data.category,
            notes: data.notes || null,
          })
          .eq("id", contact.id);

        if (error) throw error;
        toast.success("تم تحديث جهة الاتصال بنجاح");
      } else {
        const { error } = await supabase.from("business_contacts").insert({
          name: data.name,
          phone: data.phone || null,
          email: data.email || null,
          category: data.category,
          notes: data.notes || null,
        });

        if (error) throw error;
        toast.success("تم إضافة جهة الاتصال بنجاح");
      }

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error saving contact:", error);
      toast.error(error.message || "حدث خطأ أثناء الحفظ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {isEditing ? "تعديل جهة الاتصال" : "إضافة جهة اتصال جديدة"}
          </SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4 mt-6"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>الاسم *</FormLabel>
                  <FormControl>
                    <Input placeholder="اسم جهة الاتصال" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>النوع *</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="اختر النوع" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CATEGORY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex items-center gap-2">
                            <opt.icon className="h-4 w-4" />
                            <span>{opt.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>رقم الهاتف</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="0521234567"
                      className="text-left ltr"
                      dir="ltr"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>البريد الإلكتروني</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="email@example.com"
                      className="text-left ltr"
                      dir="ltr"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ملاحظات</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="ملاحظات إضافية..."
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-3 pt-4">
              <Button type="submit" disabled={saving} className="flex-1">
                {saving && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                {isEditing ? "حفظ التغييرات" : "إضافة"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                إلغاء
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
