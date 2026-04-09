import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Loader2, Check, ChevronsUpDown, Search, X, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

const formSchema = z.object({
  garage_name: z.string().min(1, "اسم الكراج مطلوب"),
  insurance_company_id: z.string().optional(),
  insurance_file_number: z.string().optional(),
  accident_date: z.string().optional(),
  car_type: z.enum(["external", "insured"]),
  external_car_number: z.string().optional(),
  external_car_model: z.string().optional(),
  client_id: z.string().optional(),
  policy_id: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface RepairClaimDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claim?: any;
}

export function RepairClaimDrawer({ open, onOpenChange, claim }: RepairClaimDrawerProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [garagePopoverOpen, setGaragePopoverOpen] = useState(false);
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState("");

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      garage_name: "",
      insurance_company_id: "",
      insurance_file_number: "",
      accident_date: "",
      car_type: "external",
      external_car_number: "",
      external_car_model: "",
      client_id: "",
      policy_id: "",
      notes: "",
    },
  });

  const carType = form.watch("car_type");
  const selectedClientId = form.watch("client_id");

  // Reset form when claim changes
  useEffect(() => {
    if (open) {
      if (claim) {
        form.reset({
          garage_name: claim.garage_name || "",
          insurance_company_id: claim.insurance_company_id || "",
          insurance_file_number: claim.insurance_file_number || "",
          accident_date: claim.accident_date || "",
          car_type: claim.car_type || "external",
          external_car_number: claim.external_car_number || "",
          external_car_model: claim.external_car_model || "",
          client_id: claim.client_id || "",
          policy_id: claim.policy_id || "",
          notes: claim.notes || "",
        });
      } else {
        form.reset({
          garage_name: "",
          insurance_company_id: "",
          insurance_file_number: "",
          accident_date: "",
          car_type: "external",
          external_car_number: "",
          external_car_model: "",
          client_id: "",
          policy_id: "",
          notes: "",
        });
      }
    }
  }, [claim, open, form]);

  // Fetch garages from business_contacts
  const { data: garages } = useQuery({
    queryKey: ["business-contacts-garages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_contacts")
        .select("id, name")
        .eq("category", "garage")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch insurance companies
  const { data: companies } = useQuery({
    queryKey: ["insurance-companies-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_companies")
        .select("id, name, name_ar")
        .order("name_ar");
      if (error) throw error;
      return data;
    },
  });

  // Search clients - improved query
  const { data: clients, isLoading: clientsLoading } = useQuery({
    queryKey: ["clients-search-repair", clientSearch],
    queryFn: async () => {
      if (!clientSearch || clientSearch.length < 2) return [];
      
      // Use textSearch approach for better results
      const searchTerm = `%${clientSearch}%`;
      const { data, error } = await supabase
        .from("clients")
        .select("id, full_name, id_number, phone_number")
        .is("deleted_at", null)
        .or(`full_name.ilike.${searchTerm},id_number.ilike.${searchTerm},phone_number.ilike.${searchTerm}`)
        .limit(15);
      
      if (error) {
        console.error("Client search error:", error);
        return [];
      }
      return data || [];
    },
    enabled: clientSearch.length >= 2,
  });

  // Fetch policies for selected client (THIRD_FULL or ROAD_SERVICE only)
  const { data: policies } = useQuery({
    queryKey: ["client-policies-repair", selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return [];
      
      const { data, error } = await supabase
        .from("policies")
        .select(`
          id, 
          policy_number, 
          policy_type_parent, 
          policy_type_child, 
          start_date, 
          end_date,
          cars(car_number, manufacturer_name, model, year)
        `)
        .eq("client_id", selectedClientId)
        .in("policy_type_parent", ["THIRD_FULL", "ROAD_SERVICE"])
        .eq("cancelled", false)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!selectedClientId,
  });

  // Auto-fill insurance file number when policy is selected
  const selectedPolicyId = form.watch("policy_id");
  useEffect(() => {
    if (selectedPolicyId && policies) {
      const selectedPolicy = policies.find(p => p.id === selectedPolicyId);
      if (selectedPolicy?.policy_number) {
        form.setValue("insurance_file_number", selectedPolicy.policy_number);
      }
    }
  }, [selectedPolicyId, policies, form]);

  // Selected client display
  const selectedClient = clients?.find(c => c.id === selectedClientId) || 
    (claim?.client ? { id: claim.client_id, full_name: claim.client.full_name, id_number: claim.client.id_number || '', phone_number: claim.client.phone_number || '' } : null);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        garage_name: values.garage_name,
        insurance_company_id: values.insurance_company_id || null,
        insurance_file_number: values.insurance_file_number || null,
        accident_date: values.accident_date || null,
        car_type: values.car_type,
        external_car_number: values.car_type === "external" ? values.external_car_number || null : null,
        external_car_model: values.car_type === "external" ? values.external_car_model || null : null,
        client_id: values.car_type === "insured" ? values.client_id || null : null,
        policy_id: values.car_type === "insured" ? values.policy_id || null : null,
        notes: values.notes || null,
        updated_at: new Date().toISOString(),
      };

      if (claim) {
        const { error } = await supabase
          .from("repair_claims")
          .update(payload)
          .eq("id", claim.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("repair_claims")
          .insert({
            ...payload,
            created_by: user?.id,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repair-claims"] });
      toast.success(claim ? "تم تحديث المطالبة" : "تم إنشاء المطالبة");
      onOpenChange(false);
    },
    onError: (error) => {
      console.error("Error saving claim:", error);
      toast.error("حدث خطأ أثناء الحفظ");
    },
  });

  const onSubmit = (values: FormValues) => {
    saveMutation.mutate(values);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{claim ? "تعديل المطالبة" : "إضافة مطالبة جديدة"}</SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 mt-6">
            {/* Garage Name with Autocomplete */}
            <FormField
              control={form.control}
              name="garage_name"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>اسم الكراج *</FormLabel>
                  <Popover open={garagePopoverOpen} onOpenChange={setGaragePopoverOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          className={cn(
                            "w-full justify-between",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value || "اختر أو اكتب اسم الكراج"}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-full p-0" align="start">
                      <Command>
                        <CommandInput 
                          placeholder="ابحث أو اكتب..."
                          value={field.value}
                          onValueChange={field.onChange}
                        />
                        <CommandList>
                          <CommandEmpty>
                            <Button
                              variant="ghost"
                              className="w-full"
                              onClick={() => {
                                setGaragePopoverOpen(false);
                              }}
                            >
                              استخدم "{field.value}"
                            </Button>
                          </CommandEmpty>
                          <CommandGroup>
                            {garages?.map((garage) => (
                              <CommandItem
                                key={garage.id}
                                value={garage.name}
                                onSelect={() => {
                                  field.onChange(garage.name);
                                  setGaragePopoverOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "ml-2 h-4 w-4",
                                    garage.name === field.value ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                {garage.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Insurance Company */}
            <FormField
              control={form.control}
              name="insurance_company_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>شركة التأمين</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="اختر شركة التأمين" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {companies?.map((company) => (
                        <SelectItem key={company.id} value={company.id}>
                          {company.name_ar || company.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Insurance File Number */}
            <FormField
              control={form.control}
              name="insurance_file_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>رقم ملف التأمين</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="رقم الملف" dir="ltr" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Accident Date */}
            <FormField
              control={form.control}
              name="accident_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>تاريخ الحادث</FormLabel>
                  <FormControl>
                    <ArabicDatePicker
                      value={field.value || ''}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Car Type */}
            <FormField
              control={form.control}
              name="car_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>نوع السيارة *</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      className="flex gap-4"
                      dir="rtl"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="external" id="external" />
                        <Label htmlFor="external">سيارة خارجية</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="insured" id="insured" />
                        <Label htmlFor="insured">مؤمن عندنا</Label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* External Car Fields */}
            {carType === "external" && (
              <div className="space-y-4 p-4 rounded-lg bg-muted/50">
                <FormField
                  control={form.control}
                  name="external_car_number"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>رقم السيارة</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="00-000-00" dir="ltr" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="external_car_model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>موديل السيارة</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="مثال: تويوتا كورولا 2020" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* Insured Client Fields */}
            {carType === "insured" && (
              <div className="space-y-4 p-4 rounded-lg bg-muted/50">
                {/* Client Search with Card Results */}
                <FormField
                  control={form.control}
                  name="client_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>العميل</FormLabel>
                      <div className="space-y-3">
                        {/* Search Input */}
                        {!selectedClient && (
                          <div className="relative">
                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              placeholder="ابحث بالاسم أو رقم الهوية أو الهاتف..."
                              value={clientSearch}
                              onChange={(e) => setClientSearch(e.target.value)}
                              className="pr-10"
                            />
                          </div>
                        )}

                        {/* Selected Client Card */}
                        {selectedClient && (
                          <Card className="p-3 border-primary bg-primary/5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                  <Users className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                  <p className="font-medium">{selectedClient.full_name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {selectedClient.id_number} • {selectedClient.phone_number}
                                  </p>
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  field.onChange("");
                                  form.setValue("policy_id", "");
                                  setClientSearch("");
                                }}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </Card>
                        )}

                        {/* Search Results as Cards */}
                        {!selectedClient && clientSearch.length >= 2 && (
                          <div className="border rounded-lg max-h-60 overflow-auto">
                            {clientsLoading ? (
                              <div className="p-4 text-center">
                                <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                              </div>
                            ) : clients?.length === 0 ? (
                              <div className="p-4 text-center text-muted-foreground">
                                لا توجد نتائج
                              </div>
                            ) : (
                              <div className="divide-y">
                                {clients?.map((client) => (
                                  <button
                                    key={client.id}
                                    type="button"
                                    onClick={() => {
                                      field.onChange(client.id);
                                      form.setValue("policy_id", "");
                                    }}
                                    className="w-full p-3 text-right hover:bg-muted/50 transition-colors flex items-center gap-3"
                                  >
                                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                      <Users className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                    <div className="flex-1 text-right">
                                      <p className="font-medium text-sm">{client.full_name}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {client.id_number} • {client.phone_number}
                                      </p>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Policy Select */}
                {selectedClientId && (
                  <FormField
                    control={form.control}
                    name="policy_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>البوليصة</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="اختر البوليصة" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {policies?.map((policy: any) => (
                              <SelectItem key={policy.id} value={policy.id}>
                                <div className="flex flex-col">
                                  <span>
                                    {policy.policy_type_parent === "THIRD_FULL" ? "شامل" : "خدمات طريق"}
                                    {policy.policy_number ? ` - ${policy.policy_number}` : ""}
                                  </span>
                                  {policy.cars && (
                                    <span className="text-xs text-muted-foreground">
                                      {policy.cars.car_number} - {policy.cars.manufacturer_name} {policy.cars.model}
                                    </span>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            )}

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ملاحظات</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="ملاحظات إضافية..." rows={3} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Submit */}
            <div className="flex gap-3 pt-4">
              <Button type="submit" disabled={saveMutation.isPending} className="flex-1">
                {saveMutation.isPending && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                {claim ? "تحديث" : "إنشاء"}
              </Button>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                إلغاء
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
