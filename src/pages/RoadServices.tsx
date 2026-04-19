import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Edit, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { RoadServiceDrawer } from '@/components/road-services/RoadServiceDrawer';
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog';
import type { Database } from '@/integrations/supabase/types';

type CarType = Database['public']['Enums']['car_type'];

interface RoadService {
  id: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  allowed_car_types: CarType[];
  active: boolean;
  sort_order: number;
  created_at: string;
}

const CAR_TYPE_LABELS: Record<CarType, string> = {
  car: 'خصوصي',
  cargo: 'شحن',
  small: 'أوتوبس زعير',
  taxi: 'تكسي',
  tjeradown4: 'تجاري أقل من 4 طن',
  tjeraup4: 'تجاري أكثر من 4 طن',
};

export default function RoadServices() {
  const { isAdmin } = useAuth();
  const [services, setServices] = useState<RoadService[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingService, setEditingService] = useState<RoadService | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingService, setDeletingService] = useState<RoadService | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('road_services')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (search) {
        query = query.or(`name.ilike.%${search}%,name_ar.ilike.%${search}%`);
      }

      const { data, error } = await query;

      if (error) throw error;
      setServices(data || []);
    } catch (error) {
      console.error('Error fetching road services:', error);
      toast.error('فشل في تحميل خدمات الطريق');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const handleAdd = () => {
    setEditingService(null);
    setDrawerOpen(true);
  };

  const handleEdit = (service: RoadService) => {
    setEditingService(service);
    setDrawerOpen(true);
  };

  const handleDelete = (service: RoadService) => {
    setDeletingService(service);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deletingService) return;
    
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('road_services')
        .delete()
        .eq('id', deletingService.id);

      if (error) throw error;

      toast.success('تم حذف الخدمة بنجاح');
      fetchServices();
    } catch (error) {
      console.error('Error deleting road service:', error);
      toast.error('فشل في حذف الخدمة');
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
      setDeletingService(null);
    }
  };

  const handleSaveSuccess = () => {
    setDrawerOpen(false);
    setEditingService(null);
    fetchServices();
  };

  if (!isAdmin) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">غير مصرح لك بالوصول لهذه الصفحة</p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <Header
        title="خدمات الطريق"
        subtitle="إدارة كتالوج خدمات الطريق"
      />

      <div className="p-6 space-y-6">
        {/* Toolbar */}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleAdd} className="gap-2">
            <Plus className="h-4 w-4" />
            إضافة خدمة
          </Button>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="بحث عن خدمة..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-10"
            />
          </div>
        </div>

        {/* Table */}
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">اسم الخدمة</TableHead>
                <TableHead className="text-right">أنواع السيارات المسموحة</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right">الترتيب</TableHead>
                <TableHead className="text-center w-24">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16 mx-auto" /></TableCell>
                  </TableRow>
                ))
              ) : services.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    لا توجد خدمات مضافة
                  </TableCell>
                </TableRow>
              ) : (
                services.map((service) => (
                  <TableRow key={service.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium">
                      {service.name_ar || service.name}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {service.allowed_car_types.map((type) => (
                          <Badge key={type} variant="secondary" className="text-xs">
                            {CAR_TYPE_LABELS[type] || type}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={service.active ? 'default' : 'secondary'}>
                        {service.active ? 'فعال' : 'معطل'}
                      </Badge>
                    </TableCell>
                    <TableCell>{service.sort_order}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(service)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(service)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <RoadServiceDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        service={editingService}
        onSaved={handleSaveSuccess}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDelete}
        loading={deleting}
        title="حذف خدمة الطريق"
        description={`هل أنت متأكد من حذف الخدمة "${deletingService?.name_ar || deletingService?.name}"؟ لا يمكن التراجع عن هذا الإجراء.`}
      />
    </MainLayout>
  );
}
