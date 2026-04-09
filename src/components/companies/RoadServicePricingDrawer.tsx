import { useState, useEffect, useCallback } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';

type AgeBand = Database['public']['Enums']['age_band'];

interface Company {
  id: string;
  name: string;
  name_ar: string | null;
}

interface RoadService {
  id: string;
  name: string;
  name_ar: string | null;
}

interface RoadServicePrice {
  id: string;
  company_id: string;
  road_service_id: string;
  age_band: AgeBand;
  company_cost: number;
  selling_price: number;
  notes: string | null;
  road_service?: RoadService;
}

interface RoadServicePricingDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
}

const AGE_BAND_LABELS: Record<AgeBand, string> = {
  UNDER_24: 'أقل من 24',
  UP_24: '24 فأكثر',
  ANY: 'الكل',
};

export function RoadServicePricingDrawer({ open, onOpenChange, company }: RoadServicePricingDrawerProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prices, setPrices] = useState<RoadServicePrice[]>([]);
  const [roadServices, setRoadServices] = useState<RoadService[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPrice, setNewPrice] = useState({
    road_service_id: '',
    age_band: 'ANY' as AgeBand,
    company_cost: 0,
    selling_price: 0,
  });

  const fetchData = useCallback(async () => {
    if (!company) return;

    setLoading(true);
    try {
      const [pricesRes, servicesRes] = await Promise.all([
        supabase
          .from('company_road_service_prices')
          .select('*, road_services(id, name, name_ar)')
          .eq('company_id', company.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('road_services')
          .select('id, name, name_ar')
          .eq('active', true)
          .order('sort_order'),
      ]);

      if (pricesRes.error) throw pricesRes.error;
      if (servicesRes.error) throw servicesRes.error;

      const mappedPrices = (pricesRes.data || []).map(p => ({
        ...p,
        road_service: p.road_services as RoadService,
      }));

      setPrices(mappedPrices);
      setRoadServices(servicesRes.data || []);
    } catch (error) {
      console.error('Error fetching road service prices:', error);
      toast.error('فشل في تحميل الأسعار');
    } finally {
      setLoading(false);
    }
  }, [company]);

  useEffect(() => {
    if (open && company) {
      fetchData();
      setShowAddForm(false);
      setNewPrice({
        road_service_id: '',
        age_band: 'ANY',
        company_cost: 0,
        selling_price: 0,
      });
    }
  }, [open, company, fetchData]);

  const handleAddPrice = async () => {
    if (!company || !newPrice.road_service_id) {
      toast.error('يرجى اختيار الخدمة');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('company_road_service_prices')
        .insert({
          company_id: company.id,
          road_service_id: newPrice.road_service_id,
          car_type: 'car',
          age_band: newPrice.age_band,
          company_cost: newPrice.company_cost,
          selling_price: newPrice.selling_price,
        });

      if (error) throw error;

      toast.success('تم إضافة السعر بنجاح');
      setShowAddForm(false);
      setNewPrice({
        road_service_id: '',
        age_band: 'ANY',
        company_cost: 0,
        selling_price: 0,
      });
      fetchData();
    } catch (error: any) {
      console.error('Error adding price:', error);
      if (error.code === '23505') {
        toast.error('هذا السعر موجود بالفعل لهذه الخدمة');
      } else {
        toast.error('فشل في إضافة السعر');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePrice = async (priceId: string, field: 'company_cost' | 'selling_price', value: number) => {
    try {
      const { error } = await supabase
        .from('company_road_service_prices')
        .update({ [field]: value })
        .eq('id', priceId);

      if (error) throw error;

      setPrices(prev => prev.map(p => 
        p.id === priceId ? { ...p, [field]: value } : p
      ));
      toast.success('تم تحديث السعر');
    } catch (error) {
      console.error('Error updating price:', error);
      toast.error('فشل في تحديث السعر');
    }
  };

  const handleDeletePrice = async (priceId: string) => {
    try {
      const { error } = await supabase
        .from('company_road_service_prices')
        .delete()
        .eq('id', priceId);

      if (error) throw error;

      setPrices(prev => prev.filter(p => p.id !== priceId));
      toast.success('تم حذف السعر');
    } catch (error) {
      console.error('Error deleting price:', error);
      toast.error('فشل في حذف السعر');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            أسعار خدمات الطريق - {company?.name_ar || company?.name}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Add new price form */}
          {showAddForm ? (
            <div className="p-4 border rounded-lg bg-muted/50 space-y-4">
              <h3 className="font-medium">إضافة سعر جديد</h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>الخدمة</Label>
                  <Select
                    value={newPrice.road_service_id}
                    onValueChange={(v) => setNewPrice(prev => ({ ...prev, road_service_id: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر خدمة" />
                    </SelectTrigger>
                    <SelectContent>
                      {roadServices.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name_ar || s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>الفئة العمرية</Label>
                  <Select
                    value={newPrice.age_band}
                    onValueChange={(v) => setNewPrice(prev => ({ ...prev, age_band: v as AgeBand }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(AGE_BAND_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>تكلفة الشركة (₪)</Label>
                  <Input
                    type="number"
                    value={newPrice.company_cost}
                    onChange={(e) => setNewPrice(prev => ({ ...prev, company_cost: parseFloat(e.target.value) || 0 }))}
                    min={0}
                  />
                </div>

                <div className="space-y-2">
                  <Label>سعر البيع للعميل (₪)</Label>
                  <Input
                    type="number"
                    value={newPrice.selling_price}
                    onChange={(e) => setNewPrice(prev => ({ ...prev, selling_price: parseFloat(e.target.value) || 0 }))}
                    min={0}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleAddPrice} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
                  إضافة
                </Button>
                <Button variant="outline" onClick={() => setShowAddForm(false)}>
                  إلغاء
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={() => setShowAddForm(true)} variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              إضافة سعر جديد
            </Button>
          )}

          {/* Prices table */}
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الخدمة</TableHead>
                  <TableHead className="text-right">الفئة العمرية</TableHead>
                  <TableHead className="text-right">تكلفة الشركة (₪)</TableHead>
                  <TableHead className="text-right">سعر البيع (₪)</TableHead>
                  <TableHead className="text-right">الربح (₪)</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                    </TableRow>
                  ))
                ) : prices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      لا توجد أسعار مضافة لهذه الشركة
                    </TableCell>
                  </TableRow>
                ) : (
                  prices.map((price) => (
                    <TableRow key={price.id}>
                      <TableCell className="font-medium">
                        {price.road_service?.name_ar || price.road_service?.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {AGE_BAND_LABELS[price.age_band]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={price.company_cost}
                          onChange={(e) => handleUpdatePrice(price.id, 'company_cost', parseFloat(e.target.value) || 0)}
                          className="w-24"
                          min={0}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={price.selling_price}
                          onChange={(e) => handleUpdatePrice(price.id, 'selling_price', parseFloat(e.target.value) || 0)}
                          className="w-24"
                          min={0}
                        />
                      </TableCell>
                      <TableCell>
                        <span className={price.selling_price - price.company_cost >= 0 ? 'text-success font-medium' : 'text-destructive font-medium'}>
                          ₪{(price.selling_price - price.company_cost).toLocaleString('en-US')}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeletePrice(price.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
