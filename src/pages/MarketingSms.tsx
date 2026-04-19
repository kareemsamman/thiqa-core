import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Send, Image, Users, CheckCircle, XCircle, Clock, Loader2, Upload, Link, History, Copy, Eye, Video, RefreshCw, AlertTriangle, Phone, User } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { extractFunctionErrorMessage, toastFunctionError } from '@/lib/functionError';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { arDZ as ar } from 'date-fns/locale';

interface Client {
  id: string;
  full_name: string;
  phone_number: string | null;
  file_number: string | null;
}

interface Campaign {
  id: string;
  title: string;
  message: string;
  image_url: string | null;
  recipients_count: number;
  sent_count: number;
  failed_count: number;
  delivered_count: number;
  dlr_failed_count: number;
  last_dlr_check_at: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
}

interface CampaignRecipient {
  id: string;
  client_id: string;
  phone_number: string;
  status: string;
  error_message: string | null;
  sent_at: string | null;
  dlr_status: string | null;
  dlr_message: string | null;
  dlr_checked_at: string | null;
  clients: { full_name: string } | null;
}

export default function MarketingSms() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('compose');
  
  // Compose state
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState<'image' | 'video' | ''>('');
  const [isUploading, setIsUploading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  
  // Customer selection state
  const [searchQuery, setSearchQuery] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  
  // Campaign history state
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);
  
  // Campaign details modal
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [campaignRecipients, setCampaignRecipients] = useState<CampaignRecipient[]>([]);
  const [isLoadingRecipients, setIsLoadingRecipients] = useState(false);
  const [isCheckingDlr, setIsCheckingDlr] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  // Fetch clients
  useEffect(() => {
    fetchClients();
  }, []);

  // Filter clients based on search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredClients(clients);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredClients(
        clients.filter(
          c =>
            c.full_name?.toLowerCase().includes(query) ||
            c.phone_number?.includes(query) ||
            c.file_number?.toLowerCase().includes(query)
        )
      );
    }
  }, [searchQuery, clients]);

  // Fetch campaigns when history tab is active
  useEffect(() => {
    if (activeTab === 'history') {
      fetchCampaigns();
    }
  }, [activeTab]);

  async function fetchClients() {
    setIsLoadingClients(true);
    try {
      // Fetch all clients - use range to bypass 1000 limit
      let allClients: Client[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('clients')
          .select('id, full_name, phone_number, file_number')
          .is('deleted_at', null)
          .not('phone_number', 'is', null)
          .order('full_name')
          .range(from, from + batchSize - 1);

        if (error) throw error;
        
        if (data && data.length > 0) {
          allClients = [...allClients, ...data];
          from += batchSize;
          hasMore = data.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      setClients(allClients);
      setFilteredClients(allClients);
    } catch (error) {
      console.error('Error fetching clients:', error);
      toast.error('فشل تحميل العملاء');
    } finally {
      setIsLoadingClients(false);
    }
  }

  async function fetchCampaigns() {
    setIsLoadingCampaigns(true);
    try {
      const { data, error } = await supabase
        .from('marketing_sms_campaigns')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setCampaigns(data || []);
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      toast.error('فشل تحميل الحملات');
    } finally {
      setIsLoadingCampaigns(false);
    }
  }

  async function fetchCampaignRecipients(campaignId: string) {
    setIsLoadingRecipients(true);
    try {
      const { data, error } = await supabase
        .from('marketing_sms_recipients')
        .select('id, client_id, phone_number, status, error_message, sent_at, dlr_status, dlr_message, dlr_checked_at, clients(full_name)')
        .eq('campaign_id', campaignId)
        .order('status', { ascending: true });

      if (error) throw error;
      setCampaignRecipients((data as CampaignRecipient[]) || []);
    } catch (error) {
      console.error('Error fetching recipients:', error);
      toast.error('فشل تحميل المستلمين');
    } finally {
      setIsLoadingRecipients(false);
    }
  }


  async function handleCheckDelivery(campaignId: string) {
    setIsCheckingDlr(true);
    try {
      const response = await supabase.functions.invoke('check-sms-delivery', {
        body: { campaign_id: campaignId },
      });

      if (response.error) throw response.error;
      const data = response.data;
      
      if (data?.error) {
        toast.error(data.error);
        return;
      }

      toast.success(`تم الفحص: ${data.delivered || 0} وصلت، ${data.failed || 0} فشلت`);
      
      // Refresh recipients and campaign
      fetchCampaignRecipients(campaignId);
      fetchCampaigns();
    } catch (error) {
      console.error('Error checking delivery:', error);
      toast.error('فشل فحص التسليم');
    } finally {
      setIsCheckingDlr(false);
    }
  }

  async function handleRetryPending(campaignId: string) {
    setIsRetrying(true);
    try {
      const response = await supabase.functions.invoke('send-marketing-sms', {
        body: { campaign_id: campaignId },
      });

      if (response.error) throw response.error;
      const data = response.data;
      
      if (data?.error) {
        toast.error(data.error);
        return;
      }

      toast.success(`تم استئناف الإرسال – ${data.batchSent || 0} أُرسلت، ${data.remaining || 0} متبقي`);
      fetchCampaignRecipients(campaignId);
      fetchCampaigns();
    } catch (error) {
      console.error('Error retrying pending:', error);
      toast.error('فشل استئناف الإرسال');
    } finally {
      setIsRetrying(false);
    }
  }

  function handleViewCampaign(campaign: Campaign) {
    setSelectedCampaign(campaign);
    fetchCampaignRecipients(campaign.id);
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast.success('تم نسخ الرابط');
  }

  function handleSelectAll(checked: boolean) {
    setSelectAll(checked);
    if (checked) {
      // Select all clients with phone numbers from filtered list
      const validClients = filteredClients.filter(c => c.phone_number);
      setSelectedClientIds(new Set(validClients.map(c => c.id)));
    } else {
      setSelectedClientIds(new Set());
    }
  }

  function handleSelectClient(clientId: string, checked: boolean) {
    const newSelected = new Set(selectedClientIds);
    if (checked) {
      newSelected.add(clientId);
    } else {
      newSelected.delete(clientId);
    }
    setSelectedClientIds(newSelected);
    setSelectAll(false);
  }

  async function handleMediaUpload(event: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'video') {
    const file = event.target.files?.[0];
    if (!file) return;

    if (type === 'image' && !file.type.startsWith('image/')) {
      toast.error('يرجى اختيار صورة فقط');
      return;
    }
    if (type === 'video' && !file.type.startsWith('video/')) {
      toast.error('يرجى اختيار فيديو فقط');
      return;
    }

    setIsUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const formData = new FormData();
      formData.append('file', file);
      formData.append('entity_type', 'marketing_sms');

      const response = await supabase.functions.invoke('upload-media', {
        body: formData,
      });

      if (response.error) throw response.error;
      
      const cdnUrl = response.data?.file?.cdn_url;
      if (cdnUrl) {
        setMediaUrl(cdnUrl);
        setMediaType(type);
        toast.success(type === 'image' ? 'تم رفع الصورة بنجاح' : 'تم رفع الفيديو بنجاح');
      } else {
        throw new Error('No CDN URL returned');
      }
    } catch (error) {
      console.error('Error uploading media:', error);
      toast.error('فشل رفع الملف');
    } finally {
      setIsUploading(false);
    }
  }

  function insertLink() {
    const url = prompt('أدخل الرابط:');
    if (url) {
      setMessage(prev => prev + ' ' + url);
    }
  }

  async function handleSendCampaign() {
    if (!title.trim()) {
      toast.error('يرجى إدخال عنوان الحملة');
      return;
    }
    if (!message.trim()) {
      toast.error('يرجى إدخال نص الرسالة');
      return;
    }
    if (selectedClientIds.size === 0) {
      toast.error('يرجى اختيار عميل واحد على الأقل');
      return;
    }

    setIsSending(true);
    try {
      // Get selected clients with phone numbers
      const selectedClients = clients.filter(
        c => selectedClientIds.has(c.id) && c.phone_number
      );

      const response = await supabase.functions.invoke('send-marketing-sms', {
        body: {
          title,
          message: mediaUrl ? `${message}\n${mediaUrl}` : message,
          imageUrl: mediaUrl,
          recipients: selectedClients.map(c => ({
            clientId: c.id,
            phone: c.phone_number,
            name: c.full_name,
          })),
        },
      });

      if (response.error) throw response.error;

      toast.success(`تم إرسال الحملة إلى ${selectedClients.length} عميل`);
      
      // Reset form
      setTitle('');
      setMessage('');
      setMediaUrl('');
      setMediaType('');
      setSelectedClientIds(new Set());
      setSelectAll(false);
      
      // Switch to history tab
      setActiveTab('history');
    } catch (error) {
      console.error('Error sending campaign:', error);
      await toastFunctionError(error, 'فشل إرسال الحملة');
    } finally {
      setIsSending(false);
    }
  }

  function getStatusBadge(campaign: Campaign) {
    switch (campaign.status) {
      case 'completed':
        return <Badge className="bg-emerald-600 text-white">مكتمل</Badge>;
      case 'sending':
        return (
          <Badge className="bg-blue-500 text-white">
            جاري الإرسال ({campaign.sent_count + campaign.failed_count}/{campaign.recipients_count})
          </Badge>
        );
      case 'failed':
        return <Badge variant="destructive">فشل</Badge>;
      default:
        return <Badge variant="secondary">مسودة</Badge>;
    }
  }

  function getRecipientSendBadge(status: string) {
    switch (status) {
      case 'sent':
      case 'delivered':
        return <Badge className="bg-emerald-600 text-white">تم الإرسال</Badge>;
      case 'failed':
        return <Badge variant="destructive">فشل الإرسال</Badge>;
      case 'pending':
        return <Badge variant="secondary"><Clock className="h-3 w-3 ml-1 inline" />قيد الإرسال</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  }

  function getRecipientDlrBadge(dlrStatus: string | null) {
    if (!dlrStatus) return <Badge variant="outline" className="text-muted-foreground">لم يُفحص</Badge>;
    
    switch (dlrStatus) {
      case 'delivered':
        return <Badge className="bg-emerald-600 text-white"><CheckCircle className="h-3 w-3 ml-1 inline" />وصلت</Badge>;
      case 'pending':
      case 'sent_no_confirmation':
        return <Badge className="bg-amber-500 text-white"><Clock className="h-3 w-3 ml-1 inline" />بانتظار التأكيد</Badge>;
      case 'failed':
      case 'failed_cellular':
      case 'not_delivered':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 ml-1 inline" />لم تصل</Badge>;
      case 'timeout':
        return <Badge variant="destructive">انتهت المهلة</Badge>;
      case 'expired':
        return <Badge variant="destructive">منتهية</Badge>;
      case 'blocked_marketing':
        return <Badge variant="destructive">محظور تسويقي</Badge>;
      case 'kosher_number':
        return <Badge variant="destructive">رقم كشر</Badge>;
      case 'rejected':
      case 'send_error':
        return <Badge variant="destructive">مرفوض</Badge>;
      case 'out_of_coverage':
        return <Badge variant="destructive">خارج التغطية</Badge>;
      default:
        return <Badge variant="outline">{dlrStatus}</Badge>;
    }
  }

  return (
    <MainLayout>
      <Header
        title="SMS تسويقية"
        subtitle="الحملات التسويقية بالرسائل القصيرة"
      />

      <div className="container mx-auto py-6 space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="compose" className="flex items-center gap-2">
              <Send className="h-4 w-4" />
              إنشاء حملة
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              سجل الحملات
            </TabsTrigger>
          </TabsList>

          <TabsContent value="compose" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Message Composer */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Send className="h-5 w-5" />
                    نص الرسالة
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">عنوان الحملة</label>
                    <Input
                      placeholder="مثال: عروض الصيف"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">نص الرسالة</label>
                    <Textarea
                      placeholder="اكتب رسالتك هنا..."
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      rows={6}
                      className="resize-none"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {message.length} حرف
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={insertLink}
                    >
                      <Link className="h-4 w-4 ml-1" />
                      إضافة رابط
                    </Button>
                    
                    <label className="cursor-pointer">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isUploading}
                        asChild
                      >
                        <span>
                          {isUploading ? (
                            <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                          ) : (
                            <Image className="h-4 w-4 ml-1" />
                          )}
                          رفع صورة
                        </span>
                      </Button>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={e => handleMediaUpload(e, 'image')}
                        className="hidden"
                      />
                    </label>

                    <label className="cursor-pointer">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isUploading}
                        asChild
                      >
                        <span>
                          {isUploading ? (
                            <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                          ) : (
                            <Video className="h-4 w-4 ml-1" />
                          )}
                          رفع فيديو
                        </span>
                      </Button>
                      <input
                        type="file"
                        accept="video/mp4,video/webm"
                        onChange={e => handleMediaUpload(e, 'video')}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {mediaUrl && (
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="text-sm font-medium mb-2">
                        {mediaType === 'video' ? 'الفيديو المرفق:' : 'الصورة المرفقة:'}
                      </p>
                      <div className="flex items-center gap-2">
                        {mediaType === 'video' ? (
                          <video
                            src={mediaUrl}
                            className="h-16 w-24 object-cover rounded"
                            muted
                          />
                        ) : (
                          <img
                            src={mediaUrl}
                            alt="Uploaded"
                            className="h-16 w-16 object-cover rounded"
                          />
                        )}
                        <Input
                          value={mediaUrl}
                          readOnly
                          className="text-xs flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(mediaUrl)}
                          title="نسخ الرابط"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => { setMediaUrl(''); setMediaType(''); }}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="pt-4 border-t">
                    <Button
                      className="w-full"
                      size="lg"
                      onClick={handleSendCampaign}
                      disabled={isSending || selectedClientIds.size === 0}
                    >
                      {isSending ? (
                        <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4 ml-2" />
                      )}
                      إرسال إلى {selectedClientIds.size} عميل
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Customer Selection */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    اختيار العملاء
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="relative">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="بحث بالاسم أو الهاتف..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="pr-10"
                    />
                  </div>

                  <div className="flex items-center justify-between p-2 bg-muted rounded-lg">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="selectAll"
                        checked={selectAll}
                        onCheckedChange={handleSelectAll}
                      />
                      <label htmlFor="selectAll" className="text-sm font-medium cursor-pointer">
                        تحديد الكل ({filteredClients.filter(c => c.phone_number).length})
                      </label>
                    </div>
                    <Badge variant="secondary">
                      {selectedClientIds.size} محدد
                    </Badge>
                  </div>

                  <ScrollArea className="h-[400px] border rounded-lg">
                    {isLoadingClients ? (
                      <div className="p-4 space-y-3">
                        {[...Array(8)].map((_, i) => (
                          <Skeleton key={i} className="h-12 w-full" />
                        ))}
                      </div>
                    ) : filteredClients.length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground">
                        لا يوجد عملاء
                      </div>
                    ) : (
                      <div className="divide-y">
                        {filteredClients.map(client => (
                          <div
                            key={client.id}
                            className="flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors"
                          >
                            <Checkbox
                              checked={selectedClientIds.has(client.id)}
                              onCheckedChange={checked =>
                                handleSelectClient(client.id, checked as boolean)
                              }
                              disabled={!client.phone_number}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{client.full_name}</p>
                              <p className="text-sm text-muted-foreground">
                                {client.phone_number || 'لا يوجد رقم'}
                                {client.file_number && ` • ${client.file_number}`}
                              </p>
                            </div>
                            {!client.phone_number && (
                              <Badge variant="outline" className="text-xs">
                                لا يوجد رقم
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>سجل الحملات</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoadingCampaigns ? (
                  <div className="space-y-3">
                    {[...Array(5)].map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : campaigns.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    لا توجد حملات سابقة
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>العنوان</TableHead>
                        <TableHead>الرسالة</TableHead>
                        <TableHead>المستلمين</TableHead>
                        <TableHead>الحالة</TableHead>
                        <TableHead>التاريخ</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {campaigns.map(campaign => (
                        <TableRow 
                          key={campaign.id} 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleViewCampaign(campaign)}
                        >
                          <TableCell className="font-medium">{campaign.title}</TableCell>
                          <TableCell className="max-w-xs truncate">{campaign.message}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3 text-sm">
                              <span className="flex items-center gap-1 text-blue-500">
                                <Send className="h-3 w-3" />{campaign.sent_count}
                              </span>
                              {(campaign.delivered_count || 0) > 0 && (
                                <span className="flex items-center gap-1 text-emerald-500">
                                  <CheckCircle className="h-3 w-3" />{campaign.delivered_count}
                                </span>
                              )}
                              {(campaign.dlr_failed_count || 0) > 0 && (
                                <span className="flex items-center gap-1 text-destructive">
                                  <XCircle className="h-3 w-3" />{campaign.dlr_failed_count}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{getStatusBadge(campaign)}</TableCell>
                          <TableCell>
                            {format(new Date(campaign.created_at), 'dd/MM/yyyy HH:mm', { locale: ar })}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewCampaign(campaign);
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Campaign Details Modal */}
        <Dialog open={!!selectedCampaign} onOpenChange={() => setSelectedCampaign(null)}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle>تفاصيل الحملة: {selectedCampaign?.title}</DialogTitle>
                {selectedCampaign && (
                  <div className="flex items-center gap-2 mr-4">
                    {selectedCampaign.status === 'sending' && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleRetryPending(selectedCampaign.id)}
                        disabled={isRetrying}
                      >
                        {isRetrying ? (
                          <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 ml-1" />
                        )}
                        إعادة إرسال المعلقين
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCheckDelivery(selectedCampaign.id)}
                      disabled={isCheckingDlr}
                    >
                      {isCheckingDlr ? (
                        <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 ml-1" />
                      )}
                      فحص التسليم
                    </Button>
                  </div>
                )}
              </div>
            </DialogHeader>
            
            {selectedCampaign && (
              <div className="space-y-4 overflow-hidden flex flex-col flex-1">
                {/* Campaign Summary Cards */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="p-3 bg-muted rounded-lg text-center">
                    <p className="text-2xl font-bold">{selectedCampaign.recipients_count}</p>
                    <p className="text-xs text-muted-foreground">إجمالي</p>
                  </div>
                  <div className="p-3 bg-muted rounded-lg text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Send className="h-4 w-4 text-blue-500" />
                      <p className="text-2xl font-bold text-blue-500">{selectedCampaign.sent_count}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">أُرسلت</p>
                  </div>
                  <div className="p-3 bg-muted rounded-lg text-center">
                    <div className="flex items-center justify-center gap-1">
                      <CheckCircle className="h-4 w-4 text-emerald-500" />
                      <p className="text-2xl font-bold text-emerald-500">{selectedCampaign.delivered_count || 0}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">وصلت</p>
                  </div>
                  <div className="p-3 bg-muted rounded-lg text-center">
                    <div className="flex items-center justify-center gap-1">
                      <XCircle className="h-4 w-4 text-destructive" />
                      <p className="text-2xl font-bold text-destructive">{selectedCampaign.dlr_failed_count || 0}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">فشلت</p>
                  </div>
                </div>

                {selectedCampaign.last_dlr_check_at && (
                  <p className="text-xs text-muted-foreground text-center">
                    آخر فحص: {format(new Date(selectedCampaign.last_dlr_check_at), 'dd/MM/yyyy HH:mm', { locale: ar })}
                  </p>
                )}

                {/* Message Preview */}
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm font-medium mb-1">نص الرسالة:</p>
                  <p className="text-sm whitespace-pre-wrap">{selectedCampaign.message}</p>
                </div>

                {/* Recipients List */}
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm font-medium mb-2">المستلمين ({campaignRecipients.length}):</p>
                  <ScrollArea className="h-[300px] border rounded-lg">
                    {isLoadingRecipients ? (
                      <div className="p-4 space-y-2">
                        {[...Array(5)].map((_, i) => (
                          <Skeleton key={i} className="h-12 w-full" />
                        ))}
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8">#</TableHead>
                            <TableHead>الاسم</TableHead>
                            <TableHead>الهاتف</TableHead>
                            <TableHead>حالة الإرسال</TableHead>
                            <TableHead>حالة التسليم</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {campaignRecipients.map((recipient, index) => (
                            <TableRow key={recipient.id}>
                              <TableCell className="text-muted-foreground text-xs">{index + 1}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <User className="h-4 w-4 text-muted-foreground" />
                                  <span className="font-medium">{recipient.clients?.full_name || '-'}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1" dir="ltr">
                                  <Phone className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-sm">{recipient.phone_number}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                {getRecipientSendBadge(recipient.status)}
                              </TableCell>
                              <TableCell>
                                {getRecipientDlrBadge(recipient.dlr_status)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </ScrollArea>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
