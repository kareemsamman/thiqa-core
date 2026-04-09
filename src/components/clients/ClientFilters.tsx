import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Filter, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBranches } from "@/hooks/useBranches";

interface ClientFiltersProps {
  onFiltersChange: (filters: ClientFilterValues) => void;
  filters: ClientFilterValues;
}

export interface ClientFilterValues {
  brokerId: string;
  ageGroup: string;
  branchId: string;
}

export function ClientFilters({ onFiltersChange, filters }: ClientFiltersProps) {
  const { isAdmin } = useAuth();
  const { branches } = useBranches();
  const [open, setOpen] = useState(false);
  const [brokers, setBrokers] = useState<{ id: string; name: string }[]>([]);
  const [localFilters, setLocalFilters] = useState<ClientFilterValues>(filters);

  useEffect(() => {
    const fetchBrokers = async () => {
      const { data } = await supabase.from('brokers').select('id, name').order('name');
      if (data) setBrokers(data);
    };
    fetchBrokers();
  }, []);

  const activeFiltersCount = Object.values(filters).filter(v => v && v !== 'all').length;

  const handleApply = () => {
    onFiltersChange(localFilters);
    setOpen(false);
  };

  const handleClear = () => {
    const cleared: ClientFilterValues = {
      brokerId: 'all',
      ageGroup: 'all',
      branchId: 'all',
    };
    setLocalFilters(cleared);
    onFiltersChange(cleared);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="relative">
          <Filter className="h-4 w-4 ml-1" />
          <span className="hidden sm:inline">فلترة</span>
          {activeFiltersCount > 0 && (
            <Badge className="absolute -top-2 -left-2 h-5 w-5 p-0 flex items-center justify-center text-xs">
              {activeFiltersCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4" align="end" dir="rtl">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-right">فلترة</h4>
            <Button variant="ghost" size="sm" onClick={handleClear} className="text-muted-foreground h-8">
              <X className="h-3 w-3 ml-1" />
              مسح
            </Button>
          </div>

          {/* Broker */}
          <div className="space-y-1.5">
            <Label className="text-right block text-sm">الوسيط</Label>
            <Select value={localFilters.brokerId} onValueChange={v => setLocalFilters(f => ({ ...f, brokerId: v }))}>
              <SelectTrigger className="h-9 text-right">
                <SelectValue placeholder="الكل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-right">الكل</SelectItem>
                {brokers.map(b => (
                  <SelectItem key={b.id} value={b.id} className="text-right">{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Age Group */}
          <div className="space-y-1.5">
            <Label className="text-right block text-sm">فئة العمر</Label>
            <Select value={localFilters.ageGroup} onValueChange={v => setLocalFilters(f => ({ ...f, ageGroup: v }))}>
              <SelectTrigger className="h-9 text-right">
                <SelectValue placeholder="الكل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-right">الكل</SelectItem>
                <SelectItem value="under24" className="text-right">أقل من 24 سنة</SelectItem>
                <SelectItem value="over24" className="text-right">24 سنة فأكثر</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Branch - Only for admins */}
          {isAdmin && (
            <div className="space-y-1.5">
              <Label className="text-right block text-sm">الفرع</Label>
              <Select value={localFilters.branchId} onValueChange={v => setLocalFilters(f => ({ ...f, branchId: v }))}>
                <SelectTrigger className="h-9 text-right">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-right">الكل</SelectItem>
                  {branches.map(b => (
                    <SelectItem key={b.id} value={b.id} className="text-right">{b.name_ar || b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button className="w-full" onClick={handleApply}>
            تطبيق
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
