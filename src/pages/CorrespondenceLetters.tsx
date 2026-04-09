import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Search,
  Plus,
  Eye,
  Edit,
  Trash2,
  Send,
  Printer,
  MoreHorizontal,
  Mail,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { LetterDrawer } from '@/components/correspondence/LetterDrawer';
import { SendSmsModal } from '@/components/correspondence/SendSmsModal';
import { LetterPreview } from '@/components/correspondence/LetterPreview';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Letter {
  id: string;
  title: string;
  recipient_name: string;
  recipient_phone: string | null;
  body_html: string | null;
  generated_url: string | null;
  status: string;
  sent_at: string | null;
  created_at: string;
}

export default function CorrespondenceLetters() {
  const [letters, setLetters] = useState<Letter[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  // Drawer & Modal states
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingLetter, setEditingLetter] = useState<Letter | null>(null);
  const [smsModalOpen, setSmsModalOpen] = useState(false);
  const [selectedLetter, setSelectedLetter] = useState<Letter | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  useEffect(() => {
    fetchLetters();
  }, []);

  async function fetchLetters() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('correspondence_letters')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setLetters(data || []);
    } catch (error) {
      console.error('Error fetching letters:', error);
      toast.error('فشل تحميل الرسائل');
    } finally {
      setLoading(false);
    }
  }

  // Filter letters
  const filteredLetters = letters.filter((letter) => {
    const matchesSearch =
      !searchQuery ||
      letter.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      letter.recipient_name.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus =
      statusFilter === 'all' || letter.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  function handleCreate() {
    setEditingLetter(null);
    setDrawerOpen(true);
  }

  function handleEdit(letter: Letter) {
    setEditingLetter(letter);
    setDrawerOpen(true);
  }

  function handlePreview(letter: Letter) {
    setSelectedLetter(letter);
    setPreviewOpen(true);
  }

  function handleSendSms(letter: Letter) {
    setSelectedLetter(letter);
    setSmsModalOpen(true);
  }

  async function handleGenerateAndPrint(letter: Letter) {
    setGeneratingId(letter.id);
    try {
      const { data, error } = await supabase.functions.invoke('generate-correspondence-html', {
        body: { letter_id: letter.id },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Refresh to get updated URL
      await fetchLetters();

      // Open in new tab for printing
      if (data?.url) {
        window.open(data.url + '?print=1', '_blank');
      }
    } catch (error) {
      console.error('Error generating HTML:', error);
      toast.error('فشل إنشاء الملف');
    } finally {
      setGeneratingId(null);
    }
  }

  function handleViewExternal(letter: Letter) {
    if (letter.generated_url) {
      window.open(letter.generated_url, '_blank');
    } else {
      toast.error('لم يتم إنشاء رابط الرسالة بعد');
    }
  }

  function confirmDelete(id: string) {
    setDeletingId(id);
    setDeleteDialogOpen(true);
  }

  async function handleDelete() {
    if (!deletingId) return;
    
    try {
      const { error } = await supabase
        .from('correspondence_letters')
        .delete()
        .eq('id', deletingId);

      if (error) throw error;
      toast.success('تم حذف الرسالة');
      fetchLetters();
    } catch (error) {
      console.error('Error deleting letter:', error);
      toast.error('فشل حذف الرسالة');
    } finally {
      setDeleteDialogOpen(false);
      setDeletingId(null);
    }
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'sent':
        return <Badge className="bg-primary text-primary-foreground">مُرسل</Badge>;
      case 'viewed':
        return <Badge className="bg-accent text-accent-foreground">تم العرض</Badge>;
      default:
        return <Badge variant="secondary">مسودة</Badge>;
    }
  }

  return (
    <MainLayout>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="h-6 w-6" />
            الترويسات
          </h1>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 ml-2" />
            رسالة جديدة
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="بحث بالعنوان أو المستلم..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pr-10"
                />
              </div>
              <div className="flex gap-2">
                {['all', 'draft', 'sent'].map((status) => (
                  <Button
                    key={status}
                    variant={statusFilter === status ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setStatusFilter(status)}
                  >
                    {status === 'all' ? 'الكل' : status === 'draft' ? 'مسودة' : 'مُرسل'}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filteredLetters.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                لا توجد رسائل
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>العنوان</TableHead>
                    <TableHead>المستلم</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead className="w-[100px]">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLetters.map((letter) => (
                    <TableRow key={letter.id}>
                      <TableCell className="font-medium">{letter.title}</TableCell>
                      <TableCell>{letter.recipient_name}</TableCell>
                      <TableCell>{getStatusBadge(letter.status)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(letter.created_at), 'dd/MM/yyyy', { locale: ar })}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handlePreview(letter)}>
                              <Eye className="h-4 w-4 ml-2" />
                              معاينة
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleEdit(letter)}>
                              <Edit className="h-4 w-4 ml-2" />
                              تعديل
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => handleGenerateAndPrint(letter)}
                              disabled={generatingId === letter.id}
                            >
                              {generatingId === letter.id ? (
                                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                              ) : (
                                <Printer className="h-4 w-4 ml-2" />
                              )}
                              طباعة
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleSendSms(letter)}>
                              <Send className="h-4 w-4 ml-2" />
                              إرسال SMS
                            </DropdownMenuItem>
                            {letter.generated_url && (
                              <DropdownMenuItem onClick={() => handleViewExternal(letter)}>
                                <ExternalLink className="h-4 w-4 ml-2" />
                                فتح الرابط
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem 
                              onClick={() => confirmDelete(letter.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4 ml-2" />
                              حذف
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Drawer for Create/Edit */}
      <LetterDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        letter={editingLetter}
        onSaved={fetchLetters}
      />

      {/* SMS Modal */}
      {selectedLetter && (
        <SendSmsModal
          open={smsModalOpen}
          onOpenChange={setSmsModalOpen}
          letterId={selectedLetter.id}
          defaultPhone={selectedLetter.recipient_phone}
          recipientName={selectedLetter.recipient_name}
          onSent={fetchLetters}
        />
      )}

      {/* Preview Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>معاينة الرسالة</span>
              {selectedLetter && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleGenerateAndPrint(selectedLetter)}
                  disabled={generatingId === selectedLetter.id}
                >
                  {generatingId === selectedLetter.id ? (
                    <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  ) : (
                    <Printer className="h-4 w-4 ml-2" />
                  )}
                  طباعة
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          {selectedLetter && (
            <LetterPreview
              title={selectedLetter.title}
              recipientName={selectedLetter.recipient_name}
              bodyHtml={selectedLetter.body_html || ''}
              createdAt={selectedLetter.created_at}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذه الرسالة؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
