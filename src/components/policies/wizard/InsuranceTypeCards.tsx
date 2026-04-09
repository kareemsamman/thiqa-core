import { Badge } from "@/components/ui/badge";
import { Check, Shield, Car, AlertCircle, Route, Heart, Plane, Building, Briefcase, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InsuranceCategory } from "./types";

interface InsuranceTypeCardsProps {
  categories: InsuranceCategory[];
  selectedCategory: InsuranceCategory | null;
  onSelect: (category: InsuranceCategory) => void;
}

const categoryIcons: Record<string, React.ReactNode> = {
  'ELZAMI': <Shield className="h-5 w-5" />,
  'THIRD_FULL': <Car className="h-5 w-5" />,
  'ROAD_SERVICE': <Route className="h-5 w-5" />,
  'ACCIDENT_FEE_EXEMPTION': <AlertCircle className="h-5 w-5" />,
  'HEALTH': <Heart className="h-5 w-5" />,
  'TRAVEL': <Plane className="h-5 w-5" />,
  'PROPERTY': <Building className="h-5 w-5" />,
  'BUSINESS': <Briefcase className="h-5 w-5" />,
  'OTHER': <MoreHorizontal className="h-5 w-5" />,
};

export function InsuranceTypeCards({ categories, selectedCategory, onSelect }: InsuranceTypeCardsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
      {categories.map((category) => {
        const isSelected = selectedCategory?.id === category.id;
        
        return (
          <button
            key={category.id}
            type="button"
            onClick={() => onSelect(category)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-lg border transition-all whitespace-nowrap flex-shrink-0",
              "hover:bg-muted/50",
              isSelected 
                ? "bg-primary text-primary-foreground border-primary shadow-sm" 
                : "bg-card border-border text-foreground"
            )}
          >
            <span className={cn(
              "flex items-center justify-center",
              isSelected ? "text-primary-foreground" : "text-muted-foreground"
            )}>
              {categoryIcons[category.slug] || <MoreHorizontal className="h-5 w-5" />}
            </span>
            
            <span className="text-sm font-medium">
              {category.name_ar || category.name}
            </span>
            
            {category.is_default && !isSelected && (
              <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4">
                افتراضي
              </Badge>
            )}
            
            {isSelected && (
              <Check className="h-4 w-4" />
            )}
          </button>
        );
      })}
    </div>
  );
}
