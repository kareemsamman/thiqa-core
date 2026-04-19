import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Save } from 'lucide-react';
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

const policySchema = z.object({
  client_id: z.string().min(1, 'العميل مطلوب'),
  car_id: z.string().min(1, 'السيارة مطلوبة'),
  company_id: z.string().min(1, 'شركة التأمين مطلوبة'),
  policy_type_parent: z.string().min(1, 'نوع التأمين مطلوب'),
  policy_type_child: z.string().optional(),
  start_date: z.string().min(1, 'تاريخ البداية مطلوب'),
  end_date: z.string().min(1, 'تاريخ الانتهاء مطلوب'),
  insurance_price: z.coerce.number().min(0, 'السعر مطلوب'),
  profit: z.coerce.number().optional(),
  payed_for_company: z.coerce.number().optional(),
  notes: z.string().optional(),
});

type PolicyFormData = z.infer<typeof policySchema>;

interface Client {
  id: string;
  full_name: string;
}

interface Car {
  id: string;
  car_number: string;
  client_id: string;
}

interface Company {
  id: string;
  name: string;
  name_ar: string | null;
}

interface PolicyDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const POLICY_TYPES = [
  { value: 'ELZAMI', label: 'إلزامي', hasChild: false },
  { value: 'THIRD_FULL', label: 'ثالث/شامل', hasChild: true },
  { value: 'ROAD_SERVICE', label: 'خدمات الطريق', hasChild: false },
  { value: 'ACCIDENT_FEE_EXEMPTION', label: 'إعفاء رسوم حادث', hasChild: false },
];

export function PolicyDrawer({ open, onOpenChange, onSaved }: PolicyDrawerProps) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [filteredCars, setFilteredCars] = useState<Car[]>([]);

  const form = useForm<PolicyFormData>({
    resolver: zodResolver(policySchema),
    defaultValues: {
      client_id: '',
      car_id: '',
      company_id: '',
      policy_type_parent: '',
      policy_type_child: '',
      start_date: new Date().toISOString().split('T')[0],
      end_date: '',
      insurance_price: 0,
      profit: 0,
      payed_for_company: 0,
      notes: '',
    },
  });

  const selectedPolicyType = form.watch('policy_type_parent');
  const selectedClientId = form.watch('client_id');

  // Fetch initial data
  useEffect(() => {
    if (open) {
      setLoadingData(true);
      Promise.all([
        supabase.from('clients').select('id, full_name').order('full_name').limit(200),
        supabase.from('cars').select('id, car_number, client_id').order('car_number'),
        supabase.from('insurance_companies').select('id, name, name_ar').eq('active', true).order('name'),
      ]).then(([clientsRes, carsRes, companiesRes]) => {
        if (clientsRes.data) setClients(clientsRes.data);
        if (carsRes.data) setCars(carsRes.data);
        if (companiesRes.data) setCompanies(companiesRes.data);
        setLoadingData(false);
      });

      form.reset({
        client_id: '',
        car_id: '',
        company_id: '',
        policy_type_parent: '',
        policy_type_child: '',
        start_date: new Date().toISOString().split('T')[0],
        end_date: '',
        insurance_price: 0,
        profit: 0,
        payed_for_company: 0,
        notes: '',
      });
    }
  }, [open]);

  // Filter cars when client changes
  useEffect(() => {
    if (selectedClientId) {
      setFilteredCars(cars.filter(car => car.client_id === selectedClientId));
      form.setValue('car_id', ''); // Reset car selection
    } else {
      setFilteredCars([]);
    }
  }, [selectedClientId, cars]);

  // Calculate end date (1 year from start)
  const handleStartDateChange = (date: string) => {
    form.setValue('start_date', date);
    if (date) {
      const startDate = new Date(date);
      startDate.setFullYear(startDate.getFullYear() + 1);
      startDate.setDate(startDate.getDate() - 1);
      form.setValue('end_date', startDate.toISOString().split('T')[0]);
    }
  };

  const onSubmit = async (data: PolicyFormData) => {
    setSaving(true);
    try {
      let profit = data.profit || 0;
      let payedForCompany = data.payed_for_company || 0;
      
      if (data.policy_type_parent === 'ELZAMI') {
        // Fetch ELZAMI commission from the selected company
        const { data: company } = await supabase
          .from('insurance_companies')
          .select('elzami_commission')
          .eq('id', data.company_id)
          .single();
        
        profit = company?.elzami_commission || 0;
        payedForCompany = data.insurance_price;
      }

      const { error } = await supabase
        .from('policies')
        .insert({
          created_by_admin_id: user?.id || null,
          client_id: data.client_id,
          car_id: data.car_id,
          company_id: data.company_id,
          policy_type_parent: data.policy_type_parent as any,
          policy_type_child: data.policy_type_child ? (data.policy_type_child as any) : null,
          start_date: data.start_date,
          end_date: data.end_date,
          insurance_price: data.insurance_price,
          profit,
          payed_for_company: payedForCompany,
          notes: data.notes || null,
        });

      if (error) throw error;

      toast.success('تمت إضافة المعاملة بنجاح');
      form.reset();
      onSaved();
    } catch (error: any) {
      console.error('Save error:', error);
      toast.error('فشل حفظ المعاملة');
    } finally {
      setSaving(false);
    }
  };

  const showChildType = POLICY_TYPES.find(t => t.value === selectedPolicyType)?.hasChild;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>إضافة معاملة تأمين جديدة</SheetTitle>
        </SheetHeader>

        {loadingData ? (
          <div className="space-y-4 mt-6">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-6">
              {/* Client */}
              <FormField
                control={form.control}
                name="client_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>العميل *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="اختر العميل" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {clients.map((client) => (
                          <SelectItem key={client.id} value={client.id}>
                            {client.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Car */}
              <FormField
                control={form.control}
                name="car_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>السيارة *</FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      value={field.value}
                      disabled={!selectedClientId}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={selectedClientId ? "اختر السيارة" : "اختر العميل أولاً"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {filteredCars.map((car) => (
                          <SelectItem key={car.id} value={car.id}>
                            {car.car_number}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Company */}
              <FormField
                control={form.control}
                name="company_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>شركة التأمين *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="اختر الشركة" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {companies.map((company) => (
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

              {/* Policy Type */}
              <FormField
                control={form.control}
                name="policy_type_parent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>نوع التأمين *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="اختر النوع" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {POLICY_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Child Type (for THIRD_FULL) */}
              {showChildType && (
                <FormField
                  control={form.control}
                  name="policy_type_child"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>التصنيف الفرعي</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="اختر التصنيف" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="THIRD">ثالث</SelectItem>
                          <SelectItem value="FULL">شامل</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              )}

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="start_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>تاريخ البداية *</FormLabel>
                      <FormControl>
                        <ArabicDatePicker
                          value={field.value}
                          onChange={(date) => handleStartDateChange(date)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="end_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>تاريخ الانتهاء *</FormLabel>
                      <FormControl>
                        <ArabicDatePicker
                          value={field.value}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Price */}
              <FormField
                control={form.control}
                name="insurance_price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>سعر التأمين (₪) *</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Profit & Payment (not for ELZAMI) */}
              {selectedPolicyType !== 'ELZAMI' && (
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="profit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>الربح (₪)</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="0" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="payed_for_company"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>المدفوع للشركة (₪)</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="0" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
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
                      <Textarea placeholder="ملاحظات إضافية..." {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="flex gap-3 pt-4">
                <Button type="submit" disabled={saving} className="flex-1">
                  {saving ? (
                    <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 ml-2" />
                  )}
                  {saving ? 'جاري الحفظ...' : 'حفظ'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                >
                  إلغاء
                </Button>
              </div>
            </form>
          </Form>
        )}
      </SheetContent>
    </Sheet>
  );
}
