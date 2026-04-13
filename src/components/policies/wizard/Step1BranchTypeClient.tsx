import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { Search, Plus, User, AlertCircle, CheckCircle, AlertTriangle, Building2, Settings, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { InsuranceTypeCards } from "./InsuranceTypeCards";
import { CreateClientForm } from "./CreateClientForm";
import { PolicyChildrenSelector } from "./PolicyChildrenSelector";
import { useClientAccidentInfo } from "@/hooks/useClientAccidentInfo";
import type { InsuranceCategory, Client, Broker, NewClientForm, ValidationErrors } from "./types";
import type { ClientChild, NewChildForm } from "@/types/clientChildren";
import { BranchQuickFormDialog } from "@/components/branches/BranchQuickFormDialog";
import { CategoryQuickFormDialog } from "@/components/insurance-categories/CategoryQuickFormDialog";
import { normalizeArabic } from "@/lib/arabicNormalize";

interface Step1Props {
  // Branch
  isAdmin: boolean;
  branches: Array<{ id: string; name: string; name_ar: string | null }>;
  selectedBranchId: string;
  setSelectedBranchId: (id: string) => void;
  onBranchesChanged?: (createdId?: string) => void | Promise<void>;

  // Category
  categories: InsuranceCategory[];
  selectedCategory: InsuranceCategory | null;
  onCategoryChange: (category: InsuranceCategory) => void;
  onCategoriesChanged?: (createdId?: string) => void | Promise<void>;
  
  // Client
  clientSearch: string;
  setClientSearch: (search: string) => void;
  clients: Client[];
  setClients: (clients: Client[]) => void;
  loadingClients: boolean;
  setLoadingClients: (loading: boolean) => void;
  selectedClient: Client | null;
  setSelectedClient: (client: Client | null) => void;
  createNewClient: boolean;
  setCreateNewClient: (create: boolean) => void;
  newClient: NewClientForm;
  setNewClient: (client: NewClientForm) => void;
  checkingDuplicate: boolean;
  setCheckingDuplicate: (checking: boolean) => void;
  
  // Children / Additional Drivers
  selectedChildIds: string[];
  setSelectedChildIds: (ids: string[]) => void;
  newChildren: NewChildForm[];
  setNewChildren: (children: NewChildForm[]) => void;
  
  // Errors
  errors: ValidationErrors;
  setErrors: (errors: ValidationErrors) => void;
}

export function Step1BranchTypeClient({
  isAdmin,
  branches,
  selectedBranchId,
  setSelectedBranchId,
  onBranchesChanged,
  categories,
  selectedCategory,
  onCategoryChange,
  onCategoriesChanged,
  clientSearch,
  setClientSearch,
  clients,
  setClients,
  loadingClients,
  setLoadingClients,
  selectedClient,
  setSelectedClient,
  createNewClient,
  setCreateNewClient,
  newClient,
  setNewClient,
  checkingDuplicate,
  setCheckingDuplicate,
  selectedChildIds,
  setSelectedChildIds,
  newChildren,
  setNewChildren,
  errors,
  setErrors,
}: Step1Props) {
  // Quick-add dialogs
  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [branchDialogStartInCreate, setBranchDialogStartInCreate] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [categoryDialogStartInCreate, setCategoryDialogStartInCreate] = useState(false);
  const [categoryDialogInitial, setCategoryDialogInitial] = useState<
    { name?: string; name_ar?: string; name_he?: string; slug?: string; mode?: "FULL" | "LIGHT"; is_default?: boolean } | undefined
  >(undefined);

  const openBranchManage = () => {
    setBranchDialogStartInCreate(false);
    setBranchDialogOpen(true);
  };
  const openBranchCreate = () => {
    setBranchDialogStartInCreate(true);
    setBranchDialogOpen(true);
  };
  const openCategoryManage = () => {
    setCategoryDialogInitial(undefined);
    setCategoryDialogStartInCreate(false);
    setCategoryDialogOpen(true);
  };
  const openCategoryCreate = (initial?: typeof categoryDialogInitial) => {
    setCategoryDialogInitial(initial);
    setCategoryDialogStartInCreate(true);
    setCategoryDialogOpen(true);
  };

  // Search clients
  const searchClients = async (query: string) => {
    if (query.length < 2) {
      setClients([]);
      return;
    }
    setLoadingClients(true);
    const normalized = normalizeArabic(query);
    const { data, error } = await supabase
      .from('clients')
      .select('id, full_name, id_number, file_number, phone_number, less_than_24, under24_type, under24_driver_name, under24_driver_id, broker_id, accident_notes')
      .is('deleted_at', null)
      .or(`full_name_normalized.ilike.%${normalized}%,id_number.ilike.%${query}%,file_number.ilike.%${query}%,phone_number.ilike.%${query}%`)
      .limit(10);
    
    setLoadingClients(false);
    if (!error && data) {
      setClients(data as Client[]);
    }
  };

  useEffect(() => {
    if (clientSearch.length >= 2) {
      const timer = setTimeout(() => searchClients(clientSearch), 300);
      return () => clearTimeout(timer);
    } else {
      setClients([]);
    }
  }, [clientSearch]);

  const handleSelectClient = (client: Client) => {
    setSelectedClient(client);
    setCreateNewClient(false);
    setClientSearch("");
    setClients([]);
    setErrors({});
    // Reset children selection when client changes
    setSelectedChildIds([]);
    setNewChildren([]);
  };

  const handleCreateNewClick = () => {
    setSelectedClient(null);
    setCreateNewClient(true);
    // Pre-fill the full_name with the search query
    if (clientSearch.trim()) {
      setNewClient({ ...newClient, full_name: clientSearch.trim() });
    }
    setClientSearch("");
    setClients([]);
  };

  const handleCancelCreate = () => {
    setCreateNewClient(false);
    setNewClient({
      full_name: "",
      id_number: "",
      phone_number: "",
      phone_number_2: "",
      birth_date: "",
      under24_type: "none",
      under24_driver_name: "",
      under24_driver_id: "",
      notes: "",
    });
    setErrors({});
  };

  const handleRemoveClient = () => {
    setSelectedClient(null);
    setClientSearch("");
    // Reset children selection when client is removed
    setSelectedChildIds([]);
    setNewChildren([]);
  };

  const FieldError = ({ error }: { error?: string }) => {
    if (!error) return null;
    return (
      <p className="text-xs text-destructive mt-1 flex items-center gap-1">
        <AlertCircle className="h-3 w-3" />
        {error}
      </p>
    );
  };

  // Accident Warning Component
  const AccidentWarning = ({ clientId, accidentNotes }: { clientId: string; accidentNotes?: string | null }) => {
    const { count, hasActiveReports } = useClientAccidentInfo(clientId);
    
    if (count === 0) return null;
    
    return (
      <Card className="p-4 border-amber-500 bg-amber-50 dark:bg-amber-950/20">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-amber-700 dark:text-amber-400">
              ⚠️ تحذير: هذا العميل لديه {count} بلاغ حادث
              {hasActiveReports && <span className="text-xs mr-2">(نشط)</span>}
            </p>
            {accidentNotes && (
              <p className="text-sm text-amber-600 dark:text-amber-500 mt-1 whitespace-pre-wrap">
                {accidentNotes}
              </p>
            )}
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Branch Selection - Admin Only (always visible for admin) */}
      {isAdmin && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <Label className="text-base font-semibold block">الفرع *</Label>
            {branches.length > 0 && (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={openBranchManage}
                  title="إدارة الفروع"
                >
                  <Settings className="h-3.5 w-3.5" />
                  إدارة
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={openBranchCreate}
                >
                  <Plus className="h-3.5 w-3.5" />
                  إضافة
                </Button>
              </div>
            )}
          </div>

          {branches.length === 0 ? (
            <Card className="p-4 border-dashed border-destructive/50 bg-destructive/5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
                  <Building2 className="h-5 w-5 text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">لا توجد فروع بعد</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    أضف فرعك الأول لتتمكن من إنشاء الوثائق
                  </p>
                </div>
                <Button type="button" size="sm" className="gap-2 shrink-0" onClick={openBranchCreate}>
                  <Plus className="h-4 w-4" />
                  اضغط للإضافة
                </Button>
              </div>
            </Card>
          ) : (
            <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
              <SelectTrigger className={cn(!selectedBranchId && "border-destructive")}>
                <SelectValue placeholder="اختر الفرع" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name_ar || branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <FieldError error={errors.branch} />
        </div>
      )}

      {/* Insurance Type Selection */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <Label className="text-base font-semibold block">نوع التأمين *</Label>
          {isAdmin && categories.length > 0 && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={openCategoryManage}
                title="إدارة أنواع التأمين"
              >
                <Settings className="h-3.5 w-3.5" />
                إدارة
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={() => openCategoryCreate()}
              >
                <Plus className="h-3.5 w-3.5" />
                إضافة
              </Button>
            </div>
          )}
        </div>

        {categories.length === 0 ? (
          isAdmin ? (
            <Card className="p-4 border-dashed bg-primary/5">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">لا توجد أنواع تأمين بعد</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    نقترح البدء بـ <span className="font-medium">تأمين السيارات (تأمين كامل)</span>
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="gap-2"
                  onClick={() =>
                    openCategoryCreate({
                      name: "Car Insurance",
                      name_ar: "تأمين السيارات",
                      name_he: "ביטוח רכב",
                      slug: "THIRD_FULL",
                      mode: "FULL",
                      is_default: true,
                    })
                  }
                >
                  <Plus className="h-4 w-4" />
                  إضافة تأمين السيارات
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={() => openCategoryCreate()}
                >
                  <Plus className="h-4 w-4" />
                  نوع مخصص
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="p-4 border-dashed bg-muted/20">
              <p className="text-sm text-muted-foreground text-center">
                لا توجد أنواع تأمين متاحة. يرجى التواصل مع المدير.
              </p>
            </Card>
          )
        ) : (
          <InsuranceTypeCards
            categories={categories}
            selectedCategory={selectedCategory}
            onSelect={onCategoryChange}
          />
        )}
        <FieldError error={errors.category} />
      </div>

      {/* Customer Section - Only shown after category is selected */}
      {selectedCategory && (
        <div className="space-y-4">
          <Label className="text-base font-semibold block">العميل *</Label>

          {/* Selected Client Card */}
          {selectedClient && !createNewClient && (
            <>
              <Card className="p-4 border-primary bg-primary/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{selectedClient.full_name}</p>
                        <CheckCircle className="h-4 w-4 text-primary" />
                      </div>
                      <p className="text-sm text-muted-foreground">{selectedClient.id_number}</p>
                      {selectedClient.phone_number && (
                        <p className="text-sm text-muted-foreground">{selectedClient.phone_number}</p>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleRemoveClient}>
                    تغيير
                  </Button>
                </div>
              </Card>

              {/* Accident Warning - Show if client has accident notes */}
              <AccidentWarning clientId={selectedClient.id} accidentNotes={selectedClient.accident_notes} />
            </>
          )}

          {/* Search or Create */}
          {!selectedClient && !createNewClient && (
            <div className="space-y-3">
              {/* Search Input */}
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="ابحث بالاسم، رقم الهوية، رقم الهاتف..."
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  className="pr-10"
                />
              </div>

              {/* Search Results */}
              {loadingClients && (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              )}

              {!loadingClients && clients.length > 0 && (
                <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                  {clients.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      className="w-full p-3 text-right hover:bg-muted/50 transition-colors flex items-center gap-3"
                      onClick={() => handleSelectClient(client)}
                    >
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{client.full_name}</p>
                        <div className="flex gap-3 text-sm text-muted-foreground">
                          <span>{client.id_number}</span>
                          {client.phone_number && <span>{client.phone_number}</span>}
                        </div>
                      </div>
                      {client.file_number && (
                        <Badge variant="secondary">{client.file_number}</Badge>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {!loadingClients && clientSearch.length >= 2 && clients.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  لم يتم العثور على نتائج
                </p>
              )}

              {/* Create New Client Button */}
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={handleCreateNewClick}
              >
                <Plus className="h-4 w-4" />
                إنشاء عميل جديد
              </Button>

              <FieldError error={errors.client} />
            </div>
          )}

          {/* Create New Client Form */}
          {createNewClient && (
            <div className="space-y-4">
              <CreateClientForm
                form={newClient}
                onChange={(field, value) => setNewClient({ ...newClient, [field]: value })}
                checkingDuplicate={checkingDuplicate}
                errors={errors}
              />
              <Button variant="outline" size="sm" onClick={handleCancelCreate} className="w-full">
                إلغاء
              </Button>
            </div>
          )}

          {/* Children / Additional Drivers Section - After client is selected */}
          {(selectedClient || createNewClient) && (
            <PolicyChildrenSelector
              clientId={selectedClient?.id || null}
              selectedChildIds={selectedChildIds}
              onSelectedChange={setSelectedChildIds}
              newChildren={newChildren}
              onNewChildrenChange={setNewChildren}
              showForNewClient={createNewClient}
            />
          )}
        </div>
      )}

      {/* Quick-add / manage dialogs (admin only) */}
      {isAdmin && (
        <>
          <BranchQuickFormDialog
            open={branchDialogOpen}
            onOpenChange={setBranchDialogOpen}
            startInCreate={branchDialogStartInCreate}
            initialForm={branches.length === 0 ? { is_default: true } : undefined}
            onChanged={(createdId) => onBranchesChanged?.(createdId)}
          />
          <CategoryQuickFormDialog
            open={categoryDialogOpen}
            onOpenChange={setCategoryDialogOpen}
            startInCreate={categoryDialogStartInCreate}
            initialForm={categoryDialogInitial}
            onChanged={(createdId) => onCategoriesChanged?.(createdId)}
          />
        </>
      )}
    </div>
  );
}
