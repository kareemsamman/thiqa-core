import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle, XCircle, Calculator, Car, User, Building2, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Enums } from '@/integrations/supabase/types';

interface PolicyDetail {
  id: string;
  policy_type_parent: Enums<'policy_type_parent'>;
  policy_type_child: Enums<'policy_type_child'> | null;
  insurance_price: number;
  payed_for_company: number | null;
  profit: number | null;
  is_under_24: boolean | null;
  car: {
    id: string;
    car_number: string;
    car_type: Enums<'car_type'> | null;
    car_value: number | null;
    year: number | null;
  } | null;
}

interface CompanyInfo {
  id: string;
  name: string;
  name_ar: string | null;
}

interface PricingRule {
  id: string;
  rule_type: Enums<'pricing_rule_type'>;
  value: number;
  age_band: Enums<'age_band'> | null;
  car_type: Enums<'car_type'> | null;
}

interface CalculationExplanationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policy: PolicyDetail | null;
  company: CompanyInfo | null;
}

const RULE_TYPE_LABELS: Record<string, string> = {
  THIRD_PRICE: 'سعر الطرف الثالث',
  FULL_PERCENT: 'نسبة الشامل',
  DISCOUNT: 'خصم',
  MIN_PRICE: 'الحد الأدنى',
  ROAD_SERVICE_PRICE: 'سعر خدمات الطريق',
  ROAD_SERVICE_BASE: 'سعر خدمات الطريق الأساسي',
  ROAD_SERVICE_EXTRA_OLD_CAR: 'رسوم إضافية للسيارات القديمة',
};

const CAR_TYPE_LABELS: Record<string, string> = {
  car: 'خصوصي',
  cargo: 'شحن',
  small: 'أوتوبس زعير',
  taxi: 'تاكسي',
  tjeradown4: 'تجاري < 4 طن',
  tjeraup4: 'تجاري > 4 طن',
};

const POLICY_TYPE_LABELS: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'طرف ثالث / شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
};

const POLICY_CHILD_LABELS: Record<string, string> = {
  THIRD: 'ثالث',
  FULL: 'شامل',
};

export function CalculationExplanationModal({
  open,
  onOpenChange,
  policy,
  company,
}: CalculationExplanationModalProps) {
  const [loading, setLoading] = useState(false);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);

  useEffect(() => {
    if (open && policy && company) {
      fetchPricingRules();
    }
  }, [open, policy, company]);

  const fetchPricingRules = async () => {
    if (!policy || !company) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('pricing_rules')
        .select('id, rule_type, value, age_band, car_type')
        .eq('company_id', company.id)
        .eq('policy_type_parent', policy.policy_type_parent);

      if (error) throw error;
      setPricingRules(data || []);
    } catch (error) {
      console.error('Error fetching pricing rules:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!policy || !company) return null;

  const ageBand = policy.is_under_24 ? 'UNDER_24' : 'UP_24';
  const carType = policy.car?.car_type || 'car';
  const carValue = policy.car?.car_value || 0;
  const carYear = policy.car?.year || new Date().getFullYear();
  const insurancePrice = Number(policy.insurance_price);
  const companyPayment = Number(policy.payed_for_company || 0);
  const profit = Number(policy.profit || 0);

  // Find matching rules
  const findRule = (ruleType: string) => {
    // First try exact match
    let rule = pricingRules.find(
      r => r.rule_type === ruleType && 
           (r.car_type === carType || r.car_type === null) &&
           (r.age_band === ageBand || r.age_band === 'ANY')
    );
    
    // Fallback to any matching rule type
    if (!rule) {
      rule = pricingRules.find(r => r.rule_type === ruleType);
    }
    
    return rule;
  };

  const thirdPriceRule = findRule('THIRD_PRICE');
  const fullPercentRule = findRule('FULL_PERCENT');
  const discountRule = findRule('DISCOUNT');
  const minPriceRule = findRule('MIN_PRICE');
  const roadBaseRule = findRule('ROAD_SERVICE_BASE') || findRule('ROAD_SERVICE_PRICE');
  const roadExtraRule = findRule('ROAD_SERVICE_EXTRA_OLD_CAR');

  // Verification check
  const calculatedSum = companyPayment + profit;
  const isValid = Math.abs(calculatedSum - insurancePrice) < 0.01;

  const renderCalculationSteps = () => {
    switch (policy.policy_type_parent) {
      case 'ELZAMI':
        return (
          <div className="space-y-4">
            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <h4 className="font-semibold text-sm">خطوات الحساب (إلزامي):</h4>
              <div className="text-sm space-y-1 font-mono">
                <p>المستحق للشركة = سعر التأمين</p>
                <p className="text-primary">المستحق للشركة = ₪{insurancePrice.toLocaleString('en-US')}</p>
                <Separator className="my-2" />
                <p>الربح = 0 (لا ربح في التأمين الإلزامي)</p>
              </div>
            </div>
          </div>
        );

      case 'THIRD_FULL':
        if (policy.policy_type_child === 'THIRD') {
          return (
            <div className="space-y-4">
              <div className="bg-muted/50 p-4 rounded-lg space-y-3">
                <h4 className="font-semibold text-sm">القواعد المستخدمة:</h4>
                {thirdPriceRule && (
                  <div className="flex justify-between items-center text-sm">
                    <span>{RULE_TYPE_LABELS[thirdPriceRule.rule_type]}</span>
                    <Badge variant="secondary">₪{thirdPriceRule.value.toLocaleString('en-US')}</Badge>
                  </div>
                )}
              </div>
              
              <div className="bg-muted/50 p-4 rounded-lg space-y-2">
                <h4 className="font-semibold text-sm">خطوات الحساب (ثالث):</h4>
                <div className="text-sm space-y-1 font-mono">
                  <p>المستحق للشركة = سعر الطرف الثالث</p>
                  <p className="text-primary">المستحق للشركة = ₪{thirdPriceRule?.value.toLocaleString('en-US') || companyPayment.toLocaleString('en-US')}</p>
                  <Separator className="my-2" />
                  <p>الربح = سعر التأمين - المستحق للشركة</p>
                  <p>الربح = ₪{insurancePrice.toLocaleString('en-US')} - ₪{companyPayment.toLocaleString('en-US')}</p>
                  <p className="text-success">الربح = ₪{profit.toLocaleString('en-US')}</p>
                </div>
              </div>
            </div>
          );
        } else {
          // FULL
          const thirdComponent = discountRule ? discountRule.value : (thirdPriceRule?.value || 0);
          const useMinPrice = carValue < 60000;
          const fullComponent = useMinPrice 
            ? (minPriceRule?.value || 0)
            : carValue * ((fullPercentRule?.value || 0) / 100);
          
          return (
            <div className="space-y-4">
              <div className="bg-muted/50 p-4 rounded-lg space-y-3">
                <h4 className="font-semibold text-sm">القواعد المستخدمة:</h4>
                {thirdPriceRule && (
                  <div className="flex justify-between items-center text-sm">
                    <span>{RULE_TYPE_LABELS[thirdPriceRule.rule_type]}</span>
                    <Badge variant="secondary">₪{thirdPriceRule.value.toLocaleString('en-US')}</Badge>
                  </div>
                )}
                {discountRule && (
                  <div className="flex justify-between items-center text-sm">
                    <span>{RULE_TYPE_LABELS[discountRule.rule_type]} (يحل محل سعر الثالث)</span>
                    <Badge variant="secondary">₪{discountRule.value.toLocaleString('en-US')}</Badge>
                  </div>
                )}
                {fullPercentRule && (
                  <div className="flex justify-between items-center text-sm">
                    <span>{RULE_TYPE_LABELS[fullPercentRule.rule_type]}</span>
                    <Badge variant="secondary">{fullPercentRule.value}%</Badge>
                  </div>
                )}
                {minPriceRule && (
                  <div className="flex justify-between items-center text-sm">
                    <span>{RULE_TYPE_LABELS[minPriceRule.rule_type]}</span>
                    <Badge variant="secondary">₪{minPriceRule.value.toLocaleString('en-US')}</Badge>
                  </div>
                )}
              </div>
              
              <div className="bg-muted/50 p-4 rounded-lg space-y-2">
                <h4 className="font-semibold text-sm">خطوات الحساب (شامل):</h4>
                <div className="text-sm space-y-1 font-mono">
                  <p className="text-muted-foreground">// حساب مكون الثالث</p>
                  {discountRule ? (
                    <p>مكون الثالث = الخصم = ₪{discountRule.value.toLocaleString('en-US')}</p>
                  ) : (
                    <p>مكون الثالث = سعر الثالث = ₪{(thirdPriceRule?.value || 0).toLocaleString('en-US')}</p>
                  )}
                  
                  <Separator className="my-2" />
                  
                  <p className="text-muted-foreground">// حساب مكون الشامل</p>
                  {useMinPrice ? (
                    <>
                      <p>قيمة السيارة = ₪{carValue.toLocaleString('en-US')} (أقل من ₪60,000)</p>
                      <p>مكون الشامل = الحد الأدنى = ₪{(minPriceRule?.value || 0).toLocaleString('en-US')}</p>
                    </>
                  ) : (
                    <>
                      <p>قيمة السيارة = ₪{carValue.toLocaleString('en-US')} (أكبر من أو يساوي ₪60,000)</p>
                      <p>مكون الشامل = قيمة السيارة × (نسبة الشامل / 100)</p>
                      <p>مكون الشامل = ₪{carValue.toLocaleString('en-US')} × ({fullPercentRule?.value || 0}% / 100)</p>
                      <p>مكون الشامل = ₪{fullComponent.toLocaleString('en-US')}</p>
                    </>
                  )}
                  
                  <Separator className="my-2" />
                  
                  <p className="text-muted-foreground">// المجموع</p>
                  <p>المستحق للشركة = مكون الشامل + مكون الثالث</p>
                  <p className="text-primary">المستحق للشركة = ₪{companyPayment.toLocaleString('en-US')}</p>
                  
                  <Separator className="my-2" />
                  
                  <p>الربح = سعر التأمين - المستحق للشركة</p>
                  <p>الربح = ₪{insurancePrice.toLocaleString('en-US')} - ₪{companyPayment.toLocaleString('en-US')}</p>
                  <p className="text-success">الربح = ₪{profit.toLocaleString('en-US')}</p>
                </div>
              </div>
            </div>
          );
        }

      case 'ROAD_SERVICE':
        const isOldCar = carYear <= 2007;
        return (
          <div className="space-y-4">
            <div className="bg-muted/50 p-4 rounded-lg space-y-3">
              <h4 className="font-semibold text-sm">القواعد المستخدمة:</h4>
              {roadBaseRule && (
                <div className="flex justify-between items-center text-sm">
                  <span>{RULE_TYPE_LABELS[roadBaseRule.rule_type]}</span>
                  <Badge variant="secondary">₪{roadBaseRule.value.toLocaleString('en-US')}</Badge>
                </div>
              )}
              {roadExtraRule && isOldCar && (
                <div className="flex justify-between items-center text-sm">
                  <span>{RULE_TYPE_LABELS[roadExtraRule.rule_type]}</span>
                  <Badge variant="secondary">₪{roadExtraRule.value.toLocaleString('en-US')}</Badge>
                </div>
              )}
            </div>
            
            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <h4 className="font-semibold text-sm">خطوات الحساب (خدمات الطريق):</h4>
              <div className="text-sm space-y-1 font-mono">
                <p>سنة السيارة = {carYear}</p>
                {isOldCar ? (
                  <>
                    <p className="text-amber-500">السيارة قديمة (≤ 2007) - يتم إضافة رسوم إضافية</p>
                    <p>المستحق للشركة = السعر الأساسي + رسوم السيارة القديمة</p>
                    <p>المستحق للشركة = ₪{(roadBaseRule?.value || 0).toLocaleString('en-US')} + ₪{(roadExtraRule?.value || 0).toLocaleString('en-US')}</p>
                  </>
                ) : (
                  <>
                    <p className="text-green-500">السيارة حديثة ({'>'}2007) - لا رسوم إضافية</p>
                    <p>المستحق للشركة = السعر الأساسي</p>
                  </>
                )}
                <p className="text-primary">المستحق للشركة = ₪{companyPayment.toLocaleString('en-US')}</p>
                
                <Separator className="my-2" />
                
                <p>الربح = سعر التأمين - المستحق للشركة</p>
                <p>الربح = ₪{insurancePrice.toLocaleString('en-US')} - ₪{companyPayment.toLocaleString('en-US')}</p>
                <p className="text-success">الربح = ₪{profit.toLocaleString('en-US')}</p>
              </div>
            </div>
          </div>
        );

      case 'ACCIDENT_FEE_EXEMPTION':
        return (
          <div className="space-y-4">
            <div className="bg-muted/50 p-4 rounded-lg space-y-3">
              <h4 className="font-semibold text-sm">القواعد المستخدمة:</h4>
              {thirdPriceRule && (
                <div className="flex justify-between items-center text-sm">
                  <span>{RULE_TYPE_LABELS[thirdPriceRule.rule_type]}</span>
                  <Badge variant="secondary">₪{thirdPriceRule.value.toLocaleString('en-US')}</Badge>
                </div>
              )}
            </div>
            
            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <h4 className="font-semibold text-sm">خطوات الحساب (إعفاء رسوم حادث):</h4>
              <div className="text-sm space-y-1 font-mono">
                <p>المستحق للشركة = سعر الإعفاء الثابت</p>
                <p className="text-primary">المستحق للشركة = ₪{companyPayment.toLocaleString('en-US')}</p>
                <Separator className="my-2" />
                <p>الربح = سعر التأمين - المستحق للشركة</p>
                <p className="text-success">الربح = ₪{profit.toLocaleString('en-US')}</p>
              </div>
            </div>
          </div>
        );

      default:
        return (
          <div className="bg-muted/50 p-4 rounded-lg">
            <p className="text-sm text-muted-foreground">
              لا توجد قواعد حساب محددة لهذا النوع من التأمين
            </p>
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            شرح حسبة المستحق للشركة
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Policy Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">الشركة:</span>
                <span className="font-medium">{company.name_ar || company.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">نوع التأمين:</span>
                <Badge variant="outline">
                  {policy.policy_type_child 
                    ? POLICY_CHILD_LABELS[policy.policy_type_child] 
                    : POLICY_TYPE_LABELS[policy.policy_type_parent] || policy.policy_type_parent}
                </Badge>
              </div>
              {policy.car && (
                <>
                  <div className="flex items-center gap-2">
                    <Car className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">نوع السيارة:</span>
                    <span className="font-medium">{CAR_TYPE_LABELS[policy.car.car_type || 'car']}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">قيمة السيارة:</span>
                    <span className="font-medium font-mono">₪{(policy.car.car_value || 0).toLocaleString('en-US')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">سنة الصنع:</span>
                    <span className="font-medium">{policy.car.year || '-'}</span>
                  </div>
                </>
              )}
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">الفئة العمرية:</span>
                <Badge variant={policy.is_under_24 ? 'destructive' : 'secondary'}>
                  {policy.is_under_24 ? 'أقل من 24 سنة' : '24 سنة فأكثر'}
                </Badge>
              </div>
            </div>

            <Separator />

            {/* Input Values */}
            <div className="bg-primary/5 p-4 rounded-lg">
              <h4 className="font-semibold text-sm mb-3">القيم المدخلة:</h4>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">سعر التأمين:</span>
                  <p className="font-bold font-mono text-lg">₪{insurancePrice.toLocaleString('en-US')}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">المستحق للشركة:</span>
                  <p className="font-bold font-mono text-lg text-destructive">₪{companyPayment.toLocaleString('en-US')}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">الربح:</span>
                  <p className="font-bold font-mono text-lg text-success">₪{profit.toLocaleString('en-US')}</p>
                </div>
              </div>
            </div>

            {/* Calculation Steps */}
            {renderCalculationSteps()}

            {/* Verification */}
            <div className={`p-4 rounded-lg border-2 ${isValid ? 'border-success bg-success/5' : 'border-destructive bg-destructive/5'}`}>
              <div className="flex items-center gap-2 mb-2">
                {isValid ? (
                  <CheckCircle className="h-5 w-5 text-success" />
                ) : (
                  <XCircle className="h-5 w-5 text-destructive" />
                )}
                <h4 className="font-semibold">التحقق من صحة الحسبة</h4>
              </div>
              <div className="text-sm font-mono space-y-1">
                <p>سعر التأمين = الربح + المستحق للشركة</p>
                <p>₪{insurancePrice.toLocaleString('en-US')} = ₪{profit.toLocaleString('en-US')} + ₪{companyPayment.toLocaleString('en-US')}</p>
                <p>₪{insurancePrice.toLocaleString('en-US')} = ₪{calculatedSum.toLocaleString('en-US')}</p>
                {isValid ? (
                  <p className="text-success font-semibold">✓ الحسبة صحيحة</p>
                ) : (
                  <p className="text-destructive font-semibold">✗ يوجد خطأ في الحسبة (فرق: ₪{Math.abs(calculatedSum - insurancePrice).toLocaleString('en-US')})</p>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
