import { supabase } from '@/integrations/supabase/client';
import type { Enums } from '@/integrations/supabase/types';

interface CalculateProfitParams {
  policyTypeParent: Enums<'policy_type_parent'>;
  policyTypeChild: Enums<'policy_type_child'> | null;
  companyId: string;
  carType: Enums<'car_type'>;
  ageBand: Enums<'age_band'>;
  carValue: number | null;
  carYear: number | null;
  insurancePrice: number;
  roadServiceId?: string | null; // For ROAD_SERVICE policies
  accidentFeeServiceId?: string | null; // For ACCIDENT_FEE_EXEMPTION policies
  brokerBuyPrice?: number | null; // When company is linked to broker - this is the cost we pay to broker
}

interface ProfitResult {
  companyPayment: number;
  profit: number;
  elzamiCost?: number; // تكلفة عمولة الإلزامي (قيمة سالبة)
}

/**
 * Calculate company payment and profit based on pricing rules
 * Following the legacy WP calculation logic
 */
export async function calculatePolicyProfit(params: CalculateProfitParams): Promise<ProfitResult> {
  const {
    policyTypeParent,
    policyTypeChild,
    companyId,
    carType,
    ageBand,
    carValue,
    carYear,
    insurancePrice,
    roadServiceId,
    brokerBuyPrice,
  } = params;

  // If broker buy price is provided and > 0, use it for profit calculation
  // This takes priority over pricing rules when dealing with broker-linked companies
  if (brokerBuyPrice && brokerBuyPrice > 0) {
    // Profit = selling price - broker cost
    const profit = insurancePrice - brokerBuyPrice;
    return { 
      companyPayment: brokerBuyPrice, 
      profit: profit
    };
  }

  // ELZAMI: لا يوجد ربح، الشركة تأخذ كامل المبلغ + قد تأخذ عمولة منا
  // العمولة هي تكلفة سالبة على الوكالة وليست ربحاً
  if (policyTypeParent === 'ELZAMI') {
    // Fetch the ELZAMI commission (cost) from the company
    const { data: company } = await supabase
      .from('insurance_companies')
      .select('elzami_commission')
      .eq('id', companyId)
      .single();
    
    // العمولة هي تكلفة تُخصم من الوكالة (تُسجل كقيمة سالبة في التقارير)
    const elzamiCost = company?.elzami_commission || 0;
    return { 
      companyPayment: insurancePrice, 
      profit: 0,  // لا ربح من الإلزامي
      elzamiCost  // تكلفة العمولة
    };
  }

  try {
    // Fetch relevant pricing rules for the company
    const { data: rules, error } = await supabase
      .from('pricing_rules')
      .select('*')
      .eq('company_id', companyId)
      .eq('policy_type_parent', policyTypeParent);

    if (error) throw error;

    const sortBySpecificity = (a: typeof rules extends (infer T)[] ? T : never, b: typeof rules extends (infer T)[] ? T : never) => {
      const aScore = (a.car_type === carType ? 2 : 0) + (a.age_band === ageBand ? 1 : 0);
      const bScore = (b.car_type === carType ? 2 : 0) + (b.age_band === ageBand ? 1 : 0);
      return bScore - aScore;
    };

    const getRuleValue = (
      ruleType: Enums<'pricing_rule_type'>,
      matchCarType = true,
      matchAgeBand = true,
      filterByCarValue = false
    ): number => {
      const matchesCarValueRange = (r: any): boolean => {
        if (!filterByCarValue || !carValue) return true;
        const minVal = r.min_car_value as number | null;
        const maxVal = r.max_car_value as number | null;
        // Rules without range = fallback (match only if no ranged rule matches)
        if (minVal === null && maxVal === null) return true;
        if (minVal !== null && carValue < minVal) return false;
        if (maxVal !== null && carValue > maxVal) return false;
        return true;
      };

      const rangedSpecificity = (r: any): number => {
        // Prefer rules with explicit car value range over generic ones
        const hasRange = (r.min_car_value !== null || r.max_car_value !== null) ? 1 : 0;
        return hasRange;
      };

      // 1. Exact match including car_type
      const exactMatch = rules?.filter(r => {
        if (r.rule_type !== ruleType) return false;
        if (matchCarType && r.car_type && r.car_type !== carType) return false;
        if (matchAgeBand && r.age_band && r.age_band !== 'ANY' && r.age_band !== ageBand) return false;
        if (!matchesCarValueRange(r)) return false;
        return true;
      }) || [];

      exactMatch.sort((a, b) => {
        // First sort by car value range specificity (ranged > generic)
        const rangeSort = rangedSpecificity(b) - rangedSpecificity(a);
        if (rangeSort !== 0) return rangeSort;
        return sortBySpecificity(a, b);
      });
      if (exactMatch.length > 0) return exactMatch[0].value ?? 0;

      // 2. Fallback: ignore car_type filter (use generic rules as default)
      if (matchCarType) {
        const fallback = rules?.filter(r => {
          if (r.rule_type !== ruleType) return false;
          if (matchAgeBand && r.age_band && r.age_band !== 'ANY' && r.age_band !== ageBand) return false;
          if (!matchesCarValueRange(r)) return false;
          return true;
        }) || [];
        fallback.sort((a, b) => {
          const rangeSort = rangedSpecificity(b) - rangedSpecificity(a);
          if (rangeSort !== 0) return rangeSort;
          return sortBySpecificity(a, b);
        });
        if (fallback.length > 0) return fallback[0].value ?? 0;
      }

      return 0;
    };

    // ROAD_SERVICE calculation - fetch from company_road_service_prices table
    if (policyTypeParent === 'ROAD_SERVICE') {
      // Use roadServiceId if provided, otherwise fall back to old pricing_rules logic
      if (roadServiceId) {
        const { data: roadServicePrice } = await supabase
          .from('company_road_service_prices')
          .select('company_cost')
          .eq('company_id', companyId)
          .eq('road_service_id', roadServiceId)
          .eq('car_type', carType)
          .or(`age_band.eq.${ageBand},age_band.eq.ANY`)
          .order('age_band', { ascending: ageBand === 'UNDER_24' }) // Prefer exact match
          .limit(1)
          .maybeSingle();

        if (roadServicePrice) {
          const companyPayment = roadServicePrice.company_cost || 0;
          return { companyPayment, profit: insurancePrice - companyPayment };
        }
        
        // If no specific pricing found, try without car_type filter
        const { data: fallbackPrice } = await supabase
          .from('company_road_service_prices')
          .select('company_cost')
          .eq('company_id', companyId)
          .eq('road_service_id', roadServiceId)
          .or(`age_band.eq.${ageBand},age_band.eq.ANY`)
          .limit(1)
          .maybeSingle();

        if (fallbackPrice) {
          const companyPayment = fallbackPrice.company_cost || 0;
          return { companyPayment, profit: insurancePrice - companyPayment };
        }
        
        // No pricing found = full profit
        return { companyPayment: 0, profit: insurancePrice };
      }
      
      // Fallback to old pricing_rules logic for backward compatibility
      let basePrice = getRuleValue('ROAD_SERVICE_PRICE', false, true);
      if (basePrice === 0) {
        basePrice = getRuleValue('ROAD_SERVICE_BASE', false, true);
      }

      // If no road service rules exist, full profit
      if (basePrice === 0) {
        return { companyPayment: 0, profit: insurancePrice };
      }

      let extraOld = 0;
      if (carYear && carYear <= 2007) {
        extraOld = getRuleValue('ROAD_SERVICE_EXTRA_OLD_CAR', false, false);
      }

      const companyPayment = basePrice + extraOld;
      return { companyPayment, profit: insurancePrice - companyPayment };
    }

    // THIRD_FULL calculation
    if (policyTypeParent === 'THIRD_FULL') {
      const thirdPrice = getRuleValue('THIRD_PRICE', true, true);

      // THIRD only
      if (policyTypeChild === 'THIRD' || !policyTypeChild) {
        // If no third price rule exists, full profit (empty = no company cost)
        if (thirdPrice === 0) {
          return { companyPayment: 0, profit: insurancePrice };
        }
        return { companyPayment: thirdPrice, profit: insurancePrice - thirdPrice };
      }

      // FULL calculation
      if (policyTypeChild === 'FULL') {
        // Get discount - this is a FIXED ₪ amount that REPLACES third_price, NOT a percentage
        const discount = getRuleValue('DISCOUNT', true, false);
        const fullPercent = getRuleValue('FULL_PERCENT', true, false, true);
        const minPrice = getRuleValue('MIN_PRICE', true, false);
        
        // If no full rules exist (no percent, no discount, no min), full profit
        if (fullPercent === 0 && discount === 0 && minPrice === 0 && thirdPrice === 0) {
          return { companyPayment: 0, profit: insurancePrice };
        }
        
        // If discount exists, use it as third_component; otherwise use thirdPrice
        let thirdComponent = thirdPrice;
        if (discount > 0) {
          thirdComponent = discount;  // FIXED: discount replaces third_price, not reduces it
        }

        // Calculate full component
        let fullComponent = 0;
        if (carValue && carValue >= 60000 && fullPercent > 0) {
          fullComponent = carValue * (fullPercent / 100);
        } else if (minPrice > 0) {
          fullComponent = minPrice;
        }
        // If no full percent and no min price, full component stays 0

        const companyPayment = fullComponent + thirdComponent;
        return { companyPayment, profit: insurancePrice - companyPayment };
      }
    }

    // ACCIDENT_FEE_EXEMPTION - fetch from company_accident_fee_prices table
    if (policyTypeParent === 'ACCIDENT_FEE_EXEMPTION') {
      const { accidentFeeServiceId } = params;
      
      if (accidentFeeServiceId) {
        const { data: accidentFeePrice } = await supabase
          .from('company_accident_fee_prices')
          .select('company_cost')
          .eq('company_id', companyId)
          .eq('accident_fee_service_id', accidentFeeServiceId)
          .maybeSingle();

        if (accidentFeePrice) {
          const companyPayment = accidentFeePrice.company_cost || 0;
          return { companyPayment, profit: insurancePrice - companyPayment };
        }
        
        // No pricing found = full profit
        return { companyPayment: 0, profit: insurancePrice };
      }
      
      // Fallback to old pricing_rules logic for backward compatibility
      const fixedPrice = getRuleValue('THIRD_PRICE', false, false);
      // If no rule, full profit
      if (fixedPrice === 0) {
        return { companyPayment: 0, profit: insurancePrice };
      }
      return { companyPayment: fixedPrice, profit: insurancePrice - fixedPrice };
    }

    // Default: No rules found = full profit (empty = full profit rule)
    return { companyPayment: 0, profit: insurancePrice };
  } catch (error) {
    console.error('Error calculating profit:', error);
    // Return safe defaults on error
    return { companyPayment: insurancePrice, profit: 0 };
  }
}

/**
 * Recalculate profit for an existing policy (for migrations/fixes)
 */
export async function recalculatePolicyProfit(policyId: string): Promise<ProfitResult | null> {
  try {
    // Fetch policy with car data
    const { data: policy, error } = await supabase
      .from('policies')
      .select(`
        *,
        cars (
          car_type,
          car_value,
          year
        ),
        clients!inner (
          less_than_24
        )
      `)
      .eq('id', policyId)
      .single();

    if (error || !policy) throw error;

    const ageBand: Enums<'age_band'> = policy.clients.less_than_24 ? 'UNDER_24' : 'UP_24';

    const result = await calculatePolicyProfit({
      policyTypeParent: policy.policy_type_parent,
      policyTypeChild: policy.policy_type_child,
      companyId: policy.company_id,
      carType: policy.cars?.car_type || 'car',
      ageBand,
      carValue: policy.cars?.car_value ?? null,
      carYear: policy.cars?.year ?? null,
      insurancePrice: policy.insurance_price,
      brokerBuyPrice: policy.broker_buy_price,
      roadServiceId: policy.road_service_id,
      accidentFeeServiceId: policy.accident_fee_service_id,
    });

    // Update the policy with new values
    await supabase
      .from('policies')
      .update({
        payed_for_company: result.companyPayment,
        profit: result.profit,
      })
      .eq('id', policyId);

    return result;
  } catch (error) {
    console.error('Error recalculating policy profit:', error);
    return null;
  }
}
