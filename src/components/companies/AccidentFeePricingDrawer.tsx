import { useState, useEffect, useCallback } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Save, Loader2 } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Company = Tables<'insurance_companies'>;

interface AccidentFeeService {
  id: string;
  name: string;
  name_ar: string | null;
  active: boolean;
}

interface AccidentFeePrice {
  id?: string;
  accident_fee_service_id: string;
  company_id: string;
  company_cost: number;
  selling_price: number;
}

interface AccidentFeePricingDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
}

export function AccidentFeePricingDrawer({ open, onOpenChange, company }: AccidentFeePricingDrawerProps) {
  const [services, setServices] = useState<AccidentFeeService[]>([]);
  const [prices, setPrices] = useState<Map<string, AccidentFeePrice>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editedPrices, setEditedPrices] = useState<Map<string, { company_cost: number; selling_price: number }>>(new Map());

  const fetchData = useCallback(async () => {
    if (!company) return;
    
    setLoading(true);
    try {
      // Fetch all active accident fee services
      const { data: servicesData, error: servicesError } = await supabase
        .from('accident_fee_services')
        .select('id, name, name_ar, active')
        .eq('active', true)
        .order('sort_order');

      if (servicesError) throw servicesError;
      setServices(servicesData || []);

      // Fetch existing prices for this company
      const { data: pricesData, error: pricesError } = await supabase
        .from('company_accident_fee_prices')
        .select('*')
        .eq('company_id', company.id);

      if (pricesError) throw pricesError;

      // Create a map of service_id -> price
      const priceMap = new Map<string, AccidentFeePrice>();
      const editedMap = new Map<string, { company_cost: number; selling_price: number }>();
      
      pricesData?.forEach((price: any) => {
        priceMap.set(price.accident_fee_service_id, price);
        editedMap.set(price.accident_fee_service_id, { 
          company_cost: price.company_cost, 
          selling_price: price.selling_price 
        });
      });

      // Initialize prices for services without existing prices
      servicesData?.forEach((service: AccidentFeeService) => {
        if (!priceMap.has(service.id)) {
          editedMap.set(service.id, { company_cost: 0, selling_price: 0 });
        }
      });

      setPrices(priceMap);
      setEditedPrices(editedMap);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('فشل في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [company]);

  useEffect(() => {
    if (open && company) {
      fetchData();
    }
  }, [open, company, fetchData]);

  const handlePriceChange = (serviceId: string, field: 'company_cost' | 'selling_price', value: string) => {
    const numValue = parseFloat(value) || 0;
    setEditedPrices(prev => {
      const newMap = new Map(prev);
      const current = newMap.get(serviceId) || { company_cost: 0, selling_price: 0 };
      newMap.set(serviceId, { ...current, [field]: numValue });
      return newMap;
    });
  };

  const handleSave = async () => {
    if (!company) return;

    setSaving(true);
    try {
      // Prepare upsert data
      for (const [serviceId, priceData] of editedPrices.entries()) {
        const existingPrice = prices.get(serviceId);
        
        if (existingPrice?.id) {
          // Update existing
          const { error } = await supabase
            .from('company_accident_fee_prices')
            .update({ 
              company_cost: priceData.company_cost,
              selling_price: priceData.selling_price,
            })
            .eq('id', existingPrice.id);
          
          if (error) throw error;
        } else {
          // Insert new
          const { error } = await supabase
            .from('company_accident_fee_prices')
            .insert({
              company_id: company.id,
              accident_fee_service_id: serviceId,
              company_cost: priceData.company_cost,
              selling_price: priceData.selling_price,
            });
          
          if (error) throw error;
        }
      }

      toast.success('تم حفظ الأسعار بنجاح');
      fetchData(); // Refresh data
    } catch (error: any) {
      console.error('Error saving prices:', error);
      toast.error(error.message || 'فشل في حفظ الأسعار');
    } finally {
      setSaving(false);
    }
  };

  if (!company) return null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader className="flex flex-row items-center justify-between">
          <DrawerTitle>
            أسعار إعفاء رسوم الحادث - {company.name_ar || company.name}
          </DrawerTitle>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            حفظ الأسعار
          </Button>
        </DrawerHeader>

        <div className="p-4 overflow-y-auto">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : services.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              لا توجد خدمات إعفاء رسوم حادث مضافة
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الخدمة</TableHead>
                  <TableHead className="text-right w-40">تكلفة الشركة (₪)</TableHead>
                  <TableHead className="text-right w-40">سعر البيع (₪)</TableHead>
                  <TableHead className="text-right w-32">الربح (₪)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map((service) => {
                  const priceData = editedPrices.get(service.id) || { company_cost: 0, selling_price: 0 };
                  const profit = priceData.selling_price - priceData.company_cost;
                  
                  return (
                    <TableRow key={service.id}>
                      <TableCell className="font-medium">
                        {service.name_ar || service.name}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={priceData.company_cost}
                          onChange={(e) => handlePriceChange(service.id, 'company_cost', e.target.value)}
                          className="w-32 ltr-input"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={priceData.selling_price}
                          onChange={(e) => handlePriceChange(service.id, 'selling_price', e.target.value)}
                          className="w-32 ltr-input"
                        />
                      </TableCell>
                      <TableCell>
                        <span className={profit >= 0 ? 'text-success font-medium' : 'text-destructive font-medium'}>
                          ₪{profit.toLocaleString('en-US')}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
