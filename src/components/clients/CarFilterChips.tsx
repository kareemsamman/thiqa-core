import { useMemo } from 'react';
import { Check, Car } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CarRecord {
  id: string;
  car_number: string;
  manufacturer_name: string | null;
  model: string | null;
  year: number | null;
  car_type: string | null;
}

interface PolicyData {
  car: { id: string } | null;
  end_date: string;
  cancelled: boolean | null;
  transferred: boolean | null;
  group_id: string | null;
}

interface CarWithPolicyCount extends CarRecord {
  policyCount: number;
  activePolicyCount: number;
}

interface CarFilterChipsProps {
  cars: CarRecord[];
  policies: PolicyData[];
  selectedCarId: string;
  onSelect: (carId: string) => void;
}

// Format car number with dashes for display (XX-XXX-XX or XXX-XX-XXX format)
const formatPlateNumber = (num: string) => {
  const clean = num.replace(/[^0-9]/g, '');
  if (clean.length === 7) {
    return `${clean.slice(0, 2)}-${clean.slice(2, 5)}-${clean.slice(5, 7)}`;
  } else if (clean.length === 8) {
    return `${clean.slice(0, 3)}-${clean.slice(3, 5)}-${clean.slice(5, 8)}`;
  }
  return num;
};

// Count cards (packages count as 1, standalone policies count as 1)
const countCards = (policyList: PolicyData[], activeOnly: boolean, today: Date) => {
  const filteredPolicies = activeOnly 
    ? policyList.filter(p => !p.cancelled && !p.transferred && new Date(p.end_date) >= today)
    : policyList;
  
  const groupIds = new Set<string>();
  let standaloneCount = 0;
  
  filteredPolicies.forEach(p => {
    if (p.group_id) {
      groupIds.add(p.group_id);
    } else {
      standaloneCount++;
    }
  });
  
  return groupIds.size + standaloneCount;
};

export function CarFilterChips({ cars, policies, selectedCarId, onSelect }: CarFilterChipsProps) {
  const carsWithPolicyCounts = useMemo((): CarWithPolicyCount[] => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return cars.map(car => {
      const carPolicies = policies.filter(p => p.car?.id === car.id);
      
      return {
        ...car,
        policyCount: countCards(carPolicies, false, today),
        activePolicyCount: countCards(carPolicies, true, today),
      };
    });
  }, [cars, policies]);

  const { totalPolicies, totalActivePolicies } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return {
      totalPolicies: countCards(policies, false, today),
      totalActivePolicies: countCards(policies, true, today),
    };
  }, [policies]);

  if (cars.length === 0) {
    return null;
  }

  return (
    <div className="w-full overflow-x-auto pb-2" dir="rtl">
      <div className="flex items-stretch gap-3 min-w-max">
        {/* All Cars Card */}
        <button
          onClick={() => onSelect('all')}
          className={cn(
            "group relative flex flex-col gap-1.5 p-3 rounded-xl border-2 min-w-[140px]",
            "bg-card/80 backdrop-blur-sm transition-all duration-200",
            "hover:shadow-md hover:border-primary/30",
            selectedCarId === 'all'
              ? "border-primary bg-primary/5 shadow-lg"
              : "border-border/50"
          )}
        >
          {/* Header with icon */}
          <div className="flex items-center gap-2">
            <div className={cn(
              "h-7 w-7 rounded-lg flex items-center justify-center transition-colors",
              selectedCarId === 'all' 
                ? "bg-primary text-primary-foreground" 
                : "bg-muted text-muted-foreground"
            )}>
              <Car className="h-4 w-4" />
            </div>
            <span className={cn(
              "text-sm font-bold",
              selectedCarId === 'all' ? "text-primary" : "text-foreground"
            )}>
              كل السيارات
            </span>
            {selectedCarId === 'all' && (
              <Check className="h-4 w-4 text-primary mr-auto" />
            )}
          </div>
          
          {/* Policy count */}
          <div className="flex items-center gap-3 text-xs mt-1">
            <div className="flex items-center gap-1">
              <div className="h-2 w-2 rounded-full bg-success" />
              <span className="font-medium ltr-nums">{totalActivePolicies}</span>
              <span className="text-muted-foreground">سارية</span>
            </div>
            {totalPolicies > totalActivePolicies && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                <span className="ltr-nums">{totalPolicies}</span>
                <span>إجمالي</span>
              </div>
            )}
          </div>
        </button>

        {/* Divider */}
        <div className="h-auto w-px bg-gradient-to-b from-transparent via-border to-transparent mx-1 self-stretch" />

        {/* Car Cards */}
        {carsWithPolicyCounts.map((car) => (
          <button
            key={car.id}
            onClick={() => onSelect(car.id)}
            className={cn(
              "group relative flex flex-col gap-1.5 p-3 rounded-xl border-2 min-w-[150px]",
              "bg-card/80 backdrop-blur-sm transition-all duration-200",
              "hover:shadow-md hover:border-primary/30",
              selectedCarId === car.id
                ? "border-primary bg-primary/5 shadow-lg"
                : "border-border/50"
            )}
          >
            {/* Car number */}
            <div className="flex items-center gap-2">
              <span 
                className="text-base font-bold ltr-nums"
                dir="ltr"
              >
                {formatPlateNumber(car.car_number)}
              </span>
              {selectedCarId === car.id && (
                <Check className="h-4 w-4 text-primary mr-auto" />
              )}
            </div>
            
            {/* Manufacturer + Year */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {car.manufacturer_name && (
                <span className="truncate max-w-[100px]">{car.manufacturer_name}</span>
              )}
              {car.manufacturer_name && car.year && (
                <span>•</span>
              )}
              {car.year && (
                <span className="ltr-nums">{car.year}</span>
              )}
              {!car.manufacturer_name && !car.year && (
                <span className="text-muted-foreground/50">—</span>
              )}
            </div>
            
            {/* Policy count */}
            <div className="flex items-center gap-3 text-xs mt-0.5">
              {car.activePolicyCount > 0 ? (
                <div className="flex items-center gap-1">
                  <div className="h-2 w-2 rounded-full bg-success" />
                  <span className="font-medium ltr-nums">{car.activePolicyCount}</span>
                  <span className="text-muted-foreground">سارية</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                  <span>لا توجد سارية</span>
                </div>
              )}
              {car.policyCount > car.activePolicyCount && (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                  <span className="ltr-nums">{car.policyCount}</span>
                  <span>إجمالي</span>
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
