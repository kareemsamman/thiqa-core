import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  FileSignature,
  Search,
  CheckCircle2,
  AlertTriangle,
  Send,
  Loader2,
  Eye,
  User,
  Phone,
} from "lucide-react";
import { Navigate } from "react-router-dom";

interface ClientSignature {
  id: string;
  full_name: string;
  id_number: string;
  phone_number: string | null;
  signature_url: string | null;
  created_at: string;
}

export default function CustomerSignatures() {
  const { toast } = useToast();
  const { isAdmin, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<ClientSignature[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "signed" | "not_signed">("all");
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>("");

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("clients")
        .select("id, full_name, id_number, phone_number, signature_url, created_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setClients(data || []);
    } catch (error) {
      console.error("Error fetching clients:", error);
      toast({
        title: "خطأ",
        description: "فشل في تحميل بيانات العملاء",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSendSignatureRequest = async (clientId: string, phoneNumber: string | null) => {
    if (!phoneNumber) {
      toast({
        title: "خطأ",
        description: "لا يوجد رقم هاتف للعميل",
        variant: "destructive",
      });
      return;
    }

    setSendingId(clientId);
    try {
      const { data: session } = await supabase.auth.getSession();

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-signature-sms`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.session?.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ client_id: clientId }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "فشل في إرسال طلب التوقيع");
      }

      toast({
        title: "تم الإرسال",
        description: `تم إرسال رابط التوقيع إلى ${phoneNumber}`,
      });
    } catch (error: any) {
      console.error("Error sending signature request:", error);
      toast({
        title: "خطأ",
        description: error.message || "فشل في إرسال طلب التوقيع",
        variant: "destructive",
      });
    } finally {
      setSendingId(null);
    }
  };

  const filteredClients = clients.filter((client) => {
    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      if (
        !client.full_name.toLowerCase().includes(searchLower) &&
        !client.id_number.includes(search) &&
        !(client.phone_number?.includes(search))
      ) {
        return false;
      }
    }

    // Status filter
    if (filter === "signed" && !client.signature_url) return false;
    if (filter === "not_signed" && client.signature_url) return false;

    return true;
  });

  const signedCount = clients.filter((c) => c.signature_url).length;
  const notSignedCount = clients.filter((c) => !c.signature_url).length;

  if (authLoading) {
    return (
      <MainLayout>
        <div className="p-6">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-64 w-full" />
        </div>
      </MainLayout>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <MainLayout>
      <Header title="توقيعات العملاء" subtitle="إدارة ومتابعة توقيعات العملاء" />

      <div className="p-6 space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">إجمالي العملاء</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{clients.length}</p>
            </CardContent>
          </Card>
          <Card className="border-success/30 bg-success/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-success flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                وقّعوا
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-success">{signedCount}</p>
            </CardContent>
          </Card>
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-amber-600 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                لم يوقّعوا
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-amber-600">{notSignedCount}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="بحث بالاسم أو رقم الهوية أو الهاتف..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pr-10"
                />
              </div>
              <Select
                value={filter}
                onValueChange={(val: "all" | "signed" | "not_signed") => setFilter(val)}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="signed">وقّعوا</SelectItem>
                  <SelectItem value="not_signed">لم يوقّعوا</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">العميل</TableHead>
                    <TableHead className="text-right">رقم الهوية</TableHead>
                    <TableHead className="text-right">الهاتف</TableHead>
                    <TableHead className="text-right">حالة التوقيع</TableHead>
                    <TableHead className="text-right">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClients.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        لا توجد نتائج
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredClients.map((client) => (
                      <TableRow key={client.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{client.full_name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <bdi>{client.id_number}</bdi>
                        </TableCell>
                        <TableCell>
                          {client.phone_number ? (
                            <div className="flex items-center gap-1">
                              <Phone className="h-3 w-3 text-muted-foreground" />
                              <bdi>{client.phone_number}</bdi>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {client.signature_url ? (
                            <Badge variant="success" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              تم التوقيع
                            </Badge>
                          ) : (
                            <Badge variant="warning" className="gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              لم يوقّع
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            {client.signature_url ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setPreviewUrl(client.signature_url);
                                  setPreviewName(client.full_name);
                                }}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={sendingId === client.id || !client.phone_number}
                                onClick={() =>
                                  handleSendSignatureRequest(client.id, client.phone_number)
                                }
                              >
                                {sendingId === client.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Send className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Signature Preview Dialog */}
      <Dialog open={!!previewUrl} onOpenChange={() => setPreviewUrl(null)}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>توقيع العميل - {previewName}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center p-4 bg-white rounded-lg border">
            {previewUrl && (
              <img
                src={previewUrl}
                alt="توقيع العميل"
                className="max-w-full max-h-48 object-contain"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
