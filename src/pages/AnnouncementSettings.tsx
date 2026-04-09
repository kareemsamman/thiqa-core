import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Megaphone, Plus, Trash2, Calendar, Building2 } from "lucide-react";
import { format, addDays } from "date-fns";

interface Announcement {
  id: string;
  title: string;
  content: string;
  start_date: string;
  end_date: string;
  show_once: boolean;
  is_active: boolean;
  created_at: string;
  agent_id: string | null;
}

interface Agent {
  id: string;
  name: string;
  name_ar: string | null;
}

export default function AnnouncementSettings() {
  const { profile } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // New announcement form
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [daysToShow, setDaysToShow] = useState(7);
  const [showOnce, setShowOnce] = useState(false);
  const [targetAgentId, setTargetAgentId] = useState<string>("all");

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    const [annRes, agentRes] = await Promise.all([
      supabase
        .from("announcements")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("agents")
        .select("id, name, name_ar")
        .order("name_ar"),
    ]);

    if (!annRes.error) setAnnouncements(annRes.data || []);
    if (!agentRes.error) setAgents(agentRes.data || []);
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error("يرجى ملء العنوان والمحتوى");
      return;
    }

    setSaving(true);
    const startDate = new Date();
    const endDate = addDays(startDate, daysToShow);

    const { error } = await supabase.from("announcements").insert({
      title: title.trim(),
      content: content.trim(),
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      show_once: showOnce,
      is_active: true,
      created_by_admin_id: profile?.id,
      agent_id: targetAgentId === "all" ? null : targetAgentId,
    });

    if (error) {
      toast.error("خطأ في إنشاء الإعلان");
    } else {
      toast.success("تم إنشاء الإعلان بنجاح");
      setTitle("");
      setContent("");
      setDaysToShow(7);
      setShowOnce(false);
      setTargetAgentId("all");
      fetchAll();
    }
    setSaving(false);
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    const { error } = await supabase
      .from("announcements")
      .update({ is_active: !currentActive })
      .eq("id", id);

    if (!error) fetchAll();
    else toast.error("خطأ في تحديث الإعلان");
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("announcements").delete().eq("id", id);
    if (!error) {
      toast.success("تم حذف الإعلان");
      fetchAll();
    } else toast.error("خطأ في حذف الإعلان");
  };

  const getAgentName = (agentId: string | null) => {
    if (!agentId) return "جميع الوكلاء";
    const a = agents.find((ag) => ag.id === agentId);
    return a ? (a.name_ar || a.name) : agentId;
  };

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-6">
        <Header
          title="إعلانات النظام"
          subtitle="إنشاء إعلانات تظهر للوكلاء ومستخدميهم"
        />

        {/* Create New Announcement */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              إنشاء إعلان جديد
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>عنوان الإعلان</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: تحديث جديد!"
              />
            </div>

            <div className="space-y-2">
              <Label>محتوى الإعلان</Label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="اكتب تفاصيل التحديث هنا..."
                rows={4}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>الوكيل المستهدف</Label>
                <Select value={targetAgentId} onValueChange={setTargetAgentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر الوكيل" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">جميع الوكلاء</SelectItem>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name_ar || a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>عدد أيام العرض</Label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={daysToShow}
                  onChange={(e) => setDaysToShow(parseInt(e.target.value) || 7)}
                />
                <p className="text-xs text-muted-foreground">
                  سينتهي في: {format(addDays(new Date(), daysToShow), "yyyy-MM-dd")}
                </p>
              </div>

              <div className="space-y-2">
                <Label>طريقة العرض</Label>
                <div className="flex items-center gap-3 pt-2">
                  <Switch checked={showOnce} onCheckedChange={setShowOnce} id="show-once" />
                  <Label htmlFor="show-once" className="cursor-pointer">
                    {showOnce ? "مرة واحدة فقط" : "في كل مرة"}
                  </Label>
                </div>
              </div>
            </div>

            <Button onClick={handleCreate} disabled={saving} className="w-full sm:w-auto">
              {saving ? "جاري الإنشاء..." : "إنشاء الإعلان"}
            </Button>
          </CardContent>
        </Card>

        {/* Existing Announcements */}
        <Card>
          <CardHeader>
            <CardTitle>الإعلانات الحالية</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            ) : announcements.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                لا توجد إعلانات حالياً
              </p>
            ) : (
              <div className="space-y-4">
                {announcements.map((ann) => {
                  const isExpired = new Date(ann.end_date) < new Date();
                  const isActive = ann.is_active && !isExpired;

                  return (
                    <div key={ann.id} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-semibold">{ann.title}</h4>
                            {isActive ? (
                              <Badge variant="default">نشط</Badge>
                            ) : isExpired ? (
                              <Badge variant="secondary">منتهي</Badge>
                            ) : (
                              <Badge variant="outline">متوقف</Badge>
                            )}
                            {ann.show_once && <Badge variant="outline">مرة واحدة</Badge>}
                            <Badge variant="secondary" className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              {getAgentName(ann.agent_id)}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                            {ann.content}
                          </p>
                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              من {format(new Date(ann.start_date), "yyyy-MM-dd")} إلى{" "}
                              {format(new Date(ann.end_date), "yyyy-MM-dd")}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Switch
                            checked={ann.is_active}
                            onCheckedChange={() => handleToggleActive(ann.id, ann.is_active)}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(ann.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
