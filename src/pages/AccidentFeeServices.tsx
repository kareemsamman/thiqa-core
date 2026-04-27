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
import { toast } from 'sonner';
import { AccidentFeeServiceDrawer } from '@/components/accident-fees/AccidentFeeServiceDrawer';
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog';

interface AccidentFeeService {
  id: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
}

// Access is gated by <PermissionRoute permission="page.accident_fees"
// feature="accident_fees"> at the route level — admins bypass; workers
// need both the permission grant and the agent's plan to include the
// feature. No in-page guard needed.
export default function AccidentFeeServices() {
  const [services, setServices] = useState<AccidentFeeService[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingService, setEditingService] = useState<AccidentFeeService | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingService, setDeletingService] = useState<AccidentFeeService | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('accident_fee_services')
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
      console.error('Error fetching accident fee services:', error);
      toast.error('فشل في تحميل خدمات إعفاء رسوم الحادث');
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

  const handleEdit = (service: AccidentFeeService) => {
    setEditingService(service);
    setDrawerOpen(true);
  };

  const handleDelete = (service: AccidentFeeService) => {
    setDeletingService(service);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deletingService) return;
    
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('accident_fee_services')
        .delete()
        .eq('id', deletingService.id);

      if (error) throw error;

      toast.success('تم حذف الخدمة بنجاح');
      fetchServices();
    } catch (error) {
      console.error('Error deleting accident fee service:', error);
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

  return (
    <MainLayout>
      <Header
        title="إعفاء رسوم الحادث"
        subtitle="إدارة كتالوج خدمات إعفاء رسوم الحادث"
      />

      <div className="md:p-6 space-y-6">
        {/* Toolbar — search and CTA stack on mobile, inline on sm+. */}
        <div className="space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between sm:gap-2">
          <div className="relative w-full sm:flex-1 sm:max-w-md">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="بحث عن خدمة..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-10"
            />
          </div>
          <Button onClick={handleAdd} className="gap-2 w-full sm:w-auto">
            <Plus className="h-4 w-4" />
            إضافة خدمة
          </Button>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden space-y-2">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-lg border bg-card p-3 space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
            ))
          ) : services.length === 0 ? (
            <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
              لا توجد خدمات مضافة
            </div>
          ) : (
            services.map((service) => (
              <div key={service.id} className="rounded-lg border bg-card p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="font-semibold flex-1 min-w-0">{service.name_ar || service.name}</p>
                  <Badge variant={service.active ? 'default' : 'secondary'} className="shrink-0">
                    {service.active ? 'فعال' : 'معطل'}
                  </Badge>
                </div>
                {service.description && (
                  <p className="text-sm text-muted-foreground mb-3">{service.description}</p>
                )}
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-xs text-muted-foreground">الترتيب: {service.sort_order}</span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(service)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(service)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">اسم الخدمة</TableHead>
                <TableHead className="text-right">الوصف</TableHead>
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
                    <TableCell className="text-muted-foreground max-w-xs truncate">
                      {service.description || '-'}
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

      <AccidentFeeServiceDrawer
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
        title="حذف خدمة إعفاء رسوم الحادث"
        description={`هل أنت متأكد من حذف الخدمة "${deletingService?.name_ar || deletingService?.name}"؟ لا يمكن التراجع عن هذا الإجراء.`}
      />
    </MainLayout>
  );
}