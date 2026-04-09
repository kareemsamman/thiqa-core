import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ProfitSummary {
  todayProfit: number;
  monthProfit: number;
  yearProfit: number;
  totalCompanyPaymentDue: number;
  totalBrokerDebtOwed: number; // المستحق للوسطاء (ما ندين به للوسيط)
  totalBrokerDebtOwing: number; // المستحق من الوسطاء (ما يدين به الوسيط لنا)
  todayRevenue: number;
  monthRevenue: number;
  yearRevenue: number;
  // Breakdown for charts
  elzamiCommission: number;
  otherProfit: number;
  monthElzamiCommission: number;
  monthOtherProfit: number;
  // ELZAMI costs (new)
  totalElzamiCost: number;
  monthElzamiCost: number;
  todayElzamiCost: number;
  // Net profit (after ELZAMI costs)
  netProfit: number;
  monthNetProfit: number;
  todayNetProfit: number;
}

export function useProfitSummary() {
  const [summary, setSummary] = useState<ProfitSummary>({
    todayProfit: 0,
    monthProfit: 0,
    yearProfit: 0,
    totalCompanyPaymentDue: 0,
    totalBrokerDebtOwed: 0,
    totalBrokerDebtOwing: 0,
    todayRevenue: 0,
    monthRevenue: 0,
    yearRevenue: 0,
    elzamiCommission: 0,
    otherProfit: 0,
    monthElzamiCommission: 0,
    monthOtherProfit: 0,
    totalElzamiCost: 0,
    monthElzamiCost: 0,
    todayElzamiCost: 0,
    netProfit: 0,
    monthNetProfit: 0,
    todayNetProfit: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];

      // Fetch all active policies for the year with profit data and policy type
      // Include company data to check if company is broker-linked
      const { data: policies, error } = await supabase
        .from('policies')
        .select(`
          start_date, 
          profit, 
          payed_for_company, 
          insurance_price,
          policy_type_parent,
          elzami_cost,
          broker_id,
          broker_direction,
          broker_buy_price,
          company_id,
          insurance_companies!policies_company_id_fkey(broker_id)
        `)
        .is('deleted_at', null)
        .eq('cancelled', false)
        .gte('start_date', '2026-01-01');

      if (error) throw error;

      // Fetch broker settlements to calculate net broker debt
      const { data: brokerSettlements } = await supabase
        .from('broker_settlements')
        .select('direction, total_amount, status')
        .eq('status', 'completed')
        .gte('created_at', '2026-01-01');

      let todayProfit = 0;
      let monthProfit = 0;
      let yearProfit = 0;
      let totalCompanyPaymentDue = 0;
      let totalBrokerDebtOwed = 0; // ما ندين به للوسيط (from_broker)
      let totalBrokerDebtOwing = 0; // ما يدين به الوسيط لنا (to_broker)
      let todayRevenue = 0;
      let monthRevenue = 0;
      let yearRevenue = 0;
      let elzamiCommission = 0;
      let otherProfit = 0;
      let monthElzamiCommission = 0;
      let monthOtherProfit = 0;
      let totalElzamiCost = 0;
      let monthElzamiCost = 0;
      let todayElzamiCost = 0;

      policies?.forEach((policy) => {
        const isElzami = policy.policy_type_parent === 'ELZAMI';
        
        let policyProfit: number;
        let policyRevenue: number;
        
        if (isElzami) {
          // ELZAMI: العمولة هي تكلفة سالبة وليست ربحاً - نستخدم elzami_cost مباشرة من البوليصة
          const elzamiCost = Number(policy.elzami_cost) || 0;
          policyProfit = 0;  // لا ربح من الإلزامي
          policyRevenue = 0; // الإيراد لا يُحسب لأنه يذهب للشركة
          
          // تسجيل تكلفة الإلزامي (كقيمة موجبة للعرض، لكنها خصم)
          totalElzamiCost += elzamiCost;
          elzamiCommission += elzamiCost; // للتوافق مع القديم
          
          if (policy.start_date >= monthStart) {
            monthElzamiCost += elzamiCost;
            monthElzamiCommission += elzamiCost;
          }
          if (policy.start_date === today) {
            todayElzamiCost += elzamiCost;
          }
        } else {
          policyProfit = Number(policy.profit) || 0;
          policyRevenue = Number(policy.insurance_price) || 0;
          
          // Only add to company payment due if company is NOT broker-linked
          const companyData = policy.insurance_companies as any;
          const isCompanyBrokerLinked = companyData?.broker_id != null;
          if (!isCompanyBrokerLinked) {
            totalCompanyPaymentDue += Number(policy.payed_for_company) || 0;
          }
          
          otherProfit += policyProfit;
          if (policy.start_date >= monthStart) {
            monthOtherProfit += policyProfit;
          }
          
          // Calculate broker debts
          if (policy.broker_id && policy.broker_buy_price) {
            const buyPrice = Number(policy.broker_buy_price) || 0;
            if (policy.broker_direction === 'from_broker') {
              // نشتري من الوسيط = ندين للوسيط
              totalBrokerDebtOwed += buyPrice;
            } else if (policy.broker_direction === 'to_broker') {
              // نبيع للوسيط = الوسيط يدين لنا بالربح
              totalBrokerDebtOwing += policyProfit;
            }
          }
        }

        yearProfit += policyProfit;
        yearRevenue += policyRevenue;

        if (policy.start_date >= monthStart) {
          monthProfit += policyProfit;
          monthRevenue += policyRevenue;
        }

        if (policy.start_date === today) {
          todayProfit += policyProfit;
          todayRevenue += policyRevenue;
        }
      });

      // حساب صافي الربح بعد خصم تكلفة الإلزامي
      const netProfit = yearProfit - totalElzamiCost;
      const monthNetProfit = monthProfit - monthElzamiCost;
      const todayNetProfit = todayProfit - todayElzamiCost;

      // Adjust broker debts based on settlements
      brokerSettlements?.forEach((settlement) => {
        const amount = Number(settlement.total_amount) || 0;
        if (settlement.direction === 'to_broker') {
          // دفعنا للوسيط = نقص من ديننا
          totalBrokerDebtOwed -= amount;
        } else if (settlement.direction === 'from_broker') {
          // استلمنا من الوسيط = نقص من دينه علينا
          totalBrokerDebtOwing -= amount;
        }
      });

      setSummary({
        todayProfit,
        monthProfit,
        yearProfit,
        totalCompanyPaymentDue,
        totalBrokerDebtOwed: Math.max(0, totalBrokerDebtOwed),
        totalBrokerDebtOwing: Math.max(0, totalBrokerDebtOwing),
        todayRevenue,
        monthRevenue,
        yearRevenue,
        elzamiCommission,
        otherProfit,
        monthElzamiCommission,
        monthOtherProfit,
        totalElzamiCost,
        monthElzamiCost,
        todayElzamiCost,
        netProfit,
        monthNetProfit,
        todayNetProfit,
      });
    } catch (error) {
      console.error('Error fetching profit summary:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  return { summary, loading, refetch: fetchSummary };
}
