import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Save, ArrowRight, ArrowLeft, Minus, X } from "lucide-react";
import type { WizardDraftSummary } from "@/hooks/usePolicyWizardController";
import { cn } from "@/lib/utils";
import { calculatePolicyProfit } from "@/lib/pricingCalculator";
import { digitsOnly } from "@/lib/validation";
import { TranzilaPaymentModal } from "@/components/payments/TranzilaPaymentModal";
import { PolicySuccessDialog } from "./PolicySuccessDialog";
import {
  WizardStepper,
  ResetWarningDialog,
  usePolicyWizardState,
  Step1BranchTypeClient,
  Step2Car,
  Step3PolicyDetails,
  Step4Payments,
} from "./wizard";
import type { Database } from "@/integrations/supabase/types";

type PolicyTypeParent = Database["public"]["Enums"]["policy_type_parent"];
type PolicyTypeChild = Database["public"]["Enums"]["policy_type_child"];
type CarType = Database["public"]["Enums"]["car_type"];
type PaymentType = Database["public"]["Enums"]["payment_type"];

import type { RenewalData } from "./wizard/types";

interface PolicyWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (policyId: string) => void;
  onSaved?: () => void;
  defaultBrokerId?: string;
  defaultBrokerDirection?: 'from_broker' | 'to_broker';
  preselectedClientId?: string;
  isCollapsed?: boolean;
  // New multi-instance host wiring: the host tells the wizard to minimize
  // (flight origin included) and receives draft summary updates so it can
  // store them on the instance record for the tab strip.
  instanceId?: string;
  onMinimize?: (origin?: { x: number; y: number }) => void;
  onDraftSummaryChange?: (summary: WizardDraftSummary | null) => void;
  renewalData?: RenewalData | null;
}

export function PolicyWizard({
  open,
  onOpenChange,
  onComplete,
  onSaved,
  defaultBrokerId,
  defaultBrokerDirection,
  preselectedClientId,
  isCollapsed = false,
  instanceId,
  onMinimize,
  onDraftSummaryChange,
  renewalData,
}: PolicyWizardProps) {
  const { toast } = useToast();
  const navigate = useNavigate();

  // Use the centralized wizard state hook. In the multi-instance model
  // this wizard stays mounted while it is minimized, so we always pass
  // open=true to the hook — its `!open` branches are resets that should
  // only fire on real close, and component unmount is the real close
  // signal now. instanceId activates per-instance draft persistence.
  const wizardState = usePolicyWizardState({
    defaultBrokerId,
    defaultBrokerDirection,
    preselectedClientId,
    open: true,
    instanceId,
    renewalData: renewalData || undefined,
  });

  const {
    currentStep,
    setCurrentStep,
    saving,
    setSaving,
    errors,
    setErrors,
    selectedBranchId,
    setSelectedBranchId,
    categories,
    setCategories,
    selectedCategory,
    setSelectedCategory,
    selectedClient,
    setSelectedClient,
    clientSearch,
    setClientSearch,
    clients,
    setClients,
    loadingClients,
    setLoadingClients,
    createNewClient,
    setCreateNewClient,
    newClient,
    setNewClient,
    checkingDuplicate,
    setCheckingDuplicate,
    selectedCar,
    setSelectedCar,
    clientCars,
    setClientCars,
    loadingCars,
    setLoadingCars,
    createNewCar,
    setCreateNewCar,
    newCar,
    setNewCar,
    fetchingCarData,
    setFetchingCarData,
    carDataFetched,
    setCarDataFetched,
    existingCar,
    setExistingCar,
    carConflict,
    setCarConflict,
    policy,
    setPolicy,
    companies,
    setCompanies,
    loadingCompanies,
    setLoadingCompanies,
    policyBrokerId,
    setPolicyBrokerId,
    brokerDirection,
    setBrokerDirection,
    brokers,
    setBrokers,
    roadServices,
    setRoadServices,
    accidentFeeServices,
    setAccidentFeeServices,
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
    payments,
    setPayments,
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
    steps,
    currentStepData,
    missingFields,
    effectiveBranchId,
    isLightMode,
    pricing,
    totalPaidPayments,
    remainingToPay,
    paymentsExceedPrice,
    resetCarData,
    resetPolicyData,
    resetPayments,
    resetChildren,
    resetForm,
    validateStep,
    goToStep,
    clearDraft,
    user,
    isAdmin,
    userBranchId,
    branches,
    refetchBranches,
  } = wizardState;

  // Reset warning dialog state
  const [resetWarning, setResetWarning] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ open: false, title: '', description: '', onConfirm: () => {} });

  // Tranzila state
  const [tranzilaEnabled, setTranzilaEnabled] = useState(false);
  const [tranzilaModalOpen, setTranzilaModalOpen] = useState(false);
  const [activeTranzilaPaymentId, setActiveTranzilaPaymentId] = useState<string | null>(null);
  const [tempPolicyId, setTempPolicyId] = useState<string | null>(null);
  
  // Close-confirmation dialog state. Shown when the user tries to dismiss
  // the wizard while it holds any unsaved draft data.
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  // Programmatic closes (e.g. after a successful save) skip the dirty check.
  const skipCloseConfirmRef = useRef(false);

  // Keep the draft-summary callback in a ref so the effect below doesn't
  // re-run every time the host renders a new inline function. Without this
  // indirection the effect's deps change on every host render, it calls
  // setInstanceDraft which re-renders the host which creates a new inline
  // function which changes the deps again → infinite loop → React crashes
  // the subtree and the app goes blank.
  const onDraftSummaryChangeRef = useRef(onDraftSummaryChange);
  useEffect(() => {
    onDraftSummaryChangeRef.current = onDraftSummaryChange;
  });

  // Push a compact draft summary up to the host so the tab strip can show
  // what this wizard is working on. The host stores it per-instance, so we
  // only report updates while the wizard is the active one — that way the
  // last-known summary stays frozen on the tab while the user is busy in
  // another minimized wizard.
  useEffect(() => {
    if (!open || isCollapsed) return;
    const clientName =
      selectedClient?.full_name
      || (createNewClient && newClient.full_name)
      || "";
    const stepTitle = steps.find((s) => s.id === currentStep)?.title || "";
    onDraftSummaryChangeRef.current?.({
      clientName,
      stepTitle,
      stepNumber: currentStep,
      totalSteps: steps.length,
      categoryName: selectedCategory?.name_ar || selectedCategory?.name || null,
    });
  }, [
    open,
    isCollapsed,
    selectedClient,
    createNewClient,
    newClient.full_name,
    currentStep,
    steps,
    selectedCategory,
  ]);

  // Success dialog state
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [successPolicyData, setSuccessPolicyData] = useState<{
    policyId: string;
    clientId: string;
    clientPhone: string | null;
    isPackage: boolean;
  } | null>(null);

  // Fetch categories (stable ref so the quick-add dialog can refresh in place)
  const fetchCategories = useCallback(async () => {
    const { data } = await supabase
      .from('insurance_categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (data) {
      const typedCategories = data.map(c => ({
        ...c,
        mode: c.mode as 'FULL' | 'LIGHT',
      }));
      setCategories(typedCategories);
    }
  }, [setCategories]);

  // Fetch categories and brokers on open
  useEffect(() => {
    if (!open) return;

    const fetchBrokers = async () => {
      const { data } = await supabase
        .from('brokers')
        .select('id, name')
        .order('name');
      if (data) setBrokers(data);
    };

    fetchCategories();
    fetchBrokers();
    checkTranzilaEnabled();
  }, [open, fetchCategories, setBrokers]);

  // Auto-select the default category once categories load (only if none selected yet)
  useEffect(() => {
    if (!open || selectedCategory || categories.length === 0) return;
    const defaultCat = categories.find(c => c.is_default);
    if (defaultCat) setSelectedCategory(defaultCat);
  }, [open, categories, selectedCategory, setSelectedCategory]);

  // Check if Tranzila is enabled
  const checkTranzilaEnabled = useCallback(async () => {
    const { data } = await supabase
      .from('payment_settings')
      .select('is_enabled')
      .eq('provider', 'tranzila')
      .single();
    setTranzilaEnabled(data?.is_enabled || false);
  }, []);

  // Shared function to handle ELZAMI payment logic when entering Step 4
  const applyElzamiPaymentLogic = () => {
    const isMainElzami = policy.policy_type_parent === 'ELZAMI';
    const elzamiAddon = packageAddons.find(a => a.type === 'elzami' && a.enabled);
    const isAddonElzami = packageMode && elzamiAddon?.enabled;
    const hasLockedElzamiPayment = payments.some(p => p.locked && p.source === 'system');
    
    if (isMainElzami || isAddonElzami) {
      // Calculate ELZAMI price:
      // - Main ELZAMI: use policy.insurance_price
      // - Addon ELZAMI: use elzamiAddon.insurance_price
      const elzamiPrice = isMainElzami 
        ? parseFloat(policy.insurance_price) || pricing.totalPrice
        : parseFloat(elzamiAddon?.insurance_price || '0');
      
      if (elzamiPrice > 0) {
        // Use ELZAMI start_date if available, else policy start_date or today
        const elzamiDate = isAddonElzami && elzamiAddon?.start_date
          ? elzamiAddon.start_date
          : policy.start_date || new Date().toISOString().split('T')[0];
        
        if (!hasLockedElzamiPayment) {
          // Add new locked payment. ELZAMI is paid by the customer directly
          // on the insurance company's portal (using their card); the money
          // never passes through the agency's till, so we store it as 'visa'
          // and render it as "فيزا خارجي" in every payments surface.
          setPayments([{
            id: crypto.randomUUID(),
            payment_type: 'visa',
            amount: elzamiPrice,
            payment_date: elzamiDate,
            refused: false,
            locked: true,
            source: 'system',
            locked_label: 'دفعة إلزامي – تلقائية',
          }]);
        } else {
          // Update existing locked payment if price changed
          const lockedPayment = payments.find(p => p.locked && p.source === 'system');
          if (lockedPayment && lockedPayment.amount !== elzamiPrice) {
            setPayments(payments.map(p => 
              p.locked && p.source === 'system' 
                ? { ...p, amount: elzamiPrice, payment_date: elzamiDate }
                : p
            ));
          }
        }
      }
    } else if (hasLockedElzamiPayment) {
      // ELZAMI was disabled - remove the locked payment
      setPayments(payments.filter(p => !(p.locked && p.source === 'system')));
    }
  };

  // Handle step navigation with reset warnings
  const handleStepClick = (stepId: number) => {
    if (stepId === currentStep) return;
    
    const step = steps.find(s => s.id === stepId);
    if (!step?.isUnlocked) return;

    if (stepId < currentStep) {
      goToStep(stepId);
    } else {
      if (validateStep(currentStep)) {
        // Apply ELZAMI payment logic when navigating to Step 4
        if (stepId === 4) {
          applyElzamiPaymentLogic();
        }
        goToStep(stepId);
      }
    }
  };

  // Handle category change with reset warning
  const handleCategoryChange = (category: typeof selectedCategory) => {
    if (!category) return;
    
    if (selectedCategory && category.id !== selectedCategory.id) {
      if (selectedCar || policy.company_id || payments.length > 0) {
        setResetWarning({
          open: true,
          title: 'تغيير نوع التأمين',
          description: 'سيؤدي تغيير نوع التأمين إلى إعادة تعيين بيانات السيارة والوثيقة والدفعات. هل تريد المتابعة؟',
          onConfirm: () => {
            setSelectedCategory(category);
            resetCarData();
            resetPolicyData();
            resetPayments();
            setResetWarning({ open: false, title: '', description: '', onConfirm: () => {} });
          },
        });
        return;
      }
    }
    setSelectedCategory(category);
  };

  // Handle branch change (admin only)
  const handleBranchChange = (branchId: string) => {
    if (selectedBranchId && branchId !== selectedBranchId) {
      setResetWarning({
        open: true,
        title: 'تغيير الفرع',
        description: 'سيؤدي تغيير الفرع إلى إعادة تعيين جميع البيانات. هل تريد المتابعة؟',
        onConfirm: () => {
          setSelectedBranchId(branchId);
          resetForm();
          setResetWarning({ open: false, title: '', description: '', onConfirm: () => {} });
        },
      });
      return;
    }
    setSelectedBranchId(branchId);
  };

  // Navigation
  const canGoNext = currentStepData?.isValid;
  const canGoPrev = currentStep > 1;

  const handleNext = () => {
    if (!validateStep(currentStep)) return;
    const nextStep = Math.min(currentStep + 1, steps.length);
    
    // Apply ELZAMI payment logic when entering Step 4
    if (nextStep === 4) {
      applyElzamiPaymentLogic();
    }
    
    goToStep(nextStep);
  };

  const handlePrev = () => {
    if (currentStep > 1) {
      goToStep(currentStep - 1);
    }
  };

  // Upload files to Bunny CDN - PARALLEL for speed
  const uploadFiles = async (policyId: string): Promise<void> => {
    const allFiles = [...insuranceFiles, ...crmFiles];
    if (allFiles.length === 0) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    // Upload all files in parallel for speed
    const uploadPromises = allFiles.map(async (file) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entity_type', insuranceFiles.includes(file) ? 'policy_insurance' : 'policy_crm');
      formData.append('entity_id', policyId);
      if (effectiveBranchId) {
        formData.append('branch_id', effectiveBranchId);
      }

      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-media`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: formData,
          }
        );

        if (!response.ok) {
          console.error('File upload error for:', file.name);
        }
      } catch (error) {
        console.error('File upload failed for:', file.name, error);
      }
    });

    await Promise.all(uploadPromises);
  };

  // Create a temporary policy for Tranzila payment (returns UUID)
  const handleCreateTempPolicy = useCallback(async (): Promise<string | null> => {
    try {
      // Validate first
      for (let i = 1; i <= steps.length - 1; i++) {
        if (!validateStep(i)) {
          goToStep(i);
          toast({
            title: "خطأ في البيانات",
            description: "يرجى التحقق من جميع الحقول المطلوبة",
            variant: "destructive",
          });
          return null;
        }
      }

      let clientId = selectedClient?.id;
      let carId = selectedCar?.id;

      // Create new client if needed
      if (createNewClient && !clientId) {
        // Generate file_number
        const { data: fileNumData } = await supabase.rpc('generate_file_number');
        const generatedFileNumber = fileNumData || null;

        const { data: newClientData, error: clientError } = await supabase
          .from('clients')
          .insert({
            full_name: newClient.full_name.trim(),
            id_number: newClient.id_number.trim(),
            file_number: generatedFileNumber,
            phone_number: newClient.phone_number || null,
            phone_number_2: newClient.phone_number_2 || null,
            birth_date: newClient.birth_date || null,
            under24_type: newClient.under24_type || 'none',
            under24_driver_name: newClient.under24_driver_name || null,
            under24_driver_id: newClient.under24_driver_id || null,
            notes: newClient.notes || null,
            branch_id: effectiveBranchId || null,
            created_by_admin_id: user?.id || null,
          })
          .select()
          .single();

        if (clientError) {
          // If duplicate id_number, fetch the existing client instead
          if (clientError.code === '23505' && clientError.message?.includes('id_number')) {
            const { data: existingClient } = await supabase
              .from('clients')
              .select('id')
              .eq('id_number', newClient.id_number.trim())
              .is('deleted_at', null)
              .single();
            if (existingClient) {
              clientId = existingClient.id;
            } else {
              throw clientError;
            }
          } else {
            throw clientError;
          }
        } else {
          clientId = newClientData.id;
        }
      }

      if (!clientId) throw new Error('Client ID is required');

      // Create new car if needed
      if (!isLightMode && createNewCar && !carId) {
        const carType = (newCar.car_type || 'car') as CarType;
        
        const { data: newCarData, error: carError } = await supabase
          .from('cars')
          .insert({
            car_number: newCar.car_number.trim(),
            manufacturer_name: newCar.manufacturer_name || null,
            model: newCar.model || null,
            year: newCar.year ? parseInt(newCar.year) : null,
            color: newCar.color || null,
            car_type: carType,
            car_value: newCar.car_value ? parseFloat(newCar.car_value) : null,
            license_expiry: newCar.license_expiry || null,
            client_id: clientId,
            branch_id: effectiveBranchId || null,
            created_by_admin_id: user?.id || null,
          })
          .select()
          .single();

        if (carError) throw carError;
        carId = newCarData.id;
      }

      // Calculate profit
      const isUnder24 = selectedClient?.under24_type === 'client' || 
                        selectedClient?.under24_type === 'additional_driver' ||
                        newClient.under24_type === 'client' ||
                        newClient.under24_type === 'additional_driver';

      // Temp policy for Visa = First enabled addon in package mode, OR main policy
      // This is because the Visa payment processes the first component
      let policyTypeParentValue = (selectedCategory?.slug || policy.policy_type_parent) as PolicyTypeParent;
      let policyTypeChildValue = (policy.policy_type_child || null) as PolicyTypeChild | null;
      let tempCompanyId = policy.company_id;
      let tempInsurancePrice = pricing.totalPrice || parseFloat(policy.insurance_price) || 0;

      // For packages with Visa: use the FIRST enabled addon for temp policy type/company
      // BUT keep tempInsurancePrice as pricing.totalPrice (full package price) to pass validation
      // The correct individual price will be set in handleSave after group_id is created
      if (packageMode && packageAddons.some(a => a.enabled)) {
        // Priority: elzami > third_full > road_service > accident_fee
        const elzamiAddon = packageAddons.find(a => a.type === 'elzami' && a.enabled);
        const thirdAddon = packageAddons.find(a => a.type === 'third_full' && a.enabled);
        const roadAddon = packageAddons.find(a => a.type === 'road_service' && a.enabled);
        const accidentAddon = packageAddons.find(a => a.type === 'accident_fee_exemption' && a.enabled);
        
        const firstAddon = elzamiAddon || thirdAddon || roadAddon || accidentAddon;
        
        if (firstAddon) {
          const addonTypeMap: Record<string, PolicyTypeParent> = {
            'elzami': 'ELZAMI',
            'third_full': 'THIRD_FULL',
            'road_service': 'ROAD_SERVICE',
            'accident_fee_exemption': 'ACCIDENT_FEE_EXEMPTION',
          };
          policyTypeParentValue = addonTypeMap[firstAddon.type] as PolicyTypeParent;
          policyTypeChildValue = firstAddon.type === 'third_full' && firstAddon.policy_type_child 
            ? firstAddon.policy_type_child as PolicyTypeChild 
            : null;
          tempCompanyId = firstAddon.company_id || policy.company_id;
          // DO NOT override tempInsurancePrice here - keep pricing.totalPrice
          // This allows all package payments (including locked ELZAMI) to pass validation
          // The correct component price will be set in handleSave after package is created
        }
      }
      
      const carTypeValue = (selectedCar?.car_type || newCar.car_type || 'car') as CarType;
      const ageBandValue = isUnder24 ? 'UNDER_24' as const : 'UP_24' as const;

      const profitData = await calculatePolicyProfit({
        policyTypeParent: policyTypeParentValue,
        policyTypeChild: policyTypeChildValue,
        companyId: tempCompanyId,
        carType: carTypeValue,
        ageBand: ageBandValue,
        carValue: policy.full_car_value ? parseFloat(policy.full_car_value) : (selectedCar?.car_value || (newCar.car_value ? parseFloat(newCar.car_value) : null)),
        carYear: selectedCar?.year || (newCar.year ? parseInt(newCar.year) : null),
        insurancePrice: tempInsurancePrice,
        roadServiceId: policy.road_service_id || null,
        accidentFeeServiceId: policy.accident_fee_service_id || null,
      });

      const policyTypeParent = policyTypeParentValue;
      const policyTypeChild = policyTypeChildValue;
      const brokerDir = brokerDirection ? brokerDirection as "from_broker" | "to_broker" : null;

      // Create policy
      const { data: newPolicy, error: policyError } = await supabase
        .from('policies')
        .insert({
          client_id: clientId,
          car_id: carId || null,
          category_id: selectedCategory?.id || null,
          policy_type_parent: policyTypeParent,
          policy_type_child: policyTypeChild,
          company_id: tempCompanyId || null,
          start_date: policy.start_date,
          end_date: policy.end_date,
          insurance_price: tempInsurancePrice,
          profit: profitData.profit,
          payed_for_company: profitData.companyPayment,
          company_cost_snapshot: profitData.companyPayment,
          is_under_24: isUnder24,
          broker_id: policyBrokerId || null,
          broker_direction: brokerDir,
          road_service_id: policy.road_service_id || null,
          accident_fee_service_id: policy.accident_fee_service_id || null,
          notes: policy.notes || null,
          branch_id: effectiveBranchId || null,
          created_by_admin_id: user?.id || null,
        })
        .select()
        .single();

      if (policyError) throw policyError;

      setTempPolicyId(newPolicy.id);
      return newPolicy.id;
    } catch (error) {
      console.error('Error creating temp policy:', error);
      toast({
        title: "خطأ",
        description: "فشل في إنشاء الوثيقة المؤقتة",
        variant: "destructive",
      });
      return null;
    }
  }, [
    steps, validateStep, goToStep, toast, selectedClient, selectedCar, createNewClient,
    newClient, effectiveBranchId, user, isLightMode, createNewCar, newCar, selectedCategory,
    policy, pricing, policyBrokerId, brokerDirection, packageMode, packageAddons,
  ]);

  // Delete temporary policy on payment failure
  const handleDeleteTempPolicy = useCallback(async (policyId: string): Promise<void> => {
    try {
      // Soft delete the policy
      await supabase
        .from('policies')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', policyId);
      
      setTempPolicyId(null);
    } catch (error) {
      console.error('Error deleting temp policy:', error);
    }
  }, []);

  // Save policy
  const handleSave = async () => {
    for (let i = 1; i <= steps.length; i++) {
      if (!validateStep(i)) {
        goToStep(i);
        toast({
          title: "خطأ في البيانات",
          description: "يرجى التحقق من جميع الحقول المطلوبة",
          variant: "destructive",
        });
        return;
      }
    }

    if (paymentsExceedPrice) {
      toast({
        title: "خطأ في الدفعات",
        description: "مجموع الدفعات يتجاوز سعر التأمين",
        variant: "destructive",
      });
      return;
    }

    // Check for unpaid visa payments
    const hasUnpaidVisa = payments.some(p => p.payment_type === 'visa' && !p.tranzila_paid && (p.amount || 0) > 0);
    if (hasUnpaidVisa) {
      toast({
        title: "دفعات فيزا غير مكتملة",
        description: "يجب الدفع بالفيزا قبل حفظ الوثيقة",
        variant: "destructive",
      });
      return;
    }

    // If tempPolicyId exists (policy was created for Tranzila), use it instead of creating new
    const useTempPolicy = !!tempPolicyId;

    setSaving(true);

    try {
      let policyIdToUse = tempPolicyId;
      let newlyCreatedClientId: string | null = null; // Track if we created a new client

      if (!useTempPolicy) {
        // Create new policy (normal flow without Tranzila)
        let clientId = selectedClient?.id;
        let carId = selectedCar?.id;
        
        if (createNewClient && !clientId) {
          // Generate file_number for new client
          const { data: fileNumData } = await supabase.rpc('generate_file_number');
          const generatedFileNumber = fileNumData || null;

          const { data: newClientData, error: clientError } = await supabase
            .from('clients')
            .insert({
              full_name: newClient.full_name.trim(),
              id_number: newClient.id_number.trim(),
              file_number: generatedFileNumber,
              phone_number: newClient.phone_number || null,
              phone_number_2: newClient.phone_number_2 || null,
              birth_date: newClient.birth_date || null,
              under24_type: newClient.under24_type || 'none',
              under24_driver_name: newClient.under24_driver_name || null,
              under24_driver_id: newClient.under24_driver_id || null,
              notes: newClient.notes || null,
              branch_id: effectiveBranchId || null,
              created_by_admin_id: user?.id || null,
            })
            .select()
            .single();

          if (clientError) {
            if (clientError.code === '23505' && clientError.message?.includes('id_number')) {
              const { data: existingClient } = await supabase
                .from('clients')
                .select('id')
                .eq('id_number', newClient.id_number.trim())
                .is('deleted_at', null)
                .single();
              if (existingClient) {
                clientId = existingClient.id;
              } else {
                throw clientError;
              }
            } else {
              throw clientError;
            }
          } else {
            clientId = newClientData.id;
            newlyCreatedClientId = newClientData.id;
          }
        }

        if (!clientId) throw new Error('Client ID is required');

        // Create new car if needed (for FULL mode)
        if (!isLightMode && createNewCar && !carId) {
          const carType = (newCar.car_type || 'car') as CarType;
          
          const { data: newCarData, error: carError } = await supabase
            .from('cars')
            .insert({
              car_number: newCar.car_number.trim(),
              manufacturer_name: newCar.manufacturer_name || null,
              model: newCar.model || null,
              year: newCar.year ? parseInt(newCar.year) : null,
              color: newCar.color || null,
              car_type: carType,
              car_value: newCar.car_value ? parseFloat(newCar.car_value) : null,
              license_expiry: newCar.license_expiry || null,
              client_id: clientId,
              branch_id: effectiveBranchId || null,
              created_by_admin_id: user?.id || null,
            })
            .select()
            .single();

          if (carError) throw carError;
          carId = newCarData.id;
        }

        // Calculate profit based on category
        const isUnder24 = selectedClient?.under24_type === 'client' || 
                          selectedClient?.under24_type === 'additional_driver' ||
                          newClient.under24_type === 'client' ||
                          newClient.under24_type === 'additional_driver';

        const policyTypeParentValue = policy.policy_type_parent as PolicyTypeParent;
        const policyTypeChildValue = (policy.policy_type_child || null) as PolicyTypeChild | null;
        const carTypeValue = (selectedCar?.car_type || newCar.car_type || 'car') as CarType;
        const ageBandValue = isUnder24 ? 'UNDER_24' as const : 'UP_24' as const;

        // Check if company is linked to a broker and broker_buy_price is provided
        const selectedCompany = companies.find(c => c.id === policy.company_id);
        const isCompanyLinkedToBroker = !!selectedCompany?.broker_id;
        const brokerBuyPriceValue = isCompanyLinkedToBroker && policy.broker_buy_price 
          ? parseFloat(policy.broker_buy_price) 
          : null;

        const profitData = await calculatePolicyProfit({
          policyTypeParent: policyTypeParentValue,
          policyTypeChild: policyTypeChildValue,
          companyId: policy.company_id,
          carType: carTypeValue,
          ageBand: ageBandValue,
          carValue: policy.full_car_value ? parseFloat(policy.full_car_value) : (selectedCar?.car_value || (newCar.car_value ? parseFloat(newCar.car_value) : null)),
          carYear: selectedCar?.year || (newCar.year ? parseInt(newCar.year) : null),
          insurancePrice: parseFloat(policy.insurance_price) || pricing.totalPrice,
          brokerBuyPrice: brokerBuyPriceValue,
          roadServiceId: policy.road_service_id || null,
          accidentFeeServiceId: policy.accident_fee_service_id || null,
        });

        // Create policy
        const policyTypeParent = policy.policy_type_parent as PolicyTypeParent;
        const policyTypeChild = policy.policy_type_child ? policy.policy_type_child as PolicyTypeChild : null;
        const brokerDir = brokerDirection || null;

        let groupId: string | null = null;

        // Create policy group if package mode is enabled and ANY addon is enabled
        if (packageMode && packageAddons.some(addon => addon.enabled)) {
          const { data: groupData, error: groupError } = await supabase
            .from('policy_groups')
            .insert({
              client_id: clientId,
              car_id: carId || null,
              name: `باقة - ${new Date().toLocaleDateString('en-GB')}`,
            })
            .select()
            .single();

          if (groupError) throw groupError;
          groupId = groupData.id;
        }

        const { data: newPolicy, error: policyError } = await supabase
          .from('policies')
          .insert({
            client_id: clientId,
            car_id: carId || null,
            category_id: selectedCategory?.id || null,
            policy_type_parent: policyTypeParent,
            policy_type_child: policyTypeChild,
            company_id: policy.company_id || null,
            start_date: policy.start_date,
            end_date: policy.end_date,
            issue_date: policy.issue_date || policy.start_date,
            insurance_price: parseFloat(policy.insurance_price) || pricing.totalPrice,
            profit: profitData.profit,
            payed_for_company: profitData.companyPayment,
            company_cost_snapshot: profitData.companyPayment,
            broker_buy_price: brokerBuyPriceValue || 0,
            office_commission: parseFloat(policy.office_commission) || 0,
            is_under_24: isUnder24,
            broker_id: policyBrokerId || null,
            broker_direction: brokerDir,
            road_service_id: policy.road_service_id || null,
            accident_fee_service_id: policy.accident_fee_service_id || null,
            notes: policy.notes || null,
            branch_id: effectiveBranchId || null,
            created_by_admin_id: user?.id || null,
            group_id: groupId,
          })
          .select()
          .single();

        if (policyError) throw policyError;
        policyIdToUse = newPolicy.id;

        // Create add-on policies if in package mode
        // Track package info for X-Service sync (hoisted so both paths can use them)
        var _pkgFirstAddonType: string | null = null;
        var _pkgMainAddonId: string | null = null;
        var _tempConvertedToAddon = false; // Only true in Visa path where temp policy IS the first addon
        if (packageMode && groupId) {
          for (const addon of packageAddons) {
            if (!addon.enabled) continue;

            // Map addon type to proper policy_type_parent
            const addonTypeMap: Record<string, PolicyTypeParent> = {
              'elzami': 'ELZAMI',
              'third_full': 'THIRD_FULL',
              'road_service': 'ROAD_SERVICE',
              'accident_fee_exemption': 'ACCIDENT_FEE_EXEMPTION',
            };
            const addonTypeParent = addonTypeMap[addon.type] as PolicyTypeParent;
            const addonInsurancePrice = parseFloat(addon.insurance_price) || 0;
            
            // Get policy_type_child for THIRD_FULL addons
            const addonTypeChild = addon.type === 'third_full' && addon.policy_type_child 
              ? addon.policy_type_child as PolicyTypeChild 
              : null;
            
            // Calculate profit for addon policies
            const addonProfitData = await calculatePolicyProfit({
              policyTypeParent: addonTypeParent,
              policyTypeChild: addonTypeChild,
              companyId: addon.company_id || '',
              carType: (selectedCar?.car_type || newCar.car_type || 'car') as CarType,
              ageBand: isUnder24 ? 'UNDER_24' as const : 'UP_24' as const,
              carValue: policy.full_car_value ? parseFloat(policy.full_car_value) : (selectedCar?.car_value || (newCar.car_value ? parseFloat(newCar.car_value) : null)),
              carYear: selectedCar?.year || (newCar.year ? parseInt(newCar.year) : null),
              insurancePrice: addonInsurancePrice,
              roadServiceId: addon.road_service_id || null,
              accidentFeeServiceId: addon.accident_fee_service_id || null,
            });

            const { data: addonData, error: addonError } = await supabase.from('policies').insert({
              client_id: clientId,
              car_id: carId || null,
              category_id: null,
              policy_type_parent: addonTypeParent,
              policy_type_child: addonTypeChild,
              company_id: addon.company_id || null,
              start_date: policy.start_date,
              end_date: policy.end_date,
              issue_date: policy.issue_date || policy.start_date,
              insurance_price: addonInsurancePrice,
              profit: addonProfitData.profit,
              payed_for_company: addonProfitData.companyPayment,
              company_cost_snapshot: addonProfitData.companyPayment,
              road_service_id: addon.road_service_id || null,
              accident_fee_service_id: addon.accident_fee_service_id || null,
              office_commission: addon.type === 'elzami' ? parseFloat(addon.office_commission || '0') || 0 : 0,
              group_id: groupId,
              notes: 'إضافة ضمن باقة',
              branch_id: effectiveBranchId || null,
              created_by_admin_id: user?.id || null,
            }).select('id').single();

            if (addonError) throw addonError;
            (addon as any)._savedPolicyId = addonData?.id || null;

            // Track first addon type for X-Service sync
            if (!_pkgFirstAddonType) {
              _pkgFirstAddonType = addon.type;
            }
          }
        }
      } else {
        // ✅ PACKAGE HANDLING FOR VISA PAYMENTS (tempPolicyId exists)
        // When user paid with Visa, temp policy was created WITHOUT group_id
        // We need to create the package group and addon policies now
        // _pkgFirstAddonType and _pkgMainAddonId are hoisted above (non-Visa path)
        if (packageMode && packageAddons.some(addon => addon.enabled)) {
          // 1. Fetch temp policy data to get client_id, car_id, and other details
          const { data: tempPolicy, error: tempPolicyError } = await supabase
            .from('policies')
            .select('client_id, car_id, start_date, end_date, is_under_24')
            .eq('id', tempPolicyId)
            .single();
          
          if (tempPolicyError || !tempPolicy) {
            throw new Error('لم يتم العثور على الوثيقة المؤقتة');
          }

          const tempClientId = tempPolicy.client_id;
          const tempCarId = tempPolicy.car_id;
          const tempStartDate = tempPolicy.start_date;
          const tempEndDate = tempPolicy.end_date;
          const tempIsUnder24 = tempPolicy.is_under_24;

          // 2. Create policy group
          const { data: groupData, error: groupError } = await supabase
            .from('policy_groups')
            .insert({
              client_id: tempClientId,
              car_id: tempCarId || null,
              name: `باقة - ${new Date().toLocaleDateString('en-GB')}`,
            })
            .select()
            .single();

          if (groupError) throw groupError;
          const groupId = groupData.id;

          // 3. Get car data for profit calculation
          let carTypeForCalc: CarType = 'car';
          let carValueForCalc: number | null = null;
          let carYearForCalc: number | null = null;

          if (tempCarId) {
            const { data: carData } = await supabase
              .from('cars')
              .select('car_type, car_value, year')
              .eq('id', tempCarId)
              .single();
            
            if (carData) {
              carTypeForCalc = (carData.car_type || 'car') as CarType;
              carValueForCalc = carData.car_value;
              carYearForCalc = carData.year;
            }
          }

          // 4. Identify which addon was used for the temp policy FIRST (needed for correct pricing)
          const elzamiAddon = packageAddons.find(a => a.type === 'elzami' && a.enabled);
          const thirdAddon = packageAddons.find(a => a.type === 'third_full' && a.enabled);
          const roadAddon = packageAddons.find(a => a.type === 'road_service' && a.enabled);
          const accidentAddon = packageAddons.find(a => a.type === 'accident_fee_exemption' && a.enabled);
          const firstAddon = elzamiAddon || thirdAddon || roadAddon || accidentAddon;
          const firstAddonType = firstAddon?.type || null;
          _pkgFirstAddonType = firstAddonType;

          // 5. Calculate main policy profit (for creating the main policy later)
          const mainInsurancePrice = parseFloat(policy.insurance_price) || 0;
          const selectedCompany = companies.find(c => c.id === policy.company_id);
          const isCompanyLinkedToBroker = !!selectedCompany?.broker_id;
          const brokerBuyPriceValue = isCompanyLinkedToBroker && policy.broker_buy_price 
            ? parseFloat(policy.broker_buy_price) 
            : null;

          const mainProfitData = await calculatePolicyProfit({
            policyTypeParent: policy.policy_type_parent as PolicyTypeParent,
            policyTypeChild: (policy.policy_type_child || null) as PolicyTypeChild | null,
            companyId: policy.company_id,
            carType: carTypeForCalc,
            ageBand: tempIsUnder24 ? 'UNDER_24' as const : 'UP_24' as const,
            carValue: policy.full_car_value ? parseFloat(policy.full_car_value) : carValueForCalc,
            carYear: carYearForCalc,
            insurancePrice: mainInsurancePrice,
            brokerBuyPrice: brokerBuyPriceValue,
            roadServiceId: policy.road_service_id || null,
            accidentFeeServiceId: policy.accident_fee_service_id || null,
          });

          // 6. Update temp policy with the FIRST ADDON's price (not the main policy price!)
          // The temp policy was created as the first enabled addon type, so it must use that addon's data
          const addonTypeMapForTemp: Record<string, PolicyTypeParent> = {
            'elzami': 'ELZAMI',
            'third_full': 'THIRD_FULL',
            'road_service': 'ROAD_SERVICE',
            'accident_fee_exemption': 'ACCIDENT_FEE_EXEMPTION',
          };
          const tempPolicyTypeParent = firstAddon ? addonTypeMapForTemp[firstAddon.type] : policy.policy_type_parent as PolicyTypeParent;
          const tempPolicyTypeChild = firstAddon?.type === 'third_full' && (firstAddon as any).policy_type_child
            ? (firstAddon as any).policy_type_child as PolicyTypeChild
            : null;
          const firstAddonPrice = firstAddon ? parseFloat(firstAddon.insurance_price) || 0 : mainInsurancePrice;
          const firstAddonCompanyId = firstAddon?.company_id || policy.company_id;
          const firstAddonBrokerBuyPrice = firstAddon?.type === 'third_full' && (firstAddon as any).broker_buy_price
            ? parseFloat((firstAddon as any).broker_buy_price)
            : null;

          const tempProfitData = await calculatePolicyProfit({
            policyTypeParent: tempPolicyTypeParent,
            policyTypeChild: tempPolicyTypeChild,
            companyId: firstAddonCompanyId,
            carType: carTypeForCalc,
            ageBand: tempIsUnder24 ? 'UNDER_24' as const : 'UP_24' as const,
            carValue: policy.full_car_value ? parseFloat(policy.full_car_value) : carValueForCalc,
            carYear: carYearForCalc,
            insurancePrice: firstAddonPrice,
            brokerBuyPrice: firstAddonBrokerBuyPrice,
            roadServiceId: firstAddon?.road_service_id || null,
            accidentFeeServiceId: firstAddon?.accident_fee_service_id || null,
          });

          const tempOfficeCommission = firstAddon?.type === 'elzami' 
            ? parseFloat(firstAddon.office_commission || '0') || 0 
            : 0;

          const { error: updateError } = await supabase
            .from('policies')
            .update({ 
              group_id: groupId,
              policy_type_parent: tempPolicyTypeParent,
              policy_type_child: tempPolicyTypeChild,
              company_id: firstAddonCompanyId,
              insurance_price: firstAddonPrice,
              profit: tempProfitData.profit,
              payed_for_company: tempProfitData.companyPayment,
              company_cost_snapshot: tempProfitData.companyPayment,
              broker_buy_price: firstAddonBrokerBuyPrice || 0,
              road_service_id: firstAddon?.road_service_id || null,
              accident_fee_service_id: firstAddon?.accident_fee_service_id || null,
              office_commission: tempOfficeCommission,
            })
            .eq('id', tempPolicyId);

          if (updateError) throw updateError;
          _tempConvertedToAddon = true; // Mark that temp policy was converted to first addon

          // 7. Create addon policies (skip the first one since it's already the temp policy)
          for (const addon of packageAddons) {
            if (!addon.enabled) continue;
            
            // Skip the addon that was used for temp policy
            if (addon.type === firstAddonType) continue;

            const addonTypeMap: Record<string, PolicyTypeParent> = {
              'elzami': 'ELZAMI',
              'third_full': 'THIRD_FULL',
              'road_service': 'ROAD_SERVICE',
              'accident_fee_exemption': 'ACCIDENT_FEE_EXEMPTION',
            };
            const addonTypeParent = addonTypeMap[addon.type] as PolicyTypeParent;
            const addonInsurancePrice = parseFloat(addon.insurance_price) || 0;
            
            // Get policy_type_child for THIRD_FULL addons
            const addonTypeChild = addon.type === 'third_full' && addon.policy_type_child 
              ? addon.policy_type_child as PolicyTypeChild 
              : null;

            // Calculate profit for addon
            const addonProfitData = await calculatePolicyProfit({
              policyTypeParent: addonTypeParent,
              policyTypeChild: addonTypeChild,
              companyId: addon.company_id || '',
              carType: carTypeForCalc,
              ageBand: tempIsUnder24 ? 'UNDER_24' as const : 'UP_24' as const,
              carValue: policy.full_car_value ? parseFloat(policy.full_car_value) : carValueForCalc,
              carYear: carYearForCalc,
              insurancePrice: addonInsurancePrice,
              roadServiceId: addon.road_service_id || null,
              accidentFeeServiceId: addon.accident_fee_service_id || null,
            });

            // Use addon's own dates if provided, otherwise use policy dates
            const addonStartDate = addon.start_date || tempStartDate;
            const addonEndDate = addon.end_date || tempEndDate;

            const { data: addonData, error: addonError } = await supabase.from('policies').insert({
              client_id: tempClientId,
              car_id: tempCarId || null,
              category_id: null,
              policy_type_parent: addonTypeParent,
              policy_type_child: addonTypeChild,
              company_id: addon.company_id || null,
              start_date: addonStartDate,
              end_date: addonEndDate,
              issue_date: policy.issue_date || addonStartDate,
              insurance_price: addonInsurancePrice,
              profit: addonProfitData.profit,
              payed_for_company: addonProfitData.companyPayment,
              company_cost_snapshot: addonProfitData.companyPayment,
              road_service_id: addon.road_service_id || null,
              accident_fee_service_id: addon.accident_fee_service_id || null,
              group_id: groupId,
              notes: 'إضافة ضمن باقة',
              branch_id: effectiveBranchId || null,
              created_by_admin_id: user?.id || null,
              is_under_24: tempIsUnder24,
            }).select('id').single();

            if (addonError) {
              console.error('Error creating addon policy:', addonError);
              throw addonError;
            }
            // Store saved ID for X-Service sync
            (addon as any)._savedPolicyId = addonData?.id || null;
          }

          // 8. Now add the main policy from Step 3 as an addon (if different from temp policy)
          // The main policy is THIRD_FULL from Step 3
          const mainPolicyTypeParent = policy.policy_type_parent as PolicyTypeParent;
          if (firstAddonType !== 'third_full' || mainPolicyTypeParent !== 'THIRD_FULL') {
            // Main policy wasn't used as temp, so we need to create it
            const mainAddonStartDate = policy.start_date;
            const mainAddonEndDate = policy.end_date;

            const { data: mainAddonData, error: mainAddonError } = await supabase.from('policies').insert({
              client_id: tempClientId,
              car_id: tempCarId || null,
              category_id: selectedCategory?.id || null,
              policy_type_parent: mainPolicyTypeParent,
              policy_type_child: (policy.policy_type_child || null) as PolicyTypeChild | null,
              company_id: policy.company_id || null,
              start_date: mainAddonStartDate,
              end_date: mainAddonEndDate,
              issue_date: policy.issue_date || mainAddonStartDate,
              insurance_price: mainInsurancePrice,
              profit: mainProfitData.profit,
              payed_for_company: mainProfitData.companyPayment,
              company_cost_snapshot: mainProfitData.companyPayment,
              broker_buy_price: brokerBuyPriceValue || 0,
              road_service_id: policy.road_service_id || null,
              accident_fee_service_id: policy.accident_fee_service_id || null,
              group_id: groupId,
              notes: 'إضافة ضمن باقة',
              branch_id: effectiveBranchId || null,
              created_by_admin_id: user?.id || null,
              is_under_24: tempIsUnder24,
              broker_id: policyBrokerId || null,
              broker_direction: brokerDirection || null,
            }).select('id').single();

            if (mainAddonError) {
              console.error('Error creating main addon policy:', mainAddonError);
              throw mainAddonError;
            }
            _pkgMainAddonId = mainAddonData?.id || null;
          }
        }
      }

      if (!policyIdToUse) throw new Error('Policy ID is required');

      // If using temp policy, check if payments already exist (e.g. from Tranzila)
      let skipPaymentInsert = false;
      if (useTempPolicy) {
        const { data: existingDbPayments } = await supabase
          .from('policy_payments')
          .select('amount')
          .eq('policy_id', policyIdToUse)
          .eq('refused', false);
        const existingTotal = (existingDbPayments || []).reduce((s, p) => s + (p.amount || 0), 0);
        const policyPrice = pricing.totalPrice || parseFloat(policy.insurance_price) || 0;
        if (existingTotal >= policyPrice) {
          skipPaymentInsert = true;
        } else {
          // Remove stale non-visa payments that may conflict
          await supabase
            .from('policy_payments')
            .delete()
            .eq('policy_id', policyIdToUse)
            .eq('locked', false)
            .neq('payment_type', 'visa');
        }
      }

      // Create payments (skip visa payments that were already created by Tranzila)
      const nonVisaPayments = payments.filter(p => p.payment_type !== 'visa' || !p.tranzila_paid);
      if (nonVisaPayments.length > 0 && !skipPaymentInsert) {
        const paymentInserts = nonVisaPayments
          .filter(p => p.payment_type !== 'visa') // Skip visa - already handled by Tranzila
          .map(p => ({
            policy_id: policyIdToUse,
            payment_type: p.payment_type as PaymentType,
            amount: p.amount,
            payment_date: p.payment_date,
            cheque_number: p.cheque_number || null,
            cheque_status: p.payment_type === 'cheque' ? 'pending' : null,
            refused: p.refused || false,
            branch_id: effectiveBranchId || null,
            created_by_admin_id: user?.id || null,
            // Pass locked and source flags for ELZAMI system-generated payments
            locked: p.locked || false,
            source: p.source || 'user',
          }));

        if (paymentInserts.length > 0) {
          const { data: insertedPayments, error: paymentsError } = await supabase
            .from('policy_payments')
            .insert(paymentInserts)
            .select('id');

          if (paymentsError) throw paymentsError;

          // Upload payment images
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token && insertedPayments) {
            for (let i = 0; i < nonVisaPayments.filter(p => p.payment_type !== 'visa').length; i++) {
              const payment = nonVisaPayments.filter(p => p.payment_type !== 'visa')[i];
              const insertedPayment = insertedPayments[i];
              
              if (payment.pendingImages && payment.pendingImages.length > 0 && insertedPayment) {
                // Upload images in parallel
                const uploadPromises = payment.pendingImages.map(async (file, imgIndex) => {
                  const formData = new FormData();
                  formData.append('file', file);
                  formData.append('entity_type', 'payment');
                  formData.append('entity_id', insertedPayment.id);
                  if (effectiveBranchId) formData.append('branch_id', effectiveBranchId);

                  try {
                    const response = await fetch(
                      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-media`,
                      { method: 'POST', headers: { 'Authorization': `Bearer ${session.access_token}` }, body: formData }
                    );
                    if (response.ok) {
                      const data = await response.json();
                      await supabase.from('payment_images').insert({
                        payment_id: insertedPayment.id,
                        image_url: data.file?.cdn_url || data.url,
                        image_type: imgIndex === 0 ? 'front' : imgIndex === 1 ? 'back' : 'receipt',
                        sort_order: imgIndex,
                      });
                    }
                  } catch (e) {
                    console.error('Payment image upload failed:', e);
                  }
                });
                await Promise.all(uploadPromises);
              }
            }
          }
        }
      }

      // Upload files
      await uploadFiles(policyIdToUse);

      // Update car value if FULL insurance and value was entered in wizard
      if (policy.policy_type_child === 'FULL' && policy.full_car_value) {
        const carIdToUpdate = selectedCar?.id || existingCar?.id;
        if (carIdToUpdate) {
          await supabase
            .from('cars')
            .update({ car_value: parseFloat(policy.full_car_value) })
            .eq('id', carIdToUpdate);
        }
      }

      let clientIdForChildren = selectedClient?.id || newlyCreatedClientId;
      // If we used a temp policy (Tranzila flow), we might not have clientId in state
      if (!clientIdForChildren && policyIdToUse) {
        const { data: policyClient, error: policyClientError } = await supabase
          .from('policies')
          .select('client_id')
          .eq('id', policyIdToUse)
          .single();

        if (policyClientError) throw policyClientError;
        clientIdForChildren = policyClient?.client_id || null;
      }

      if (clientIdForChildren) {
        // Validate for duplicate IDs among new children BEFORE inserting
        const newChildIdNumbers = newChildren
          .map(c => digitsOnly(c.id_number).trim())
          .filter(Boolean);
        const duplicateIdNumbers = newChildIdNumbers.filter((id, idx) => newChildIdNumbers.indexOf(id) !== idx);
        if (duplicateIdNumbers.length > 0) {
          throw new Error(`رقم الهوية مكرر: ${duplicateIdNumbers[0]}`);
        }

        // Also block duplicates between new children and existing children for this client
        if (newChildIdNumbers.length > 0) {
          const { data: existing, error: existingErr } = await supabase
            .from('client_children')
            .select('id_number')
            .eq('client_id', clientIdForChildren);
          if (existingErr) throw existingErr;

          const existingSet = new Set((existing || []).map(r => digitsOnly(r.id_number).trim()));
          const dupAgainstExisting = newChildIdNumbers.find(id => existingSet.has(id));
          if (dupAgainstExisting) {
            throw new Error(`رقم الهوية "${dupAgainstExisting}" موجود مسبقاً لهذا العميل`);
          }
        }

        // Insert new children into client_children
        const insertedChildIds: string[] = [];
        if (newChildren.length > 0) {
          for (const child of newChildren) {
            if (!child.full_name.trim() || !child.id_number.trim()) continue;
            
            const { data: newChild, error: childError } = await supabase
              .from('client_children')
              .insert({
                client_id: clientIdForChildren,
                full_name: child.full_name.trim(),
                id_number: digitsOnly(child.id_number).trim(),
                birth_date: child.birth_date || null,
                phone: child.phone || null,
                relation: child.relation || null,
                notes: child.notes || null,
              })
              .select('id')
              .single();

            if (childError) {
              console.error('[PolicyWizard] Failed to insert child', {
                payload: {
                  client_id: clientIdForChildren,
                  full_name: child.full_name,
                  id_number: child.id_number,
                  birth_date: child.birth_date,
                  phone: child.phone,
                  relation: child.relation,
                },
                error: childError,
              });
              // Handle duplicate key error
              if (childError.code === '23505') {
                throw new Error(`رقم الهوية "${child.id_number}" موجود مسبقاً لهذا العميل`);
              }
              throw new Error(`فشل إضافة السائق "${child.full_name}": ${childError.message}`);
            }
            
            if (newChild) {
              insertedChildIds.push(newChild.id);
            }
          }
        }

        // All child IDs to link to policy (selected existing + newly inserted)
        const allChildIdsToLink = Array.from(new Set([...selectedChildIds, ...insertedChildIds]));

        // REPLACE strategy: Delete existing policy_children for this policy, then insert new set
        // This prevents duplicates on edit/re-save
        if (policyIdToUse) {
          const { error: deleteError } = await supabase
            .from('policy_children')
            .delete()
            .eq('policy_id', policyIdToUse);

          if (deleteError) {
            console.error('[PolicyWizard] Failed to clear existing policy_children', {
              policy_id: policyIdToUse,
              error: deleteError,
            });
            // This is required for correctness (replace-links); surface it.
            throw deleteError;
          }
        }

        // Insert into policy_children (link children to policy)
        if (allChildIdsToLink.length > 0) {
          const policyChildrenInserts = allChildIdsToLink.map(childId => ({
            policy_id: policyIdToUse,
            child_id: childId,
          }));

          const { error: linkError } = await supabase
            .from('policy_children')
            .insert(policyChildrenInserts);

          if (linkError) {
            console.error('[PolicyWizard] Failed to link policy children', {
              payload: policyChildrenInserts,
              error: linkError,
            });
            // Show specific RLS or constraint errors
            throw new Error(`فشل ربط السائقين بالوثيقة: ${linkError.message}`);
          }
        }
      }
      // Send signature and invoice SMS to client
      const clientPhone = selectedClient?.phone_number || newClient.phone_number;
      
      // Get the actual client ID (could be from temp policy creation or normal flow)
      let finalClientId = selectedClient?.id;
      if (!finalClientId && policyIdToUse) {
        // Fetch client_id from the policy we just created
        const { data: policyData } = await supabase
          .from('policies')
          .select('client_id')
          .eq('id', policyIdToUse)
          .single();
        finalClientId = policyData?.client_id;
      }
      
      if (clientPhone && policyIdToUse && finalClientId) {
        // Fire-and-forget SMS sending (don't await - for speed)
        // Signature SMS
        supabase
          .from('clients')
          .select('signature_url')
          .eq('id', finalClientId)
          .single()
          .then(({ data: clientData }) => {
            if (!clientData?.signature_url) {
              console.log('[PolicyWizard] Sending signature SMS...');
              supabase.functions.invoke('send-signature-sms', {
                body: { 
                  client_id: finalClientId,
                  policy_id: policyIdToUse
                },
              }).then(({ error }) => {
                if (error) console.error('[PolicyWizard] Signature SMS error:', error);
                else console.log('[PolicyWizard] Signature SMS sent');
              });
            }
          });

        // Invoice SMS is now handled by PolicySuccessDialog
        // Removed automatic fire-and-forget call - user chooses from dialog
      }

      clearDraft();
      setTempPolicyId(null);

      // Get final client ID and phone for success dialog
      let dialogClientId = selectedClient?.id || newlyCreatedClientId;
      if (!dialogClientId && policyIdToUse) {
        const { data: policyData } = await supabase
          .from('policies')
          .select('client_id')
          .eq('id', policyIdToUse)
          .single();
        dialogClientId = policyData?.client_id || null;
      }


      // Show success dialog instead of closing immediately
      setSuccessPolicyData({
        policyId: policyIdToUse,
        clientId: dialogClientId || '',
        clientPhone: clientPhone || null,
        isPackage: packageMode && packageAddons.some(addon => addon.enabled),
      });
      setShowSuccessDialog(true);
      
      onComplete?.(policyIdToUse);
    } catch (error: unknown) {
      console.error('Save error:', error);

      const formatSaveError = (err: unknown): string => {
        // Our own thrown errors should always be user-friendly.
        if (err instanceof Error) return err.message;
        if (typeof err === 'string') return err;
        if (!err || typeof err !== 'object') return "حدث خطأ أثناء حفظ البيانات";

        const anyErr = err as any;
        const msg = typeof anyErr.message === 'string' ? anyErr.message : "حدث خطأ أثناء حفظ البيانات";

        // Only admins should see low-level details.
        if (!isAdmin) return "حدث خطأ أثناء حفظ البيانات";

        const code = typeof anyErr.code === 'string' ? ` (${anyErr.code})` : '';
        const details = typeof anyErr.details === 'string' && anyErr.details ? ` — ${anyErr.details}` : '';
        const hint = typeof anyErr.hint === 'string' && anyErr.hint ? ` — ${anyErr.hint}` : '';
        return `${msg}${code}${details}${hint}`;
      };

      toast({
        title: "خطأ في الحفظ",
        description: formatSaveError(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // Dirty check: is there any user input we would lose on close? Used to
  // decide whether to show the "your data will be lost" confirmation.
  const isDirty = useCallback(() => {
    return !!(
      selectedClient ||
      createNewClient ||
      selectedCategory ||
      currentStep > 1 ||
      newClient.full_name?.trim() ||
      newClient.id_number?.trim() ||
      newClient.phone_number?.trim() ||
      newCar?.car_number?.trim()
    );
  }, [
    selectedClient,
    createNewClient,
    selectedCategory,
    currentStep,
    newClient.full_name,
    newClient.id_number,
    newClient.phone_number,
    newCar?.car_number,
  ]);

  const performClose = useCallback(() => {
    resetForm();
    clearDraft();
    skipCloseConfirmRef.current = true;
    onOpenChange(false);
  }, [resetForm, clearDraft, onOpenChange]);

  // Close-button handler. Shows a confirm if there is unsaved data so the
  // user can't accidentally throw away a half-filled wizard.
  const handleCloseRequest = useCallback(() => {
    if (saving) return;
    if (isDirty() && !skipCloseConfirmRef.current) {
      setCloseConfirmOpen(true);
      return;
    }
    performClose();
  }, [saving, isDirty, performClose]);

  // Helper: minimize the wizard and optionally navigate. The wizard stays
  // mounted via GlobalPolicyWizardHost so the draft survives navigation.
  const minimizeAndNavigate = (path?: string) => {
    onMinimize?.();
    if (path) navigate(path);
  };

  // When this wizard isn't the active one, render null so the host's tab
  // strip takes over for minimized instances. Hook state stays alive
  // because the component itself doesn't unmount.
  if (isCollapsed) {
    return null;
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          // Radix can still trigger this on programmatic close. ESC and
          // outside-click are prevented below, so the only way a user
          // dismisses the dialog is via the custom X button we render,
          // which calls handleCloseRequest directly. Treat any other
          // close signal as programmatic and let it through.
          if (!o) performClose();
        }}
      >
        <DialogContent
          hideCloseButton
          className="max-w-6xl w-[96vw] sm:max-h-[95vh] max-h-[100dvh] overflow-hidden flex flex-col sm:rounded-2xl rounded-none p-3 sm:p-6"
          dir="rtl"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          {/* Window-style controls: minimize + close on the same line */}
          <div className="absolute left-4 top-4 flex items-center gap-1 z-10">
            <button
              type="button"
              onClick={(e) => {
                // Capture the button's on-screen rect so the toolbar chip can
                // animate from the exact click point.
                const rect = e.currentTarget.getBoundingClientRect();
                onMinimize?.({
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2,
                });
              }}
              title="تصغير"
              aria-label="تصغير"
              className="h-7 w-7 flex items-center justify-center rounded-md border border-transparent opacity-70 hover:opacity-100 hover:bg-white hover:border-border hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <Minus className="h-4 w-4" strokeWidth={2.5} />
              <span className="sr-only">تصغير</span>
            </button>
            <button
              type="button"
              onClick={handleCloseRequest}
              title="إغلاق"
              aria-label="إغلاق"
              className="h-7 w-7 flex items-center justify-center rounded-md border border-transparent opacity-70 hover:opacity-100 hover:bg-white hover:border-border hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <X className="h-4 w-4" strokeWidth={2.5} />
              <span className="sr-only">إغلاق</span>
            </button>
          </div>
          <DialogHeader className="flex-shrink-0 pb-2 sm:pb-4 border-b">
            <DialogTitle className="text-base sm:text-xl font-bold flex items-center gap-2 min-w-0 pl-20">
              <span className="truncate">إضافة وثيقة جديدة</span>
              {selectedCategory && (
                <span className="text-xs sm:text-sm font-normal text-muted-foreground truncate">
                  ({selectedCategory.name_ar || selectedCategory.name})
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Wizard Stepper */}
          <div className="flex-shrink-0 py-2 sm:py-4">
            <WizardStepper
              steps={steps}
              currentStep={currentStep}
              onStepClick={handleStepClick}
            />
          </div>

          {/* Step Content */}
          <div className="flex-1 overflow-y-auto px-1 min-h-0">
            {currentStep === 1 && (
              <Step1BranchTypeClient
                isAdmin={isAdmin}
                branches={branches}
                selectedBranchId={selectedBranchId}
                setSelectedBranchId={handleBranchChange}
                onBranchesChanged={async (createdId) => {
                  await refetchBranches();
                  if (createdId) handleBranchChange(createdId);
                }}
                categories={categories}
                selectedCategory={selectedCategory}
                onCategoryChange={handleCategoryChange}
                onCategoriesChanged={async (createdId) => {
                  await fetchCategories();
                  if (createdId) {
                    const { data } = await supabase
                      .from('insurance_categories')
                      .select('id, name, name_ar, slug, mode, is_active, is_default')
                      .eq('id', createdId)
                      .single();
                    if (data) {
                      handleCategoryChange({
                        id: data.id,
                        name: data.name,
                        name_ar: data.name_ar,
                        slug: data.slug,
                        mode: data.mode as 'FULL' | 'LIGHT',
                        is_active: data.is_active,
                        is_default: data.is_default,
                      });
                    }
                  }
                }}
                clientSearch={clientSearch}
                setClientSearch={setClientSearch}
                clients={clients}
                setClients={setClients}
                loadingClients={loadingClients}
                setLoadingClients={setLoadingClients}
                selectedClient={selectedClient}
                setSelectedClient={setSelectedClient}
                createNewClient={createNewClient}
                setCreateNewClient={setCreateNewClient}
                newClient={newClient}
                setNewClient={setNewClient}
                checkingDuplicate={checkingDuplicate}
                setCheckingDuplicate={setCheckingDuplicate}
                selectedChildIds={selectedChildIds}
                setSelectedChildIds={setSelectedChildIds}
                newChildren={newChildren}
                setNewChildren={setNewChildren}
                errors={errors}
                setErrors={setErrors}
              />
            )}

            {currentStep === 2 && !isLightMode && (
              <Step2Car
                selectedClient={selectedClient}
                clientCars={clientCars}
                setClientCars={setClientCars}
                loadingCars={loadingCars}
                setLoadingCars={setLoadingCars}
                selectedCar={selectedCar}
                setSelectedCar={setSelectedCar}
                createNewCar={createNewCar}
                setCreateNewCar={setCreateNewCar}
                newCar={newCar}
                setNewCar={setNewCar}
                existingCar={existingCar}
                setExistingCar={setExistingCar}
                carConflict={carConflict}
                setCarConflict={setCarConflict}
                fetchingCarData={fetchingCarData}
                setFetchingCarData={setFetchingCarData}
                carDataFetched={carDataFetched}
                setCarDataFetched={setCarDataFetched}
                errors={errors}
              />
            )}

            {((currentStep === 3 && !isLightMode) || (currentStep === 2 && isLightMode)) && (
              <Step3PolicyDetails
                selectedCategory={selectedCategory}
                isLightMode={isLightMode}
                policy={policy}
                setPolicy={setPolicy}
                companies={companies}
                setCompanies={setCompanies}
                loadingCompanies={loadingCompanies}
                setLoadingCompanies={setLoadingCompanies}
                brokers={brokers}
                policyBrokerId={policyBrokerId}
                setPolicyBrokerId={setPolicyBrokerId}
                brokerDirection={brokerDirection}
                setBrokerDirection={setBrokerDirection}
                roadServices={roadServices}
                setRoadServices={setRoadServices}
                accidentFeeServices={accidentFeeServices}
                setAccidentFeeServices={setAccidentFeeServices}
                packageMode={packageMode}
                setPackageMode={setPackageMode}
                packageAddons={packageAddons}
                setPackageAddons={setPackageAddons}
                packageRoadServices={packageRoadServices}
                setPackageRoadServices={setPackageRoadServices}
                packageRoadServiceCompanies={packageRoadServiceCompanies}
                setPackageRoadServiceCompanies={setPackageRoadServiceCompanies}
                packageAccidentCompanies={packageAccidentCompanies}
                setPackageAccidentCompanies={setPackageAccidentCompanies}
                packageAccidentFeeServices={packageAccidentFeeServices}
                setPackageAccidentFeeServices={setPackageAccidentFeeServices}
                packageElzamiCompanies={packageElzamiCompanies}
                setPackageElzamiCompanies={setPackageElzamiCompanies}
                packageThirdFullCompanies={packageThirdFullCompanies}
                setPackageThirdFullCompanies={setPackageThirdFullCompanies}
                pricing={pricing}
                selectedCar={selectedCar}
                existingCar={existingCar}
                newCar={newCar}
                createNewCar={createNewCar}
                insuranceFiles={insuranceFiles}
                setInsuranceFiles={setInsuranceFiles}
                crmFiles={crmFiles}
                setCrmFiles={setCrmFiles}
                errors={errors}
                clientLessThan24={selectedClient?.less_than_24 ?? newClient?.under24_type !== 'none'}
                onMinimizeAndNavigate={minimizeAndNavigate}
              />
            )}

            {((currentStep === 4 && !isLightMode) || (currentStep === 3 && isLightMode)) && (
              <Step4Payments
                payments={payments}
                setPayments={setPayments}
                pricing={pricing}
                totalPaidPayments={totalPaidPayments}
                remainingToPay={remainingToPay}
                paymentsExceedPrice={paymentsExceedPrice}
                errors={errors}
                onCreateTempPolicy={handleCreateTempPolicy}
                onDeleteTempPolicy={handleDeleteTempPolicy}
                tempPolicyId={tempPolicyId}
                isElzami={policy.policy_type_parent === 'ELZAMI'}
              />
            )}
          </div>

          {/* Footer with navigation */}
          <div className="flex-shrink-0 pt-3 sm:pt-4 border-t">
            <div className="flex items-center justify-between gap-2">
              <div>
                {canGoPrev && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePrev}
                    disabled={saving}
                    className="sm:size-default"
                  >
                    <ArrowRight className="h-4 w-4 ml-1 sm:ml-2" />
                    <span className="hidden sm:inline">السابق</span>
                  </Button>
                )}
              </div>

              <div className="flex flex-col items-end gap-1">
                {currentStep < steps.length ? (
                  <>
                    <Button
                      onClick={handleNext}
                      disabled={!canGoNext || saving}
                      size="sm"
                      className="sm:size-default"
                    >
                      التالي
                      <ArrowLeft className="h-4 w-4 mr-1 sm:mr-2" />
                    </Button>
                    {!canGoNext && missingFields.length > 0 && (
                      <p className="text-[10px] sm:text-xs text-destructive text-right max-w-[260px] leading-tight">
                        يجب إدخال: {missingFields.join("، ")}
                      </p>
                    )}
                  </>
                ) : (
                  <Button
                    onClick={handleSave}
                    disabled={saving || paymentsExceedPrice || payments.some(p => p.payment_type === 'visa' && !p.tranzila_paid && (p.amount || 0) > 0)}
                    className="min-w-24 sm:min-w-32"
                    size="sm"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin ml-1 sm:ml-2" />
                        <span className="hidden sm:inline">جاري الحفظ...</span>
                        <span className="sm:hidden">حفظ...</span>
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 ml-1 sm:ml-2" />
                        حفظ الوثيقة
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset Warning Dialog */}
      <ResetWarningDialog
        open={resetWarning.open}
        onOpenChange={(open) => setResetWarning(prev => ({ ...prev, open }))}
        title={resetWarning.title}
        description={resetWarning.description}
        onConfirm={resetWarning.onConfirm}
      />

      {/* Close confirmation — "your unsaved data will be lost" */}
      <AlertDialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تجاهل الوثيقة؟</AlertDialogTitle>
            <AlertDialogDescription>
              ستفقد جميع البيانات التي أدخلتها في هذه الوثيقة. يمكنك بدلاً من
              ذلك تصغير النافذة للعودة إليها لاحقاً.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-3">
            <AlertDialogCancel className="mt-0">البقاء في الوثيقة</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setCloseConfirmOpen(false);
                performClose();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              تجاهل وإغلاق
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Tranzila Payment Modal */}
      {tranzilaModalOpen && tempPolicyId && activeTranzilaPaymentId && (
        <TranzilaPaymentModal
          open={tranzilaModalOpen}
          onOpenChange={(open) => {
            setTranzilaModalOpen(open);
            if (!open) setActiveTranzilaPaymentId(null);
          }}
          policyId={tempPolicyId}
          amount={payments.find(p => p.id === activeTranzilaPaymentId)?.amount || 0}
          paymentDate={payments.find(p => p.id === activeTranzilaPaymentId)?.payment_date || new Date().toISOString().split('T')[0]}
          onSuccess={() => {
            setPayments(prev => prev.map(p => 
              p.id === activeTranzilaPaymentId 
                ? { ...p, tranzila_paid: true }
                : p
            ));
            setTranzilaModalOpen(false);
            setActiveTranzilaPaymentId(null);
          }}
          onFailure={() => {
            setTranzilaModalOpen(false);
            setActiveTranzilaPaymentId(null);
          }}
        />
      )}

      {/* Success Dialog */}
      {showSuccessDialog && successPolicyData && (
        <PolicySuccessDialog
          open={showSuccessDialog}
          onOpenChange={setShowSuccessDialog}
          policyId={successPolicyData.policyId}
          clientId={successPolicyData.clientId}
          clientPhone={successPolicyData.clientPhone}
          isPackage={successPolicyData.isPackage}
          onClose={() => {
            const clientIdToNavigate = successPolicyData.clientId;
            setShowSuccessDialog(false);
            setSuccessPolicyData(null);
            onOpenChange(false);
            resetForm();
            
            // Force full page reload to show new policy data
            if (clientIdToNavigate) {
              window.location.href = `/clients/${clientIdToNavigate}`;
            } else {
              onSaved?.();
            }
          }}
        />
      )}
    </>
  );
}
