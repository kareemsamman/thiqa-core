import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ContactDrawer } from "@/components/contacts/ContactDrawer";
import { Click2CallDialog } from "@/components/shared/Click2CallDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { toast } from "sonner";
import {
  Search,
  Plus,
  Phone,
  Mail,
  Copy,
  MoreVertical,
  Pencil,
  Trash2,
  ClipboardCheck,
  Building2,
  Wrench,
  Users,
  Contact,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORY_OPTIONS = [
  { value: "all", label: "الكل", icon: Users },
  { value: "appraiser", label: "مخمن", icon: ClipboardCheck },
  { value: "insurance_company", label: "شركة تأمين", icon: Building2 },
  { value: "garage", label: "كراج", icon: Wrench },
  { value: "other", label: "أخرى", icon: Users },
];

const getCategoryInfo = (category: string) => {
  switch (category) {
    case "appraiser":
      return {
        label: "مخمن",
        color: "bg-blue-100 text-blue-700 border-blue-200",
        icon: ClipboardCheck,
      };
    case "insurance_company":
      return {
        label: "شركة تأمين",
        color: "bg-green-100 text-green-700 border-green-200",
        icon: Building2,
      };
    case "garage":
      return {
        label: "كراج",
        color: "bg-orange-100 text-orange-700 border-orange-200",
        icon: Wrench,
      };
    default:
      return {
        label: "أخرى",
        color: "bg-gray-100 text-gray-700 border-gray-200",
        icon: Users,
      };
  }
};

type BusinessContact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  category: string;
  notes: string | null;
  created_at: string;
};

export default function BusinessContacts() {
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<BusinessContact | null>(
    null
  );
  const [callContact, setCallContact] = useState<{
    name: string;
    phone: string;
  } | null>(null);
  const [deleteContact, setDeleteContact] = useState<BusinessContact | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);

  const queryClient = useQueryClient();

  // Debounced search
  const debouncedSearch = useMemo(() => {
    let timeoutId: NodeJS.Timeout;
    return (value: string) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setSearchQuery(value);
      }, 300);
    };
  }, []);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchInput(value);
      debouncedSearch(value);
    },
    [debouncedSearch]
  );

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["business-contacts", searchQuery, categoryFilter],
    queryFn: async () => {
      let query = supabase
        .from("business_contacts")
        .select("*")
        .order("name", { ascending: true });

      if (searchQuery) {
        query = query.or(
          `name.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%`
        );
      }

      if (categoryFilter && categoryFilter !== "all") {
        query = query.eq("category", categoryFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as BusinessContact[];
    },
  });

  const handleCopy = async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      toast.success("تم نسخ الرقم");
    } catch {
      toast.error("فشل نسخ الرقم");
    }
  };

  const handleEdit = (contact: BusinessContact) => {
    setEditingContact(contact);
    setDrawerOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteContact) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("business_contacts")
        .delete()
        .eq("id", deleteContact.id);

      if (error) throw error;
      toast.success("تم حذف جهة الاتصال");
      queryClient.invalidateQueries({ queryKey: ["business-contacts"] });
      setDeleteContact(null);
    } catch (error: any) {
      toast.error(error.message || "فشل الحذف");
    } finally {
      setDeleting(false);
    }
  };

  const handleAddNew = () => {
    setEditingContact(null);
    setDrawerOpen(true);
  };

  const handleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["business-contacts"] });
  };

  return (
    <MainLayout>
      <Header
        title="جهات الاتصال"
        subtitle="دليل الهاتف للمخمنين والكراجات وشركات التأمين"
        action={{
          label: "إضافة جهة",
          onClick: handleAddNew,
          icon: <Plus className="h-4 w-4 ml-1" />,
        }}
      />

      <div className="p-6 space-y-6">
        {/* Search and Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="ابحث بالاسم أو رقم الهاتف..."
              value={searchInput}
              onChange={handleSearchChange}
              className="pr-10"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="النوع" />
            </SelectTrigger>
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
        </div>

        {/* Contacts Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-3">
                  <Skeleton className="h-6 w-16" />
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-28" />
                  <div className="flex gap-2 pt-2">
                    <Skeleton className="h-9 w-20" />
                    <Skeleton className="h-9 w-16" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : contacts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Contact className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium mb-1">لا توجد جهات اتصال</h3>
              <p className="text-muted-foreground text-sm mb-4">
                {searchQuery || categoryFilter !== "all"
                  ? "لا توجد نتائج مطابقة للبحث"
                  : "ابدأ بإضافة جهة اتصال جديدة"}
              </p>
              {!searchQuery && categoryFilter === "all" && (
                <Button onClick={handleAddNew}>
                  <Plus className="ml-2 h-4 w-4" />
                  إضافة جهة اتصال
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {contacts.map((contact) => {
              const catInfo = getCategoryInfo(contact.category);
              const CatIcon = catInfo.icon;

              return (
                <Card
                  key={contact.id}
                  className="group hover:shadow-lg transition-all duration-200 border-r-4"
                  style={{
                    borderRightColor:
                      contact.category === "appraiser"
                        ? "rgb(59 130 246)"
                        : contact.category === "insurance_company"
                        ? "rgb(34 197 94)"
                        : contact.category === "garage"
                        ? "rgb(249 115 22)"
                        : "rgb(156 163 175)",
                  }}
                >
                  <CardContent className="p-4">
                    {/* Category Badge */}
                    <div className="flex items-center justify-between mb-3">
                      <Badge
                        variant="outline"
                        className={cn("gap-1", catInfo.color)}
                      >
                        <CatIcon className="h-3 w-3" />
                        {catInfo.label}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(contact)}>
                            <Pencil className="ml-2 h-4 w-4" />
                            تعديل
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleteContact(contact)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="ml-2 h-4 w-4" />
                            حذف
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Name */}
                    <h3 className="font-semibold text-lg mb-2 line-clamp-1">
                      {contact.name}
                    </h3>

                    {/* Phone */}
                    {contact.phone && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                        <Phone className="h-4 w-4 text-primary" />
                        <span className="font-mono ltr" dir="ltr">
                          {contact.phone}
                        </span>
                      </div>
                    )}

                    {/* Email */}
                    {contact.email && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                        <Mail className="h-4 w-4 text-primary" />
                        <span className="truncate ltr" dir="ltr">
                          {contact.email}
                        </span>
                      </div>
                    )}

                    {/* Notes preview */}
                    {contact.notes && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                        {contact.notes}
                      </p>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t">
                      {contact.phone && (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            className="flex-1 gap-1.5"
                            onClick={() =>
                              setCallContact({
                                name: contact.name,
                                phone: contact.phone!,
                              })
                            }
                          >
                            <Phone className="h-4 w-4" />
                            اتصال
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={() => handleCopy(contact.phone!)}
                          >
                            <Copy className="h-4 w-4" />
                            نسخ
                          </Button>
                        </>
                      )}
                      {!contact.phone && (
                        <span className="text-xs text-muted-foreground">
                          لا يوجد رقم هاتف
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Contact Drawer */}
      <ContactDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        contact={editingContact}
        onSuccess={handleSuccess}
      />

      {/* Click2Call Dialog */}
      {callContact && (
        <Click2CallDialog
          open={!!callContact}
          onOpenChange={(open) => !open && setCallContact(null)}
          phoneNumber={callContact.phone}
        />
      )}

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        open={!!deleteContact}
        onOpenChange={(open) => !open && setDeleteContact(null)}
        onConfirm={handleDelete}
        loading={deleting}
        title="حذف جهة الاتصال"
        description={`هل أنت متأكد من حذف "${deleteContact?.name}"؟ لا يمكن التراجع عن هذا الإجراء.`}
      />
    </MainLayout>
  );
}
