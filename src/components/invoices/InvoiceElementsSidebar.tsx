import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  Type, Image, Hash, Table2, Minus, Stamp,
  GripVertical, Trash2, Plus
} from "lucide-react";
import type { TemplateElement } from "./InvoiceVisualBuilder";

interface DynamicField {
  key: string;
  labelAr: string;
  labelHe: string;
}

interface InvoiceElementsSidebarProps {
  language: string;
  onAddElement: (type: TemplateElement['type'], fieldKey?: string) => void;
  dynamicFields: DynamicField[];
  elements?: TemplateElement[];
  selectedElementId?: string | null;
  onSelectElement?: (id: string) => void;
  onDeleteElement?: (id: string) => void;
}

const elementTypes = [
  { type: 'text' as const, icon: Type, labelAr: 'نص', labelHe: 'טקסט', color: 'bg-blue-500' },
  { type: 'image' as const, icon: Image, labelAr: 'صورة', labelHe: 'תמונה', color: 'bg-green-500' },
  { type: 'field' as const, icon: Hash, labelAr: 'حقل ديناميكي', labelHe: 'שדה דינמי', color: 'bg-purple-500' },
  { type: 'table' as const, icon: Table2, labelAr: 'جدول', labelHe: 'טבלה', color: 'bg-orange-500' },
  { type: 'line' as const, icon: Minus, labelAr: 'خط', labelHe: 'קו', color: 'bg-gray-500' },
  { type: 'logo' as const, icon: Stamp, labelAr: 'شعار', labelHe: 'לוגו', color: 'bg-pink-500' },
];

export function InvoiceElementsSidebar({ 
  language, 
  onAddElement, 
  dynamicFields,
  elements = [],
  selectedElementId,
  onSelectElement,
  onDeleteElement
}: InvoiceElementsSidebarProps) {
  const isAr = language === 'ar';

  const getElementIcon = (type: TemplateElement['type']) => {
    const found = elementTypes.find(et => et.type === type);
    return found?.icon || Type;
  };

  const getElementColor = (type: TemplateElement['type']) => {
    const found = elementTypes.find(et => et.type === type);
    return found?.color || 'bg-gray-500';
  };

  const getElementLabel = (el: TemplateElement) => {
    if (el.type === 'text' && el.content) {
      return el.content.slice(0, 20) + (el.content.length > 20 ? '...' : '');
    }
    if (el.type === 'field' && el.fieldKey) {
      const field = dynamicFields.find(f => f.key === el.fieldKey);
      return field ? (isAr ? field.labelAr : field.labelHe) : el.fieldKey;
    }
    const type = elementTypes.find(t => t.type === el.type);
    return type ? (isAr ? type.labelAr : type.labelHe) : el.type;
  };

  return (
    <Card className="w-56 flex flex-col max-h-full">
      {/* Add Elements Section */}
      <div className="p-3 border-b">
        <h3 className="font-semibold text-sm mb-2">{isAr ? 'إضافة عنصر' : 'הוסף אלמנט'}</h3>
        <div className="grid grid-cols-3 gap-1.5">
          {elementTypes.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.type}
                className={cn(
                  "flex flex-col items-center gap-1 p-2 rounded-lg border text-xs",
                  "hover:bg-muted/50 transition-colors cursor-grab active:cursor-grabbing",
                  "hover:border-primary/50"
                )}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('elementType', item.type);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => {
                  if (item.type === 'field') {
                    onAddElement(item.type, dynamicFields[0]?.key);
                  } else {
                    onAddElement(item.type);
                  }
                }}
                title={isAr ? `اسحب أو انقر لإضافة ${item.labelAr}` : `Drag or click to add ${item.labelHe}`}
              >
                <div className={cn("p-1.5 rounded", item.color)}>
                  <Icon className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {isAr ? item.labelAr : item.labelHe}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Dynamic Fields Dropdown */}
      <div className="p-3 border-b">
        <h4 className="text-xs font-medium text-muted-foreground mb-2">
          {isAr ? 'حقول ديناميكية' : 'שדות דינמיים'}
        </h4>
        <ScrollArea className="h-32">
          <div className="space-y-1">
            {dynamicFields.map((field) => (
              <button
                key={field.key}
                className={cn(
                  "w-full text-right px-2 py-1.5 text-xs rounded",
                  "hover:bg-muted/50 transition-colors flex items-center gap-2",
                  "cursor-grab active:cursor-grabbing"
                )}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('elementType', 'field');
                  e.dataTransfer.setData('fieldKey', field.key);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => onAddElement('field', field.key)}
              >
                <Hash className="h-3 w-3 text-purple-500 flex-shrink-0" />
                <span className="truncate">{isAr ? field.labelAr : field.labelHe}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      <Separator />

      {/* Elements List */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="p-3 pb-2">
          <h3 className="font-semibold text-sm flex items-center justify-between">
            {isAr ? 'العناصر' : 'אלמנטים'}
            <Badge variant="secondary" className="text-[10px]">{elements.length}</Badge>
          </h3>
        </div>
        
        <ScrollArea className="flex-1 px-2 pb-2">
          {elements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Plus className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-xs">{isAr ? 'لا توجد عناصر بعد' : 'אין אלמנטים עדיין'}</p>
              <p className="text-[10px] mt-1">{isAr ? 'اسحب عنصراً للبدء' : 'גרור אלמנט כדי להתחיל'}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {elements.map((el) => {
                const Icon = getElementIcon(el.type);
                const isSelected = selectedElementId === el.id;
                return (
                  <div
                    key={el.id}
                    className={cn(
                      "group flex items-center gap-2 p-2 rounded-lg text-xs cursor-pointer transition-all",
                      isSelected 
                        ? "bg-primary/10 border border-primary/30" 
                        : "hover:bg-muted/50 border border-transparent"
                    )}
                    onClick={() => onSelectElement?.(el.id)}
                  >
                    <GripVertical className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 flex-shrink-0" />
                    <div className={cn("p-1 rounded", getElementColor(el.type))}>
                      <Icon className="h-3 w-3 text-white" />
                    </div>
                    <span className="flex-1 truncate text-right">{getElementLabel(el)}</span>
                    {onDeleteElement && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteElement(el.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </Card>
  );
}
