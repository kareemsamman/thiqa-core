import { useState, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Header } from '@/components/layout/Header';
import { FileUploader } from '@/components/media/FileUploader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Search, 
  Grid3X3, 
  List, 
  Trash2, 
  Copy, 
  Image as ImageIcon,
  FileText,
  Video,
  File,
  Upload,
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Calendar,
  ZoomIn,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface MediaFile {
  id: string;
  original_name: string;
  mime_type: string;
  size: number;
  cdn_url: string;
  entity_type: string | null;
  entity_id: string | null;
  uploaded_by: string | null;
  created_at: string;
}

const ITEMS_PER_PAGE = 20;

const getFileIcon = (mimeType: string) => {
  if (mimeType.startsWith('image/')) return ImageIcon;
  if (mimeType.startsWith('video/')) return Video;
  if (mimeType.includes('pdf')) return FileText;
  return File;
};

const getEntityLabel = (type: string | null) => {
  const labels: Record<string, string> = {
    client: 'عميل',
    car: 'سيارة',
    policy: 'وثيقة',
    cheque: 'شيك',
  };
  return type ? labels[type] || type : '-';
};

const MONTHS = [
  { value: '01', label: 'يناير' },
  { value: '02', label: 'فبراير' },
  { value: '03', label: 'مارس' },
  { value: '04', label: 'أبريل' },
  { value: '05', label: 'مايو' },
  { value: '06', label: 'يونيو' },
  { value: '07', label: 'يوليو' },
  { value: '08', label: 'أغسطس' },
  { value: '09', label: 'سبتمبر' },
  { value: '10', label: 'أكتوبر' },
  { value: '11', label: 'نوفمبر' },
  { value: '12', label: 'ديسمبر' },
];

export default function Media() {
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<MediaFile | null>(null);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const lastSelectedIndex = useRef<number | null>(null);

  // Fetch available years and months from database
  const fetchAvailableDates = async () => {
    try {
      const { data, error } = await supabase
        .from('media_files')
        .select('created_at')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const years = new Set<number>();
      const monthsByYear = new Map<number, Set<string>>();

      data?.forEach(file => {
        const date = new Date(file.created_at);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        years.add(year);
        
        if (!monthsByYear.has(year)) {
          monthsByYear.set(year, new Set());
        }
        monthsByYear.get(year)?.add(month);
      });

      setAvailableYears(Array.from(years).sort((a, b) => b - a));
      
      // Update available months when year changes
      if (yearFilter !== 'all') {
        const yearNum = parseInt(yearFilter);
        const months = monthsByYear.get(yearNum);
        setAvailableMonths(months ? Array.from(months).sort() : []);
      }
    } catch (error) {
      console.error('Error fetching dates:', error);
    }
  };

  useEffect(() => {
    fetchAvailableDates();
  }, []);

  // Update available months when year filter changes
  useEffect(() => {
    if (yearFilter === 'all') {
      setAvailableMonths([]);
      setMonthFilter('all');
    } else {
      // Re-fetch to get months for selected year
      const fetchMonthsForYear = async () => {
        const year = parseInt(yearFilter);
        const startDate = new Date(year, 0, 1).toISOString();
        const endDate = new Date(year, 11, 31, 23, 59, 59, 999).toISOString();

        const { data } = await supabase
          .from('media_files')
          .select('created_at')
          .is('deleted_at', null)
          .gte('created_at', startDate)
          .lte('created_at', endDate);

        const months = new Set<string>();
        data?.forEach(file => {
          const date = new Date(file.created_at);
          months.add(String(date.getMonth() + 1).padStart(2, '0'));
        });
        setAvailableMonths(Array.from(months).sort());
      };
      fetchMonthsForYear();
    }
  }, [yearFilter]);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('media_files')
        .select('*', { count: 'exact' })
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE - 1);

      if (searchQuery) {
        query = query.ilike('original_name', `%${searchQuery}%`);
      }

      if (typeFilter !== 'all') {
        if (typeFilter === 'image') {
          query = query.like('mime_type', 'image/%');
        } else if (typeFilter === 'pdf') {
          query = query.eq('mime_type', 'application/pdf');
        } else if (typeFilter === 'video') {
          query = query.like('mime_type', 'video/%');
        }
      }

      if (entityFilter !== 'all') {
        query = query.eq('entity_type', entityFilter);
      }

      // Year/Month filter
      if (yearFilter !== 'all') {
        const year = parseInt(yearFilter);
        if (monthFilter !== 'all') {
          const month = parseInt(monthFilter);
          const startDate = new Date(year, month - 1, 1).toISOString();
          const endDate = new Date(year, month, 0, 23, 59, 59, 999).toISOString();
          query = query.gte('created_at', startDate).lte('created_at', endDate);
        } else {
          const startDate = new Date(year, 0, 1).toISOString();
          const endDate = new Date(year, 11, 31, 23, 59, 59, 999).toISOString();
          query = query.gte('created_at', startDate).lte('created_at', endDate);
        }
      }

      const { data, error, count } = await query;

      if (error) throw error;

      setFiles(data || []);
      setTotalCount(count || 0);
    } catch (error: any) {
      console.error('Error fetching files:', error);
      toast.error('فشل تحميل الملفات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [page, searchQuery, typeFilter, entityFilter, yearFilter, monthFilter]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(files.map(f => f.id)));
    } else {
      setSelectedIds(new Set());
    }
    lastSelectedIndex.current = null;
  };

  const handleSelectOne = (id: string, checked: boolean, index: number, shiftKey: boolean) => {
    const newSelected = new Set(selectedIds);
    
    if (shiftKey && lastSelectedIndex.current !== null) {
      // Shift+click: select range
      const start = Math.min(lastSelectedIndex.current, index);
      const end = Math.max(lastSelectedIndex.current, index);
      
      for (let i = start; i <= end; i++) {
        newSelected.add(files[i].id);
      }
    } else {
      // Normal click
      if (checked) {
        newSelected.add(id);
      } else {
        newSelected.delete(id);
      }
    }
    
    lastSelectedIndex.current = index;
    setSelectedIds(newSelected);
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success('تم نسخ الرابط');
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;

    setDeleting(true);
    try {
      const response = await supabase.functions.invoke('delete-media', {
        body: { fileIds: Array.from(selectedIds) },
      });

      if (response.error) throw response.error;

      toast.success(`تم حذف ${response.data.deletedCount} ملفات`);
      setSelectedIds(new Set());
      fetchFiles();
      fetchAvailableDates(); // Refresh available dates
    } catch (error: any) {
      console.error('Delete error:', error);
      toast.error('فشل حذف الملفات');
    } finally {
      setDeleting(false);
    }
  };

  const handleUploadComplete = (uploadedFiles: MediaFile[]) => {
    setFiles(prev => [...uploadedFiles, ...prev]);
    setTotalCount(prev => prev + uploadedFiles.length);
    setUploaderOpen(false);
    fetchAvailableDates(); // Refresh available dates
    toast.success(`تم رفع ${uploadedFiles.length} ملفات بنجاح`);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  return (
    <MainLayout>
      <Helmet>
        <title>الوسائط | ثقة للتأمين</title>
      </Helmet>

      <Header
        title="الوسائط"
        subtitle="إدارة الصور والملفات"
      />

      <div className="p-6 space-y-6">
        {/* Filters Bar */}
        <div className="flex flex-wrap gap-3 items-center p-4 bg-card border border-border rounded-xl">
          <Dialog open={uploaderOpen} onOpenChange={setUploaderOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Upload className="h-4 w-4" />
                رفع ملفات
              </Button>
            </DialogTrigger>
            <DialogContent className="w-fit max-w-2xl">
              <DialogHeader>
                <DialogTitle>رفع ملفات جديدة</DialogTitle>
              </DialogHeader>
              <FileUploader onUploadComplete={handleUploadComplete} />
            </DialogContent>
          </Dialog>

          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="بحث في الملفات..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(0);
              }}
              className="pr-10"
            />
          </div>

          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="النوع" />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">كل الأنواع</SelectItem>
              <SelectItem value="image">صور</SelectItem>
              <SelectItem value="pdf">PDF</SelectItem>
              <SelectItem value="video">فيديو</SelectItem>
            </SelectContent>
          </Select>

          <Select value={entityFilter} onValueChange={(v) => { setEntityFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="مرتبط بـ" />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="client">عميل</SelectItem>
              <SelectItem value="car">سيارة</SelectItem>
              <SelectItem value="policy">وثيقة</SelectItem>
              <SelectItem value="cheque">شيك</SelectItem>
            </SelectContent>
          </Select>

          <Select value={yearFilter} onValueChange={(v) => { setYearFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[110px]">
              <Calendar className="h-4 w-4 ml-2 text-muted-foreground" />
              <SelectValue placeholder="السنة" />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">كل السنوات</SelectItem>
              {availableYears.map(year => (
                <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select 
            value={monthFilter} 
            onValueChange={(v) => { setMonthFilter(v); setPage(0); }}
            disabled={yearFilter === 'all'}
          >
            <SelectTrigger className="w-[110px]">
              <SelectValue placeholder="الشهر" />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">كل الشهور</SelectItem>
              {availableMonths.map(monthValue => {
                const month = MONTHS.find(m => m.value === monthValue);
                return (
                  <SelectItem key={monthValue} value={monthValue}>
                    {month?.label || monthValue}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          <div className="flex border border-border rounded-lg overflow-hidden">
            <Button
              variant={viewMode === 'table' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-none px-3"
              onClick={() => setViewMode('table')}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-none px-3"
              onClick={() => setViewMode('grid')}
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 mr-auto bg-destructive/10 px-3 py-1.5 rounded-lg">
              <span className="text-sm font-medium text-destructive">
                {selectedIds.size} محدد
              </span>
              <Button variant="destructive" size="sm" onClick={handleBulkDelete} disabled={deleting}>
                {deleting ? (
                  <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 ml-1" />
                )}
                {deleting ? 'جاري الحذف...' : 'حذف'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} disabled={deleting}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <File className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>لا توجد ملفات</p>
          </div>
        ) : viewMode === 'table' ? (
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedIds.size === files.length && files.length > 0}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead>الملف</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الحجم</TableHead>
                  <TableHead>مرتبط بـ</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead className="w-24">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file, index) => {
                  const FileIcon = getFileIcon(file.mime_type);
                  const isImage = file.mime_type.startsWith('image/');
                  return (
                    <TableRow key={file.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(file.id)}
                          onCheckedChange={(checked) => handleSelectOne(file.id, checked as boolean, index, false)}
                          onClick={(e) => {
                            if (e.shiftKey) {
                              e.preventDefault();
                              handleSelectOne(file.id, true, index, true);
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {isImage ? (
                            <img
                              src={file.cdn_url}
                              alt={file.original_name}
                              className="h-10 w-10 object-cover rounded cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                              onClick={() => setLightboxImage(file)}
                            />
                          ) : (
                            <div className="h-10 w-10 flex items-center justify-center bg-muted rounded">
                              <FileIcon className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                          <a
                            href={file.cdn_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm hover:underline truncate max-w-[200px]"
                          >
                            {file.original_name}
                          </a>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {file.mime_type.split('/')[1]?.toUpperCase() || file.mime_type}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatFileSize(file.size)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {getEntityLabel(file.entity_type)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(file.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {isImage && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setLightboxImage(file)}
                            >
                              <ZoomIn className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleCopyUrl(file.cdn_url)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {files.map((file, index) => {
              const FileIcon = getFileIcon(file.mime_type);
              const isImage = file.mime_type.startsWith('image/');
              return (
                <div
                  key={file.id}
                  className={cn(
                    'group relative border border-border rounded-lg overflow-hidden bg-card',
                    selectedIds.has(file.id) && 'ring-2 ring-primary'
                  )}
                >
                  <div className="absolute top-2 right-2 z-10">
                    <Checkbox
                      checked={selectedIds.has(file.id)}
                      onCheckedChange={(checked) => handleSelectOne(file.id, checked as boolean, index, false)}
                      onClick={(e) => {
                        if (e.shiftKey) {
                          e.preventDefault();
                          handleSelectOne(file.id, true, index, true);
                        }
                      }}
                      className="bg-background/80 backdrop-blur"
                    />
                  </div>
                  
                  <div
                    className="block aspect-square cursor-pointer"
                    onClick={() => isImage ? setLightboxImage(file) : window.open(file.cdn_url, '_blank')}
                  >
                    {isImage ? (
                      <img
                        src={file.cdn_url}
                        alt={file.original_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-muted">
                        <FileIcon className="h-12 w-12 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  <div className="p-2 border-t border-border">
                    <p className="text-xs truncate" title={file.original_name}>
                      {file.original_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)}
                    </p>
                  </div>

                  <button
                    className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-background/80 backdrop-blur rounded"
                    onClick={() => handleCopyUrl(file.cdn_url)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="icon"
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground px-4">
              صفحة {page + 1} من {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Lightbox */}
      <Dialog open={!!lightboxImage} onOpenChange={(open) => !open && setLightboxImage(null)}>
        <DialogContent className="max-w-4xl p-2 bg-black/95 border-none">
          {lightboxImage && (
            <div className="relative">
              <img
                src={lightboxImage.cdn_url}
                alt={lightboxImage.original_name}
                className="w-full h-auto max-h-[80vh] object-contain rounded"
              />
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                <p className="text-white text-sm font-medium truncate">{lightboxImage.original_name}</p>
                <div className="flex items-center gap-4 mt-1">
                  <span className="text-white/70 text-xs">{formatFileSize(lightboxImage.size)}</span>
                  <span className="text-white/70 text-xs">{formatDate(lightboxImage.created_at)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-white hover:bg-white/20 h-7"
                    onClick={() => handleCopyUrl(lightboxImage.cdn_url)}
                  >
                    <Copy className="h-3.5 w-3.5 ml-1" />
                    نسخ الرابط
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
