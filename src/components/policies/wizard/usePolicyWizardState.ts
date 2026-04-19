import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useBranches } from "@/hooks/useBranches";
import { supabase } from "@/integrations/supabase/client";
import { digitsOnly, isValidIsraeliId, isValidPhoneNumber10 } from "@/lib/validation";
import type {
  InsuranceCategory,
  Client,
  CarRecord,
  Company,
  Broker,
  RoadService,
  AccidentFeeService,
  PackageAddon,
  PaymentLine,
  ValidationErrors,
  NewClientForm,
  NewCarForm,
  PolicyForm,
  WizardStep,
  PricingBreakdown,
  RenewalData,
} from "./types";
import { User, Car, FileText, CreditCard, Building2 } from "lucide-react";
import type { ClientChild, NewChildForm } from "@/types/clientChildren";

const DRAFT_KEY_PREFIX = "abcrm:policyWizardDraft:v4";

// Build the localStorage key for a given wizard instance. When instanceId
// is undefined (legacy direct usages of the wizard), persistence is
// skipped entirely — the controller-driven host always supplies one.
function draftKeyFor(instanceId: string | undefined): string | null {
  return instanceId ? `${DRAFT_KEY_PREFIX}:${instanceId}` : null;
}

interface UsePolicyWizardStateProps {
  open: boolean;
  instanceId?: string;
  defaultBrokerId?: string;
  defaultBrokerDirection?: 'from_broker' | 'to_broker';
  preselectedClientId?: string;
  renewalData?: RenewalData;
}

export function usePolicyWizardState({ open, instanceId, defaultBrokerId, defaultBrokerDirection, preselectedClientId, renewalData }: UsePolicyWizardStateProps) {
  const { user, isAdmin, branchId: userBranchId } = useAuth();
  const { branches, loading: loadingBranches, refetch: refetchBranches } = useBranches();
  const initialBrokerDirection = defaultBrokerDirection || "";

  // Core wizard state
  const [currentStep, setCurrentStep] = useState(1);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [saving, setSaving] = useState(false);

  // Branch — admin default comes from the DB `is_default` flag.
  // Non-admins are always locked to their own branch.
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  useEffect(() => {
    if (!isAdmin || selectedBranchId || branches.length === 0) return;
    const defaultBranch = branches.find((b) => b.is_default) ?? branches[0];
    if (defaultBranch) setSelectedBranchId(defaultBranch.id);
  }, [isAdmin, branches, selectedBranchId]);
  const effectiveBranchId = isAdmin ? selectedBranchId : userBranchId;

  // Insurance Category
  const [categories, setCategories] = useState<InsuranceCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<InsuranceCategory | null>(null);
  const isLightMode = selectedCategory?.mode === "LIGHT";

  // Client
  const [clientSearch, setClientSearch] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [createNewClient, setCreateNewClient] = useState(false);
  const [newClient, setNewClient] = useState<NewClientForm>({
    full_name: "",
    id_number: "",
    phone_number: "",
    phone_number_2: "",
    birth_date: "",
    under24_type: "none",
    under24_driver_name: "",
    under24_driver_id: "",
    notes: "",
  });
  const [loadingClients, setLoadingClients] = useState(false);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);

  // Reset state when wizard closes
  useEffect(() => {
    if (!open) {
      setSelectedClient(null);
      setCreateNewClient(false);
      setClientSearch("");
      setClients([]);
    }
  }, [open]);

  // Auto-select preselected client
  useEffect(() => {
    if (!preselectedClientId || !open) return;
    let cancelled = false;

    const fetchPreselectedClient = async () => {
      setLoadingClients(true);
      const { data, error } = await supabase
        .from('clients')
        .select('id, full_name, id_number, file_number, phone_number, less_than_24, under24_type, under24_driver_name, under24_driver_id, broker_id, accident_notes')
        .eq('id', preselectedClientId)
        .single();
      
      if (cancelled) return;
      setLoadingClients(false);
      if (!error && data) {
        setSelectedClient(data as Client);
        setCreateNewClient(false);
      }
    };

    fetchPreselectedClient();
    return () => { cancelled = true; };
  }, [preselectedClientId, open]);

  // Track if renewal data has been processed (to avoid re-processing)
  const [renewalProcessed, setRenewalProcessed] = useState(false);

  // Process renewal data to pre-populate the form
  useEffect(() => {
    if (!renewalData || !open || renewalProcessed) return;
    
    const processRenewalData = async () => {
      try {
        // 1. Fetch and select client
        const { data: clientData } = await supabase
          .from('clients')
          .select('id, full_name, id_number, file_number, phone_number, less_than_24, under24_type, under24_driver_name, under24_driver_id, broker_id')
          .eq('id', renewalData.clientId)
          .single();
        
        if (clientData) {
          setSelectedClient(clientData as Client);
          setCreateNewClient(false);
        }

        // 2. Fetch category by slug
        const { data: categoryData } = await supabase
          .from('insurance_categories')
          .select('*')
          .eq('slug', renewalData.categorySlug)
          .eq('is_active', true)
          .single();
        
        if (categoryData) {
          setSelectedCategory({
            ...categoryData,
            mode: categoryData.mode as 'FULL' | 'LIGHT',
          });
        }

        // 3. Fetch and select car (if exists)
        if (renewalData.carId) {
          const { data: carData } = await supabase
            .from('cars')
            .select('*')
            .eq('id', renewalData.carId)
            .single();
          
          if (carData) {
            setSelectedCar(carData as CarRecord);
            setCreateNewCar(false);
          }
        }

        // 4. Calculate new dates: start = original end_date + 1 day, end = start + 1 year - 1 day
        let newStartDate = new Date().toISOString().split('T')[0];
        let newEndDate = getInitialEndDate();
        
        if (renewalData.originalEndDate) {
          const origEnd = new Date(renewalData.originalEndDate);
          const start = new Date(origEnd);
          start.setDate(start.getDate() + 1);
          
          const end = new Date(start);
          end.setFullYear(end.getFullYear() + 1);
          end.setDate(end.getDate() - 1);
          
          newStartDate = start.toISOString().split('T')[0];
          newEndDate = end.toISOString().split('T')[0];
        }

        // 5. Set policy form
        setPolicy(prev => ({
          ...prev,
          policy_type_parent: renewalData.policyTypeParent,
          policy_type_child: renewalData.policyTypeChild || '',
          company_id: renewalData.companyId,
          insurance_price: String(renewalData.insurancePrice),
          broker_buy_price: renewalData.brokerBuyPrice ? String(renewalData.brokerBuyPrice) : '',
          start_date: newStartDate,
          end_date: newEndDate,
          notes: renewalData.notes || '',
        }));

        // 6. Set package mode and addons if exists
        if (renewalData.packageAddons && renewalData.packageAddons.length > 0) {
          setPackageMode(true);
          
          // Build package addons from renewal data
          const newAddons: PackageAddon[] = [
            { type: "elzami", enabled: false, company_id: "", insurance_price: "", elzami_commission: 0, start_date: "", end_date: "" },
            { type: "third_full", enabled: false, company_id: "", insurance_price: "", policy_type_child: "THIRD", broker_buy_price: "", start_date: "", end_date: "" },
            { type: "road_service", enabled: false, road_service_id: "", company_id: "", insurance_price: "", start_date: "", end_date: "" },
            { type: "accident_fee_exemption", enabled: false, accident_fee_service_id: "", company_id: "", insurance_price: "", start_date: "", end_date: "" },
          ];
          
          renewalData.packageAddons.forEach(addon => {
            const idx = newAddons.findIndex(a => a.type === addon.type);
            if (idx !== -1) {
              newAddons[idx] = {
                ...newAddons[idx],
                enabled: true,
                company_id: addon.companyId,
                insurance_price: String(addon.insurancePrice),
                road_service_id: addon.roadServiceId,
                accident_fee_service_id: addon.accidentFeeServiceId,
                policy_type_child: addon.policyTypeChild as '' | 'THIRD' | 'FULL' || '',
                broker_buy_price: addon.brokerBuyPrice ? String(addon.brokerBuyPrice) : '',
                start_date: newStartDate,
                end_date: newEndDate,
              };
            }
          });
          
          setPackageAddons(newAddons);
        }

        // 7. Set selected children IDs
        if (renewalData.childrenIds && renewalData.childrenIds.length > 0) {
          setSelectedChildIds(renewalData.childrenIds);
          
          // Fetch children data
          const { data: childrenData } = await supabase
            .from('client_children')
            .select('*')
            .in('id', renewalData.childrenIds);
          
          if (childrenData) {
            setClientChildren(childrenData as ClientChild[]);
          }
        }

        // Mark as processed
        setRenewalProcessed(true);
        
        // Move to step 3 (policy details) since client/car are pre-selected
        // Actually, let's stay on step 1 to allow review
        // but make sure steps are unlocked
      } catch (error) {
        console.error('Error processing renewal data:', error);
      }
    };

    processRenewalData();
  }, [renewalData, open, renewalProcessed]);

  // Reset renewalProcessed when dialog closes
  useEffect(() => {
    if (!open) {
      setRenewalProcessed(false);
    }
  }, [open]);

  const [clientCars, setClientCars] = useState<CarRecord[]>([]);
  const [selectedCar, setSelectedCar] = useState<CarRecord | null>(null);
  const [createNewCar, setCreateNewCar] = useState(false);
  const [newCar, setNewCar] = useState<NewCarForm>({
    car_number: "",
    manufacturer_name: "",
    model: "",
    year: "",
    color: "",
    car_type: "car",
    car_value: "",
    license_expiry: "",
  });
  const [existingCar, setExistingCar] = useState<CarRecord | null>(null);
  const [carConflict, setCarConflict] = useState<string | null>(null);
  const [loadingCars, setLoadingCars] = useState(false);
  const [fetchingCarData, setFetchingCarData] = useState(false);
  const [carDataFetched, setCarDataFetched] = useState(false);

  // Policy
  const getInitialEndDate = () => {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setFullYear(endDate.getFullYear() + 1);
    endDate.setDate(endDate.getDate() - 1);
    return endDate.toISOString().split("T")[0];
  };

  const [companies, setCompanies] = useState<Company[]>([]);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [policy, setPolicy] = useState<PolicyForm>({
    policy_type_parent: "",
    policy_type_child: "",
    company_id: "",
    start_date: new Date().toISOString().split("T")[0],
    end_date: getInitialEndDate(),
    issue_date: new Date().toISOString().split("T")[0],
    insurance_price: "",
    broker_buy_price: "",
    full_car_value: "",
    office_commission: "0",
    cancelled: false,
    transferred: false,
    notes: "",
    road_service_id: "",
    accident_fee_service_id: "",
  });
  const [policyBrokerId, setPolicyBrokerId] = useState<string>(defaultBrokerId || "");
  const [brokerDirection, setBrokerDirection] = useState<"from_broker" | "to_broker" | "">(initialBrokerDirection);
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  // Road Services & Accident Fees
  const [roadServices, setRoadServices] = useState<RoadService[]>([]);
  const [accidentFeeServices, setAccidentFeeServices] = useState<AccidentFeeService[]>([]);

  // Package mode
  const [packageMode, setPackageMode] = useState(false);
  const [packageAddons, setPackageAddons] = useState<PackageAddon[]>([
    { type: "elzami", enabled: false, company_id: "", insurance_price: "", elzami_commission: 0, start_date: "", end_date: "" },
    { type: "third_full", enabled: false, company_id: "", insurance_price: "", policy_type_child: "THIRD", broker_buy_price: "", start_date: "", end_date: "" },
    { type: "road_service", enabled: false, road_service_id: "", company_id: "", insurance_price: "", start_date: "", end_date: "" },
    { type: "accident_fee_exemption", enabled: false, accident_fee_service_id: "", company_id: "", insurance_price: "", start_date: "", end_date: "" },
  ]);
  const [packageRoadServices, setPackageRoadServices] = useState<RoadService[]>([]);
  const [packageRoadServiceCompanies, setPackageRoadServiceCompanies] = useState<Company[]>([]);
  const [packageAccidentCompanies, setPackageAccidentCompanies] = useState<Company[]>([]);
  const [packageAccidentFeeServices, setPackageAccidentFeeServices] = useState<AccidentFeeService[]>([]);
  const [packageElzamiCompanies, setPackageElzamiCompanies] = useState<Company[]>([]);
  const [packageThirdFullCompanies, setPackageThirdFullCompanies] = useState<Company[]>([]);

  // Payments
  const [payments, setPayments] = useState<PaymentLine[]>([]);

  // Files
  const [insuranceFiles, setInsuranceFiles] = useState<File[]>([]);
  const [crmFiles, setCrmFiles] = useState<File[]>([]);

  // Children / Additional Drivers (Phase 3)
  const [clientChildren, setClientChildren] = useState<ClientChild[]>([]);
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);
  const [newChildren, setNewChildren] = useState<NewChildForm[]>([]);

  // Pricing calculation - updated to support ELZAMI and THIRD_FULL in package
  const pricing: PricingBreakdown = useMemo(() => {
    const basePrice = parseFloat(policy.insurance_price) || 0;
    
    // ELZAMI addon
    const elzamiAddon = packageAddons.find(a => a.type === 'elzami');
    const elzamiPrice = packageMode && elzamiAddon?.enabled ? parseFloat(elzamiAddon.insurance_price) || 0 : 0;
    
    // THIRD_FULL addon (when ELZAMI is main)
    const thirdFullAddon = packageAddons.find(a => a.type === 'third_full');
    const thirdFullPrice = packageMode && thirdFullAddon?.enabled ? parseFloat(thirdFullAddon.insurance_price) || 0 : 0;
    
    // Road service addon
    const roadAddon = packageAddons.find(a => a.type === 'road_service');
    const roadServicePrice = packageMode && roadAddon?.enabled ? parseFloat(roadAddon.insurance_price) || 0 : 0;
    
    // Accident fee addon
    const accidentAddon = packageAddons.find(a => a.type === 'accident_fee_exemption');
    const accidentFeePrice = packageMode && accidentAddon?.enabled ? parseFloat(accidentAddon.insurance_price) || 0 : 0;
    
    // Office commission - from main policy (if ELZAMI) or from ELZAMI addon
    const mainIsElzami = policy.policy_type_parent === 'ELZAMI';
    const mainCommission = mainIsElzami ? parseFloat(policy.office_commission) || 0 : 0;
    const addonCommission = packageMode && elzamiAddon?.enabled ? parseFloat(elzamiAddon.office_commission || '0') || 0 : 0;
    const officeCommission = mainCommission + addonCommission;
    
    const totalPrice = basePrice + elzamiPrice + thirdFullPrice + roadServicePrice + accidentFeePrice;
    
    // If main policy is ELZAMI, its price doesn't go to client wallet
    // If ELZAMI is an addon, addon price doesn't go to client wallet
    // But office commission ALWAYS goes to client wallet/debt
    const elzamiTotal = mainIsElzami ? basePrice : elzamiPrice;
    const payablePrice = totalPrice - elzamiTotal + officeCommission;
    
    return {
      basePrice,
      elzamiPrice,
      thirdFullPrice,
      roadServicePrice,
      accidentFeePrice,
      officeCommission,
      totalPrice,
      payablePrice,
    };
  }, [policy.insurance_price, policy.policy_type_parent, policy.office_commission, packageMode, packageAddons]);

  // Payment validation
  const totalPaidPayments = payments.filter((p) => !p.refused).reduce((sum, p) => sum + (p.amount || 0), 0);
  const displayTotal = pricing.totalPrice + pricing.officeCommission;
  const remainingToPay = displayTotal - totalPaidPayments;
  const paymentsExceedPrice = totalPaidPayments > displayTotal && displayTotal > 0;

  // Per-row payment health. Locked system rows (ELZAMI auto) are
  // skipped — the user can't edit their amount, so validating them
  // would lock the step on invalid system state the user can't fix.
  const hasZeroPayment = payments.some(
    (p) => !p.refused && !p.locked && (p.amount || 0) <= 0,
  );
  const hasIncompleteCheque = payments.some(
    (p) =>
      !p.refused &&
      !p.locked &&
      p.payment_type === 'cheque' &&
      !(p.cheque_number && p.cheque_number.trim().length > 0),
  );

  // Steps configuration with validation
  const steps: WizardStep[] = useMemo(() => {
    const branchValid = isAdmin
      ? !!selectedBranchId && branches.length > 0
      : !!userBranchId;
    const newClientValid =
      createNewClient &&
      newClient.full_name.trim().length > 0 &&
      digitsOnly(newClient.id_number).length === 9 &&
      isValidPhoneNumber10(digitsOnly(newClient.phone_number));
    const step1Valid = branchValid && !!(selectedClient || newClientValid);
    const step2Valid = isLightMode ? true : !!(selectedCar || existingCar || (createNewCar && newCar.car_number && !carConflict));
    
    // Package addons validation - find by type instead of index
    const elzamiAddon = packageAddons.find(a => a.type === 'elzami');
    const thirdFullAddon = packageAddons.find(a => a.type === 'third_full');
    const roadServiceAddon = packageAddons.find(a => a.type === 'road_service');
    const accidentFeeAddon = packageAddons.find(a => a.type === 'accident_fee_exemption');
    
    const elzamiAddonValid = !packageMode || !elzamiAddon?.enabled || 
      (elzamiAddon.company_id && parseFloat(elzamiAddon.insurance_price) > 0);
    const thirdFullAddonValid = !packageMode || !thirdFullAddon?.enabled ||
      (thirdFullAddon.company_id && thirdFullAddon.policy_type_child && parseFloat(thirdFullAddon.insurance_price) > 0);
    const roadServiceAddonValid = !packageMode || !roadServiceAddon?.enabled || 
      (roadServiceAddon.road_service_id && roadServiceAddon.company_id && parseFloat(roadServiceAddon.insurance_price) > 0);
    const accidentFeeAddonValid = !packageMode || !accidentFeeAddon?.enabled || 
      (accidentFeeAddon.accident_fee_service_id && accidentFeeAddon.company_id && parseFloat(accidentFeeAddon.insurance_price) > 0);
    
    // FULL insurance requires car value to be entered
    const fullInsuranceCarValueValid = 
      policy.policy_type_parent !== 'THIRD_FULL' || 
      policy.policy_type_child !== 'FULL' ||
      !!(policy.full_car_value && parseFloat(policy.full_car_value) > 0);
    
    const step3Valid = !!(policy.company_id && policy.start_date && policy.end_date && policy.insurance_price && fullInsuranceCarValueValid && elzamiAddonValid && thirdFullAddonValid && roadServiceAddonValid && accidentFeeAddonValid);

    // Step 4: payments. Block when overpaid, any row has a zero
    // amount, or any cheque row is missing its cheque number.
    // hasZeroPayment / hasIncompleteCheque are computed at the top
    // of the hook so the missingFields derivation can reuse them.
    const step4Valid =
      !paymentsExceedPrice && !hasZeroPayment && !hasIncompleteCheque;

    if (isLightMode) {
      return [
        { id: 1, key: "branch_type_client", title: "النوع والعميل", icon: Building2, isUnlocked: true, isValid: step1Valid && !!selectedCategory },
        { id: 2, key: "policy", title: "الوثيقة", icon: FileText, isUnlocked: step1Valid && !!selectedCategory, isValid: step3Valid },
        { id: 3, key: "payments", title: "الدفعات", icon: CreditCard, isUnlocked: step1Valid && step3Valid, isValid: step4Valid },
      ];
    }

    return [
      { id: 1, key: "branch_type_client", title: "النوع والعميل", icon: Building2, isUnlocked: true, isValid: step1Valid && !!selectedCategory },
      { id: 2, key: "car", title: "السيارة", icon: Car, isUnlocked: step1Valid && !!selectedCategory, isValid: step2Valid },
      { id: 3, key: "policy", title: "الوثيقة", icon: FileText, isUnlocked: step1Valid && step2Valid, isValid: step3Valid },
      { id: 4, key: "payments", title: "الدفعات", icon: CreditCard, isUnlocked: step1Valid && step2Valid && step3Valid, isValid: step4Valid },
    ];
  }, [
    isAdmin, selectedBranchId, branches, userBranchId,
    selectedClient, createNewClient, newClient, selectedCategory, isLightMode,
    selectedCar, existingCar, createNewCar, newCar, carConflict,
    policy, paymentsExceedPrice, hasZeroPayment, hasIncompleteCheque,
    packageMode, packageAddons,
  ]);

  // Get current step index for the steps array
  const currentStepData = steps.find((s) => s.id === currentStep);

  // Human-readable list of fields still missing on the current step — used to
  // show a dynamic hint under the disabled "التالي" button.
  const missingFields = useMemo<string[]>(() => {
    const missing: string[] = [];

    const isPolicyStep =
      (currentStep === 3 && !isLightMode) || (currentStep === 2 && isLightMode);
    const isCarStep = currentStep === 2 && !isLightMode;
    const isPaymentStep = currentStep === (isLightMode ? 3 : 4);

    if (currentStep === 1) {
      if (isAdmin) {
        if (branches.length === 0) missing.push("الفرع (لا توجد فروع)");
        else if (!selectedBranchId) missing.push("الفرع");
      } else if (!userBranchId) {
        missing.push("الفرع");
      }
      if (!selectedCategory) missing.push("نوع التأمين");
      const hasClient = !!(
        selectedClient ||
        (createNewClient &&
          newClient.full_name.trim() &&
          digitsOnly(newClient.id_number).length === 9 &&
          isValidPhoneNumber10(digitsOnly(newClient.phone_number)))
      );
      if (!hasClient) {
        if (createNewClient) {
          if (!newClient.full_name.trim()) missing.push("اسم العميل");
          if (digitsOnly(newClient.id_number).length !== 9) missing.push("رقم الهوية");
          if (!isValidPhoneNumber10(digitsOnly(newClient.phone_number))) missing.push("رقم الهاتف");
        } else {
          missing.push("العميل");
        }
      }
    } else if (isCarStep) {
      const hasCar = !!(
        selectedCar ||
        existingCar ||
        (createNewCar && newCar.car_number && !carConflict)
      );
      if (!hasCar) missing.push("بيانات السيارة");
    } else if (isPolicyStep) {
      if (!policy.company_id) missing.push("شركة التأمين");
      if (!policy.start_date) missing.push("تاريخ البداية");
      if (!policy.end_date) missing.push("تاريخ النهاية");
      if (!policy.insurance_price) missing.push("السعر");
      if (
        policy.policy_type_parent === "THIRD_FULL" &&
        policy.policy_type_child === "FULL" &&
        !(policy.full_car_value && parseFloat(policy.full_car_value) > 0)
      ) {
        missing.push("قيمة السيارة");
      }
      if (packageMode) {
        const elzami = packageAddons.find((a) => a.type === "elzami");
        if (
          elzami?.enabled &&
          !(elzami.company_id && parseFloat(elzami.insurance_price) > 0)
        ) {
          missing.push("إكمال إلزامي في الباقة");
        }
        const tf = packageAddons.find((a) => a.type === "third_full");
        if (
          tf?.enabled &&
          !(tf.company_id && tf.policy_type_child && parseFloat(tf.insurance_price) > 0)
        ) {
          missing.push("إكمال ثالث/شامل في الباقة");
        }
        const rs = packageAddons.find((a) => a.type === "road_service");
        if (
          rs?.enabled &&
          !(rs.road_service_id && rs.company_id && parseFloat(rs.insurance_price) > 0)
        ) {
          missing.push("إكمال خدمات الطريق");
        }
        const af = packageAddons.find((a) => a.type === "accident_fee_exemption");
        if (
          af?.enabled &&
          !(af.accident_fee_service_id && af.company_id && parseFloat(af.insurance_price) > 0)
        ) {
          missing.push("إكمال إعفاء رسوم الحادث");
        }
      }
    } else if (isPaymentStep) {
      if (paymentsExceedPrice) missing.push("مجموع الدفعات يتجاوز السعر");
      if (hasZeroPayment) missing.push("مبلغ الدفعة يجب أن يكون أكبر من صفر");
      if (hasIncompleteCheque) missing.push("رقم الشيك مطلوب");
    }

    return missing;
  }, [
    currentStep,
    isAdmin,
    selectedBranchId,
    branches,
    userBranchId,
    isLightMode,
    selectedCategory,
    selectedClient,
    createNewClient,
    newClient,
    selectedCar,
    existingCar,
    createNewCar,
    newCar,
    carConflict,
    policy,
    packageMode,
    packageAddons,
    paymentsExceedPrice,
    hasZeroPayment,
    hasIncompleteCheque,
  ]);

  // Reset functions
  const resetCarData = useCallback(() => {
    setSelectedCar(null);
    setCreateNewCar(false);
    setNewCar({
      car_number: "",
      manufacturer_name: "",
      model: "",
      year: "",
      color: "",
      car_type: "car",
      car_value: "",
      license_expiry: "",
    });
    setExistingCar(null);
    setCarConflict(null);
    setCarDataFetched(false);
  }, []);

  const resetPolicyData = useCallback(() => {
    setPolicy({
      policy_type_parent: selectedCategory?.mode === "FULL" ? selectedCategory.slug : "",
      policy_type_child: "",
      company_id: "",
      start_date: new Date().toISOString().split("T")[0],
      end_date: getInitialEndDate(),
      issue_date: new Date().toISOString().split("T")[0],
      insurance_price: "",
      broker_buy_price: "",
      full_car_value: "",
      office_commission: "0",
      cancelled: false,
      transferred: false,
      notes: "",
      road_service_id: "",
      accident_fee_service_id: "",
    });
    setPolicyBrokerId(defaultBrokerId || "");
    setBrokerDirection("");
    setPackageMode(false);
    setPackageAddons([
      { type: "elzami", enabled: false, company_id: "", insurance_price: "", elzami_commission: 0, start_date: "", end_date: "" },
      { type: "third_full", enabled: false, company_id: "", insurance_price: "", policy_type_child: "THIRD", broker_buy_price: "", start_date: "", end_date: "" },
      { type: "road_service", enabled: false, road_service_id: "", company_id: "", insurance_price: "", start_date: "", end_date: "" },
      { type: "accident_fee_exemption", enabled: false, accident_fee_service_id: "", company_id: "", insurance_price: "", start_date: "", end_date: "" },
    ]);
  }, [selectedCategory, defaultBrokerId]);

  const resetPayments = useCallback(() => {
    setPayments([]);
  }, []);

  const resetChildren = useCallback(() => {
    setClientChildren([]);
    setSelectedChildIds([]);
    setNewChildren([]);
  }, []);

  const resetForm = useCallback(() => {
    setCurrentStep(1);
    setSelectedClient(null);
    setCreateNewClient(false);
    setNewClient({
      full_name: "",
      id_number: "",
      phone_number: "",
      phone_number_2: "",
      birth_date: "",
      under24_type: "none",
      under24_driver_name: "",
      under24_driver_id: "",
      notes: "",
    });
    resetCarData();
    resetPolicyData();
    resetPayments();
    resetChildren();
    setInsuranceFiles([]);
    setCrmFiles([]);
    setErrors({});
    setSelectedCategory(null);
  }, [resetCarData, resetPolicyData, resetPayments, resetChildren]);

  // Validation
  const validateStep = useCallback((stepId: number): boolean => {
    const newErrors: ValidationErrors = {};
    const step = steps.find((s) => s.id === stepId);
    if (!step) return false;

    switch (step.key) {
      case "branch_type_client":
        if (isAdmin) {
          if (branches.length === 0) {
            newErrors.branch = "يجب إضافة فرع قبل إنشاء وثيقة";
          } else if (!selectedBranchId) {
            newErrors.branch = "الرجاء اختيار الفرع";
          }
        } else if (!userBranchId) {
          newErrors.branch = "لا يوجد فرع مرتبط بحسابك. تواصل مع المدير";
        }
        if (!selectedCategory) newErrors.category = "الرجاء اختيار نوع التأمين";
        if (!selectedClient && !createNewClient) {
          newErrors.client = "الرجاء اختيار عميل أو إنشاء عميل جديد";
        }
        if (createNewClient) {
          if (!newClient.full_name.trim()) newErrors.full_name = "الاسم مطلوب";
          const id = digitsOnly(newClient.id_number);
          if (!id) newErrors.id_number = "رقم الهوية مطلوب";
          else if (id.length !== 9) newErrors.id_number = "رقم الهوية يجب أن يكون 9 أرقام";
          else if (!isValidIsraeliId(id)) newErrors.id_number = "رقم الهوية غير صحيح";
          const phone = digitsOnly(newClient.phone_number);
          if (!phone) newErrors.phone_number = "رقم الهاتف مطلوب";
          else if (!isValidPhoneNumber10(phone)) newErrors.phone_number = "رقم الهاتف يجب أن يكون 10 أرقام";
          const phone2 = digitsOnly(newClient.phone_number_2);
          if (phone2.length > 0 && !isValidPhoneNumber10(phone2)) {
            newErrors.phone_number_2 = "رقم الهاتف يجب أن يكون 10 أرقام";
          }
          if (newClient.under24_type === "additional_driver") {
            if (!newClient.under24_driver_name?.trim()) newErrors.under24_driver_name = "اسم السائق مطلوب";
            const driverId = digitsOnly(newClient.under24_driver_id);
            if (!driverId || driverId.length !== 9) newErrors.under24_driver_id = "رقم هوية السائق يجب أن يكون 9 أرقام";
            else if (!isValidIsraeliId(driverId)) newErrors.under24_driver_id = "رقم هوية السائق غير صحيح";
          }
        }
        break;

      case "car":
        if (!selectedCar && !existingCar && !createNewCar) {
          newErrors.car = "الرجاء اختيار سيارة أو إضافة سيارة جديدة";
        }
        if (createNewCar) {
          if (!newCar.car_number.trim()) newErrors.car_number = "رقم السيارة مطلوب";
          if (carConflict) newErrors.car_number = carConflict;
          if (!newCar.model?.trim()) newErrors.model = "الموديل مطلوب";
          if (!newCar.year?.trim()) newErrors.year = "سنة الصنع مطلوبة";
        }
        break;

      case "policy":
        if (!policy.company_id) newErrors.company_id = "شركة التأمين مطلوبة";
        if (!policy.start_date) newErrors.start_date = "تاريخ البداية مطلوب";
        if (!policy.end_date) newErrors.end_date = "تاريخ النهاية مطلوب";
        if (!policy.insurance_price) newErrors.insurance_price = "السعر مطلوب";
        else if (parseFloat(policy.insurance_price) <= 0) newErrors.insurance_price = "السعر يجب أن يكون أكبر من صفر";
        if (policy.policy_type_parent === "THIRD_FULL" && !policy.policy_type_child) {
          newErrors.policy_type_child = "النوع الفرعي مطلوب";
        }
        // Validate car value for FULL insurance
        if (policy.policy_type_parent === "THIRD_FULL" && policy.policy_type_child === "FULL") {
          const carValue = policy.full_car_value || 
                           selectedCar?.car_value?.toString() || 
                           (createNewCar ? newCar.car_value : existingCar?.car_value?.toString());
          if (!carValue || parseFloat(carValue) <= 0) {
            newErrors.full_car_value = "قيمة السيارة مطلوبة للتأمين الشامل";
          }
        }
        if (policy.policy_type_parent === "ROAD_SERVICE" && !policy.road_service_id) {
          newErrors.road_service_id = "الرجاء اختيار خدمة الطريق";
        }
        if (policyBrokerId && policyBrokerId !== "none" && !brokerDirection) {
          newErrors.broker_direction = "الرجاء اختيار نوع التعامل مع الوسيط";
        }
        // Package addons validation - find by type
        const elzamiAddon = packageAddons.find(a => a.type === 'elzami');
        const thirdFullAddon = packageAddons.find(a => a.type === 'third_full');
        const roadAddon = packageAddons.find(a => a.type === 'road_service');
        const accidentAddon = packageAddons.find(a => a.type === 'accident_fee_exemption');
        
        if (packageMode && elzamiAddon?.enabled) {
          if (!elzamiAddon.company_id) newErrors.addon_elzami_company = "الرجاء اختيار الشركة";
          if (!elzamiAddon.insurance_price || parseFloat(elzamiAddon.insurance_price) <= 0) {
            newErrors.addon_elzami_price = "السعر مطلوب";
          }
        }
        if (packageMode && thirdFullAddon?.enabled) {
          if (!thirdFullAddon.company_id) newErrors.addon_thirdfull_company = "الرجاء اختيار الشركة";
          if (!thirdFullAddon.policy_type_child) newErrors.addon_thirdfull_child = "الرجاء اختيار النوع الفرعي";
          if (!thirdFullAddon.insurance_price || parseFloat(thirdFullAddon.insurance_price) <= 0) {
            newErrors.addon_thirdfull_price = "السعر مطلوب";
          }
        }
        if (packageMode && roadAddon?.enabled) {
          if (!roadAddon.road_service_id) newErrors.addon_road_service = "الرجاء اختيار نوع الخدمة";
          if (!roadAddon.company_id) newErrors.addon_road_company = "الرجاء اختيار الشركة";
          if (!roadAddon.insurance_price || parseFloat(roadAddon.insurance_price) <= 0) {
            newErrors.addon_road_price = "السعر مطلوب";
          }
        }
        if (packageMode && accidentAddon?.enabled) {
          if (!accidentAddon.accident_fee_service_id) newErrors.addon_accident_service = "الرجاء اختيار نوع الخدمة";
          if (!accidentAddon.company_id) newErrors.addon_accident_company = "الرجاء اختيار الشركة";
          if (!accidentAddon.insurance_price || parseFloat(accidentAddon.insurance_price) <= 0) {
            newErrors.addon_accident_price = "السعر مطلوب";
          }
        }
        break;

      case "payments":
        if (paymentsExceedPrice) {
          newErrors.payments = "مجموع الدفعات يتجاوز سعر التأمين";
        }
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [
    steps, selectedCategory, selectedClient, createNewClient, newClient,
    selectedCar, existingCar, createNewCar, newCar, carConflict,
    policy, policyBrokerId, brokerDirection, paymentsExceedPrice,
    packageMode, packageAddons,
  ]);

  // Navigate to step
  const goToStep = useCallback((stepId: number) => {
    const targetStep = steps.find((s) => s.id === stepId);
    if (targetStep?.isUnlocked) {
      setCurrentStep(stepId);
    }
  }, [steps]);

  // ─── Per-instance draft persistence ──────────────────────────────────
  // Serialize the form state to localStorage keyed by the wizard instance
  // id so a page refresh (or closing + reopening the browser) restores the
  // same client, car, policy fields, payments, etc. the user was editing.
  // Loading happens once on mount; saving is debounced on every change.
  const draftKey = draftKeyFor(instanceId);
  const hasHydratedRef = useRef(false);

  // Load snapshot on mount (once, keyed by instanceId). Primitive fields
  // are applied synchronously; selectedCategory / selectedClient / selectedCar
  // are re-fetched asynchronously by id and then the ref flips so the save
  // effect starts writing again.
  useEffect(() => {
    if (!draftKey) {
      hasHydratedRef.current = true;
      return;
    }
    let cancelled = false;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) {
        hasHydratedRef.current = true;
        return;
      }
      const snap = JSON.parse(raw);
      if (typeof snap.currentStep === "number") setCurrentStep(snap.currentStep);
      if (typeof snap.selectedBranchId === "string") setSelectedBranchId(snap.selectedBranchId);
      if (typeof snap.createNewClient === "boolean") setCreateNewClient(snap.createNewClient);
      if (snap.newClient) setNewClient(snap.newClient);
      if (typeof snap.createNewCar === "boolean") setCreateNewCar(snap.createNewCar);
      if (snap.newCar) setNewCar(snap.newCar);
      if (snap.policy) setPolicy(snap.policy);
      if (typeof snap.policyBrokerId === "string") setPolicyBrokerId(snap.policyBrokerId);
      if (snap.brokerDirection) setBrokerDirection(snap.brokerDirection);
      if (typeof snap.packageMode === "boolean") setPackageMode(snap.packageMode);
      if (Array.isArray(snap.packageAddons)) setPackageAddons(snap.packageAddons);
      if (Array.isArray(snap.payments)) setPayments(snap.payments);
      if (Array.isArray(snap.selectedChildIds)) setSelectedChildIds(snap.selectedChildIds);
      if (Array.isArray(snap.newChildren)) setNewChildren(snap.newChildren);

      const asyncHydrate = async () => {
        const tasks: Promise<void>[] = [];
        if (snap.selectedCategoryId) {
          tasks.push(
            Promise.resolve(
              supabase
                .from("insurance_categories")
                .select("*")
                .eq("id", snap.selectedCategoryId)
                .maybeSingle()
                .then(({ data }) => {
                  if (!cancelled && data) {
                    setSelectedCategory({
                      ...(data as any),
                      mode: (data as any).mode as "FULL" | "LIGHT",
                    });
                  }
                }),
            ),
          );
        }
        if (snap.selectedClientId) {
          tasks.push(
            Promise.resolve(
              supabase
                .from("clients")
                .select(
                  "id, full_name, id_number, file_number, phone_number, less_than_24, under24_type, under24_driver_name, under24_driver_id, broker_id, accident_notes",
                )
                .eq("id", snap.selectedClientId)
                .maybeSingle()
                .then(({ data }) => {
                  if (!cancelled && data) setSelectedClient(data as Client);
                }),
            ),
          );
        }
        if (snap.selectedCarId) {
          tasks.push(
            Promise.resolve(
              supabase
                .from("cars")
                .select("*")
                .eq("id", snap.selectedCarId)
                .maybeSingle()
                .then(({ data }) => {
                  if (!cancelled && data) setSelectedCar(data as CarRecord);
                }),
            ),
          );
        }
        await Promise.all(tasks);
        if (!cancelled) hasHydratedRef.current = true;
      };
      asyncHydrate();
    } catch {
      hasHydratedRef.current = true;
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Save snapshot on any relevant state change. No debounce — localStorage
  // writes are cheap (~1ms) and debouncing dropped data when the user
  // refreshed within the debounce window. React's useEffect dep-diffing
  // already throttles us to the render cadence, so this runs at most
  // once per commit.
  useEffect(() => {
    if (!draftKey || !hasHydratedRef.current) return;
    try {
      const snap = {
        currentStep,
        selectedBranchId,
        selectedCategoryId: selectedCategory?.id ?? null,
        selectedClientId: selectedClient?.id ?? null,
        createNewClient,
        newClient,
        selectedCarId: (selectedCar as any)?.id ?? null,
        createNewCar,
        newCar,
        policy,
        policyBrokerId,
        brokerDirection,
        packageMode,
        packageAddons,
        payments: payments.map((p) => {
          const { cheque_image, ...rest } = p as any;
          return rest;
        }),
        selectedChildIds,
        newChildren,
      };
      localStorage.setItem(draftKey, JSON.stringify(snap));
    } catch {
      // ignore quota / parse errors
    }
  }, [
    draftKey,
    currentStep,
    selectedBranchId,
    selectedCategory,
    selectedClient,
    createNewClient,
    newClient,
    selectedCar,
    createNewCar,
    newCar,
    policy,
    policyBrokerId,
    brokerDirection,
    packageMode,
    packageAddons,
    payments,
    selectedChildIds,
    newChildren,
  ]);

  // Clear draft (called on explicit close / after save)
  const clearDraft = useCallback(() => {
    try {
      if (draftKey) localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
  }, [draftKey]);

  return {
    // Core state
    currentStep,
    setCurrentStep,
    errors,
    setErrors,
    saving,
    setSaving,
    steps,
    currentStepData,
    missingFields,
    goToStep,

    // Branch
    selectedBranchId,
    setSelectedBranchId,
    effectiveBranchId,
    branches,
    loadingBranches,
    refetchBranches,
    isAdmin,

    // Category
    categories,
    setCategories,
    selectedCategory,
    setSelectedCategory,
    isLightMode,

    // Client
    clientSearch,
    setClientSearch,
    clients,
    setClients,
    selectedClient,
    setSelectedClient,
    createNewClient,
    setCreateNewClient,
    newClient,
    setNewClient,
    loadingClients,
    setLoadingClients,
    checkingDuplicate,
    setCheckingDuplicate,

    // Car
    clientCars,
    setClientCars,
    selectedCar,
    setSelectedCar,
    createNewCar,
    setCreateNewCar,
    newCar,
    setNewCar,
    existingCar,
    setExistingCar,
    carConflict,
    setCarConflict,
    loadingCars,
    setLoadingCars,
    fetchingCarData,
    setFetchingCarData,
    carDataFetched,
    setCarDataFetched,

    // Policy
    companies,
    setCompanies,
    brokers,
    setBrokers,
    policy,
    setPolicy,
    policyBrokerId,
    setPolicyBrokerId,
    brokerDirection,
    setBrokerDirection,
    loadingCompanies,
    setLoadingCompanies,

    // Services
    roadServices,
    setRoadServices,
    accidentFeeServices,
    setAccidentFeeServices,

    // Package
    packageMode,
    setPackageMode,
    packageAddons,
    setPackageAddons,
    packageRoadServices,
    setPackageRoadServices,
    packageRoadServiceCompanies,
    setPackageRoadServiceCompanies,
    packageAccidentCompanies,
    setPackageAccidentCompanies,
    packageAccidentFeeServices,
    setPackageAccidentFeeServices,
    packageElzamiCompanies,
    setPackageElzamiCompanies,
    packageThirdFullCompanies,
    setPackageThirdFullCompanies,

    // Payments
    payments,
    setPayments,
    pricing,
    totalPaidPayments,
    remainingToPay,
    paymentsExceedPrice,

    // Files
    insuranceFiles,
    setInsuranceFiles,
    crmFiles,
    setCrmFiles,

    // Children / Additional Drivers
    clientChildren,
    setClientChildren,
    selectedChildIds,
    setSelectedChildIds,
    newChildren,
    setNewChildren,

    // Functions
    resetCarData,
    resetPolicyData,
    resetPayments,
    resetChildren,
    resetForm,
    validateStep,
    clearDraft,

    // Auth
    user,
    userBranchId,
  };
}
