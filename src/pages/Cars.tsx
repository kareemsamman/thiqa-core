import { useState, useEffect, useCallback } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Car as CarIcon,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CarDrawer } from "@/components/cars/CarDrawer";
import { RowActionsMenu } from "@/components/shared/RowActionsMenu";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";

interface CarRecord {
  id: string;
  car_number: string;
  client_id: string;
  manufacturer_name: string | null;
  model: string | null;
  model_number: string | null;
  year: number | null;
  color: string | null;
  car_type: string | null;
  car_value: number | null;
  license_type: string | null;
  license_expiry: string | null;
  last_license: string | null;
  branch_id: string | null;
  created_by_admin_id: string | null;
  clients?: {
    full_name: string;
  };
  branch?: {
    id: string;
    name: string;
    name_ar: string | null;
  };
  created_by?: {
    full_name: string | null;
    email: string;
  };
}

const licenseColors: Record<string, string> = {
  "car": "bg-blue-500/10 text-blue-600 border-blue-500/20",
  "cargo": "bg-orange-500/10 text-orange-600 border-orange-500/20",
  "taxi": "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  "small": "bg-green-500/10 text-green-600 border-green-500/20",
  "tjeradown4": "bg-purple-500/10 text-purple-600 border-purple-500/20",
  "tjeraup4": "bg-pink-500/10 text-pink-600 border-pink-500/20",
};

const carTypeLabels: Record<string, string> = {
  "car": "خصوصي",
  "cargo": "شحن",
  "taxi": "تاكسي",
  "small": "اوتوبس زعير",
  "tjeradown4": "تجاري < 4",
  "tjeraup4": "تجاري > 4",
};

export default function Cars() {
  const { toast } = useToast();
  const [cars, setCars] = useState<CarRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 25;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedCar, setSelectedCar] = useState<CarRecord | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingCar, setDeletingCar] = useState<CarRecord | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchCars = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('cars')
        .select('*, clients(full_name), branch:branches(id, name, name_ar), created_by:profiles!cars_created_by_admin_id_fkey(full_name, email)', { count: 'exact' })
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range((currentPage - 1) * pageSize, currentPage * pageSize - 1);

      if (searchQuery) {
        query = query.or(
          `car_number.ilike.%${searchQuery}%,manufacturer_name.ilike.%${searchQuery}%,model.ilike.%${searchQuery}%`
        );
      }

      const { data, error, count } = await query;

      if (error) throw error;
      setCars(data || []);
      setTotalCount(count || 0);
    } catch (error) {
      console.error('Error fetching cars:', error);
      toast({ title: "خطأ", description: "فشل في تحميل السيارات", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [currentPage, searchQuery, toast]);

  useEffect(() => {
    fetchCars();
  }, [fetchCars]);

  useEffect(() => {
    const handler = () => fetchCars();
    window.addEventListener("thiqa:policy-created", handler);
    return () => window.removeEventListener("thiqa:policy-created", handler);
  }, [fetchCars]);

  const handleDelete = async () => {
    if (!deletingCar) return;
    setDeleteLoading(true);
    try {
      const { error } = await supabase
        .from('cars')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', deletingCar.id);

      if (error) throw error;
      toast({ title: "تم الحذف", description: "تم حذف السيارة بنجاح" });
      fetchCars();
    } catch (error) {
      toast({ title: "خطأ", description: "فشل في حذف السيارة", variant: "destructive" });
    } finally {
      setDeleteLoading(false);
      setDeleteDialogOpen(false);
      setDeletingCar(null);
    }
  };

  const isExpiringSoon = (date: string | null) => {
    if (!date) return false;
    const expiry = new Date(date);
    const now = new Date();
    const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 30 && diffDays > 0;
  };

  const isExpired = (date: string | null) => {
    if (!date) return false;
    return new Date(date) < new Date();
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString('en-GB');
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <MainLayout>
      <Header
        title="السيارات"
        subtitle="إدارة قاعدة بيانات المركبات"
      />

      <div className="p-6 space-y-4">
        {/* Toolbar */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="بحث برقم السيارة، المصنع، الموديل..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="pr-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Filter className="ml-2 h-4 w-4" />
              فلترة
            </Button>
          </div>
        </div>

        {/* Table */}
        <Card className="border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="text-muted-foreground font-medium">المركبة</TableHead>
                  <TableHead className="text-muted-foreground font-medium">المالك</TableHead>
                  <TableHead className="text-muted-foreground font-medium">النوع</TableHead>
                  <TableHead className="text-muted-foreground font-medium">اللون</TableHead>
                  <TableHead className="text-muted-foreground font-medium">القيمة</TableHead>
                  <TableHead className="text-muted-foreground font-medium">الفرع</TableHead>
                  <TableHead className="text-muted-foreground font-medium">أنشئ بواسطة</TableHead>
                  <TableHead className="text-muted-foreground font-medium">انتهاء الرخصة</TableHead>
                  <TableHead className="text-muted-foreground font-medium w-[80px]">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-10 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                    </TableRow>
                  ))
                ) : cars.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      لا توجد بيانات
                    </TableCell>
                  </TableRow>
                ) : (
                  cars.map((car, index) => (
                    <TableRow
                      key={car.id}
                      onClick={() => {
                        setSelectedCar(car);
                        setDrawerOpen(true);
                      }}
                      className={cn(
                        "border-border/30 transition-colors cursor-pointer",
                        "hover:bg-secondary/50 animate-fade-in"
                      )}
                      style={{ animationDelay: `${index * 30}ms` }}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
                            <CarIcon className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-mono font-medium text-foreground"><bdi>{car.car_number}</bdi></p>
                            <p className="text-sm text-muted-foreground">
                              {car.manufacturer_name || ""} {car.model || ""} {car.year || ""}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">
                        {car.clients?.full_name || "-"}
                      </TableCell>
                      <TableCell>
                        {car.car_type ? (
                          <Badge className={cn("border", licenseColors[car.car_type] || "bg-secondary")}>
                            {carTypeLabels[car.car_type] || car.car_type}
                          </Badge>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{car.color || "-"}</TableCell>
                      <TableCell className="font-medium">
                        {car.car_value ? `₪${car.car_value.toLocaleString('en-US')}` : "-"}
                      </TableCell>
                      <TableCell>
                        {car.branch ? (
                          <Badge variant="outline" className="gap-1 bg-blue-500/10 text-blue-700 border-blue-500/20">
                            <Building2 className="h-3 w-3" />
                            {car.branch.name_ar || car.branch.name}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {car.created_by?.full_name || car.created_by?.email || "-"}
                      </TableCell>
                      <TableCell>
                        {car.license_expiry ? (
                          <Badge
                            variant={
                              isExpired(car.license_expiry)
                                ? "destructive"
                                : isExpiringSoon(car.license_expiry)
                                ? "warning"
                                : "outline"
                            }
                          >
                            {formatDate(car.license_expiry)}
                          </Badge>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <RowActionsMenu
                          onView={() => {
                            setSelectedCar(car);
                            setDrawerOpen(true);
                          }}
                          onEdit={() => {
                            setSelectedCar(car);
                            setDrawerOpen(true);
                          }}
                          onDelete={() => {
                            setDeletingCar(car);
                            setDeleteDialogOpen(true);
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-border/30 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              عرض {cars.length} من {totalCount} سيارة
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                صفحة {currentPage} من {totalPages || 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <CarDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        car={selectedCar}
        onSaved={() => {
          fetchCars();
          setDrawerOpen(false);
        }}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDelete}
        title="حذف السيارة"
        description={`هل أنت متأكد من حذف السيارة "${deletingCar?.car_number}"؟`}
        loading={deleteLoading}
      />
    </MainLayout>
  );
}