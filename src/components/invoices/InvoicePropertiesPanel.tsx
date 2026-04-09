import { useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Loader2, Upload, ImageIcon, Trash2, Type, Palette, Move, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { TemplateElement } from "./InvoiceVisualBuilder";

interface DynamicField {
  key: string;
  labelAr: string;
  labelHe: string;
}

interface InvoicePropertiesPanelProps {
  element: TemplateElement | null;
  onUpdate: (updates: Partial<TemplateElement>) => void;
  onDelete: () => void;
  language: string;
  dynamicFields: DynamicField[];
}

export function InvoicePropertiesPanel({ 
  element, 
  onUpdate, 
  onDelete,
  language, 
  dynamicFields 
}: InvoicePropertiesPanelProps) {
  const { toast } = useToast();
  const isAr = language === 'ar';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  if (!element) {
    return (
      <Card className="w-72 p-6 flex flex-col items-center justify-center text-center">
        <div className="rounded-full bg-muted p-4 mb-3">
          <Type className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          {isAr ? 'اختر عنصراً من اللوحة أو القائمة لتعديل خصائصه' : 'בחר אלמנט מהבד או מהרשימה לעריכה'}
        </p>
      </Card>
    );
  }

  const updateStyle = (key: string, value: any) => {
    onUpdate({
      style: {
        ...element.style,
        [key]: value,
      },
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: "خطأ", description: "يرجى اختيار ملف صورة", variant: "destructive" });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "خطأ", description: "حجم الصورة كبير جداً (الحد الأقصى 5MB)", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        
        const response = await supabase.functions.invoke('upload-media', {
          body: {
            file_name: file.name,
            file_type: file.type,
            file_data: base64,
            entity_type: 'invoice_template',
          },
        });

        if (response.error) throw response.error;
        
        const cdnUrl = response.data?.cdn_url;
        if (cdnUrl) {
          onUpdate({ content: cdnUrl });
          toast({ title: "تم الرفع", description: "تم رفع الصورة بنجاح" });
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Upload error:', error);
      toast({ title: "خطأ", description: "فشل في رفع الصورة", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const getTypeLabel = () => {
    switch (element.type) {
      case 'field': return isAr ? 'حقل ديناميكي' : 'שדה דינמי';
      case 'text': return isAr ? 'نص' : 'טקסט';
      case 'image': return isAr ? 'صورة' : 'תמונה';
      case 'logo': return isAr ? 'شعار' : 'לוגו';
      case 'line': return isAr ? 'خط' : 'קו';
      case 'table': return isAr ? 'جدول' : 'טבלה';
      default: return element.type;
    }
  };

  return (
    <Card className="w-72 flex flex-col max-h-full">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between bg-muted/30">
        <div>
          <h3 className="font-semibold text-sm">{isAr ? 'الخصائص' : 'מאפיינים'}</h3>
          <p className="text-xs text-muted-foreground">{getTypeLabel()}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onDelete} className="text-destructive hover:text-destructive hover:bg-destructive/10">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          
          {/* Text Content */}
          {element.type === 'text' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Type className="h-3.5 w-3.5" />
                {isAr ? 'محتوى النص' : 'תוכן טקסט'}
              </div>
              <Textarea
                value={element.content || ''}
                onChange={(e) => onUpdate({ content: e.target.value })}
                className="min-h-[100px] resize-none text-sm"
                placeholder={isAr ? 'أدخل النص هنا...' : 'הכנס טקסט כאן...'}
                dir={element.style.direction || 'rtl'}
              />
            </div>
          )}

          {/* Field Selector */}
          {element.type === 'field' && (
            <div className="space-y-2">
              <Label className="text-xs">{isAr ? 'اختر الحقل' : 'בחר שדה'}</Label>
              <Select
                value={element.fieldKey}
                onValueChange={(v) => onUpdate({ fieldKey: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={isAr ? 'اختر حقلاً' : 'בחר שדה'} />
                </SelectTrigger>
                <SelectContent>
                  {dynamicFields.map((field) => (
                    <SelectItem key={field.key} value={field.key}>
                      {isAr ? field.labelAr : field.labelHe}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Image Upload */}
          {element.type === 'image' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <ImageIcon className="h-3.5 w-3.5" />
                {isAr ? 'الصورة' : 'תמונה'}
              </div>
              
              {element.content ? (
                <div className="relative rounded-lg border overflow-hidden bg-muted/30">
                  <img 
                    src={element.content} 
                    alt="Preview" 
                    className="w-full h-28 object-contain"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 left-2 h-7 w-7"
                    onClick={() => onUpdate({ content: '' })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <div 
                  className="rounded-lg border-2 border-dashed p-6 text-center bg-muted/20 hover:bg-muted/40 transition-colors cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImageIcon className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                  <p className="text-xs text-muted-foreground">
                    {isAr ? 'انقر لاختيار صورة' : 'לחץ לבחירת תמונה'}
                  </p>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 ml-2" />
                )}
                {isAr ? 'رفع صورة' : 'העלה תמונה'}
              </Button>

              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-card px-2 text-muted-foreground">
                    {isAr ? 'أو رابط مباشر' : 'או קישור'}
                  </span>
                </div>
              </div>
              <Input
                value={element.content || ''}
                onChange={(e) => onUpdate({ content: e.target.value })}
                placeholder="https://..."
                className="text-xs ltr-input"
              />
            </div>
          )}

          <Separator />

          {/* Position & Size */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Move className="h-3.5 w-3.5" />
              {isAr ? 'الموقع والحجم' : 'מיקום וגודל'}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">X</Label>
                <Input
                  type="number"
                  value={element.x}
                  onChange={(e) => onUpdate({ x: parseInt(e.target.value) || 0 })}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Y</Label>
                <Input
                  type="number"
                  value={element.y}
                  onChange={(e) => onUpdate({ y: parseInt(e.target.value) || 0 })}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">{isAr ? 'عرض' : 'רוחב'}</Label>
                <Input
                  type="number"
                  value={element.width}
                  onChange={(e) => onUpdate({ width: parseInt(e.target.value) || 100 })}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">{isAr ? 'ارتفاع' : 'גובה'}</Label>
                <Input
                  type="number"
                  value={element.height}
                  onChange={(e) => onUpdate({ height: parseInt(e.target.value) || 30 })}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Text Styling */}
          {(element.type === 'text' || element.type === 'field') && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Palette className="h-3.5 w-3.5" />
                  {isAr ? 'تنسيق النص' : 'עיצוב טקסט'}
                </div>

                {/* Font Size with Slider */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs">{isAr ? 'حجم الخط' : 'גודל'}</Label>
                    <span className="text-xs text-muted-foreground">{element.style.fontSize || 14}px</span>
                  </div>
                  <Slider
                    value={[element.style.fontSize || 14]}
                    onValueChange={([v]) => updateStyle('fontSize', v)}
                    min={8}
                    max={72}
                    step={1}
                    className="w-full"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">{isAr ? 'السُمك' : 'עובי'}</Label>
                    <Select
                      value={element.style.fontWeight || 'normal'}
                      onValueChange={(v) => updateStyle('fontWeight', v)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="normal">{isAr ? 'عادي' : 'רגיל'}</SelectItem>
                        <SelectItem value="bold">{isAr ? 'عريض' : 'מודגש'}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">{isAr ? 'المحاذاة' : 'יישור'}</Label>
                    <Select
                      value={element.style.textAlign || 'right'}
                      onValueChange={(v) => updateStyle('textAlign', v)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="right">{isAr ? 'يمين' : 'ימין'}</SelectItem>
                        <SelectItem value="center">{isAr ? 'وسط' : 'מרכז'}</SelectItem>
                        <SelectItem value="left">{isAr ? 'يسار' : 'שמאל'}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label className="text-[10px] text-muted-foreground">{isAr ? 'الاتجاه' : 'כיוון'}</Label>
                  <Select
                    value={element.style.direction || 'rtl'}
                    onValueChange={(v) => updateStyle('direction', v as 'rtl' | 'ltr')}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rtl">{isAr ? 'من اليمين' : 'ימין לשמאל'} (RTL)</SelectItem>
                      <SelectItem value="ltr">{isAr ? 'من اليسار' : 'שמאל לימין'} (LTR)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* Colors */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Palette className="h-3.5 w-3.5" />
              {isAr ? 'الألوان' : 'צבעים'}
            </div>
            
            <div>
              <Label className="text-[10px] text-muted-foreground mb-1.5 block">
                {element.type === 'line' ? (isAr ? 'لون الخط' : 'צבע קו') : (isAr ? 'لون النص' : 'צבע טקסט')}
              </Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={element.style.color || '#000000'}
                  onChange={(e) => updateStyle('color', e.target.value)}
                  className="h-9 w-14 p-1 cursor-pointer"
                />
                <Input
                  value={element.style.color || '#000000'}
                  onChange={(e) => updateStyle('color', e.target.value)}
                  className="h-9 text-xs flex-1 font-mono ltr-input"
                />
              </div>
            </div>

            {(element.type === 'text' || element.type === 'field') && (
              <div>
                <Label className="text-[10px] text-muted-foreground mb-1.5 block">{isAr ? 'لون الخلفية' : 'צבע רקע'}</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={element.style.backgroundColor === 'transparent' ? '#ffffff' : (element.style.backgroundColor || '#ffffff')}
                    onChange={(e) => updateStyle('backgroundColor', e.target.value)}
                    className="h-9 w-14 p-1 cursor-pointer"
                  />
                  <Input
                    value={element.style.backgroundColor || 'transparent'}
                    onChange={(e) => updateStyle('backgroundColor', e.target.value)}
                    className="h-9 text-xs flex-1 font-mono ltr-input"
                    placeholder="transparent"
                  />
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Lock */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-xs">{isAr ? 'قفل العنصر' : 'נעל אלמנט'}</Label>
            </div>
            <Switch
              checked={element.locked}
              onCheckedChange={(c) => onUpdate({ locked: c })}
            />
          </div>
        </div>
      </ScrollArea>
    </Card>
  );
}
