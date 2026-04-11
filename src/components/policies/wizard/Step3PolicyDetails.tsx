import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { supabase } from "@/integrations/supabase/client";
import { AlertCircle, Package, ArrowLeftRight, ImageIcon, FolderOpen, Upload, X, ChevronDown, ChevronUp, Printer, Loader2 } from "lucide-react";
import { toast } from "sonner";
import '@/types/scanner.d.ts';
import { cn } from "@/lib/utils";
import { PricingCard } from "./PricingCard";
import { PackageBuilderSection } from "./PackageBuilderSection";
import type {
  InsuranceCategory,
  Company,
  Broker,
  CarRecord,
  RoadService,
  AccidentFeeService,
  PolicyForm,
  PackageAddon,
  PricingBreakdown,
  ValidationErrors,
  NewCarForm,
} from "./types";
import { CAR_POLICY_TYPES } from "./types";

// Company X ID - default for road service and accident fee
const COMPANY_X_ID = "0014273c-78fc-4945-920c-6c8ce653f64a";

interface Step3Props {
  // Category
  selectedCategory: InsuranceCategory | null;
  isLightMode: boolean;
  
  // Policy form
  policy: PolicyForm;
  setPolicy: (policy: PolicyForm) => void;
  
  // Companies & Brokers
  companies: Company[];
  setCompanies: (companies: Company[]) => void;
  loadingCompanies: boolean;
  setLoadingCompanies: (loading: boolean) => void;
  brokers: Broker[];
  policyBrokerId: string;
  setPolicyBrokerId: (id: string) => void;
  brokerDirection: 'from_broker' | 'to_broker' | '';
  setBrokerDirection: (direction: 'from_broker' | 'to_broker' | '') => void;
  
  // Road Services
  roadServices: RoadService[];
  setRoadServices: (services: RoadService[]) => void;
  accidentFeeServices: AccidentFeeService[];
  setAccidentFeeServices: (services: AccidentFeeService[]) => void;
  
  // Package mode
  packageMode: boolean;
  setPackageMode: (mode: boolean) => void;
  packageAddons: PackageAddon[];
  setPackageAddons: (addons: PackageAddon[]) => void;
  packageRoadServices: RoadService[];
  setPackageRoadServices: (services: RoadService[]) => void;
  packageRoadServiceCompanies: Company[];
  setPackageRoadServiceCompanies: (companies: Company[]) => void;
  packageAccidentCompanies: Company[];
  setPackageAccidentCompanies: (companies: Company[]) => void;
  packageAccidentFeeServices: AccidentFeeService[];
  setPackageAccidentFeeServices: (services: AccidentFeeService[]) => void;
  packageElzamiCompanies: Company[];
  setPackageElzamiCompanies: (companies: Company[]) => void;
  packageThirdFullCompanies: Company[];
  setPackageThirdFullCompanies: (companies: Company[]) => void;
  
  // Pricing
  pricing: PricingBreakdown;
  
  // Car info (for filtering services)
  selectedCar: CarRecord | null;
  existingCar: CarRecord | null;
  newCar: NewCarForm;
  createNewCar: boolean;
  
  // Files
  insuranceFiles: File[];
  setInsuranceFiles: (files: File[]) => void;
  crmFiles: File[];
  setCrmFiles: (files: File[]) => void;
  
  // Errors
  errors: ValidationErrors;
  
  // Client age band for pricing
  clientLessThan24?: boolean;
}

export function Step3PolicyDetails({
  selectedCategory,
  isLightMode,
  policy,
  setPolicy,
  companies,
  setCompanies,
  loadingCompanies,
  setLoadingCompanies,
  brokers,
  policyBrokerId,
  setPolicyBrokerId,
  brokerDirection,
  setBrokerDirection,
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
  pricing,
  selectedCar,
  existingCar,
  newCar,
  createNewCar,
  insuranceFiles,
  setInsuranceFiles,
  crmFiles,
  setCrmFiles,
  errors,
  clientLessThan24,
}: Step3Props) {
  
  const insuranceInputRef = useRef<HTMLInputElement>(null);
  const crmInputRef = useRef<HTMLInputElement>(null);
  const [loadingPrice, setLoadingPrice] = useState(false);
  
  const [scanning, setScanning] = useState<'insurance' | 'crm' | null>(null);

  // Convert base64 to Blob for scanner
  const base64ToBlob = (base64: string): Blob => {
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: 'image/jpeg' });
  };

  // Handle direct scan
  const handleDirectScan = async (fileType: 'insurance' | 'crm') => {
    if (!window.scanner) {
      toast.error('مكتبة السكانر غير محملة. يرجى تحديث الصفحة.');
      return;
    }

    setScanning(fileType);
    const savedScanner = localStorage.getItem('preferred_scanner');

    const scanRequest = {
      use_asprise_dialog: false,
      show_scanner_ui: false,
      source_name: savedScanner || 'select',
      scanner_name: savedScanner || 'select',
      prompt_scan_more: false,
      twain_cap_setting: {
        ICAP_PIXELTYPE: 'TWPT_RGB',
        ICAP_XRESOLUTION: '200',
        ICAP_YRESOLUTION: '200',
      },
      output_settings: [{
        type: 'return-base64',
        format: 'jpg',
        jpeg_quality: 85,
      }],
    };

    try {
      window.scanner.scan(
        (successful: boolean, mesg: string, response: string) => {
          setScanning(null);

          if (!successful) {
            if (mesg && mesg.includes('cancel')) {
              return;
            }
            toast.error(mesg || 'فشل في المسح. تأكد من تثبيت ScanApp وتوصيل السكانر.');
            return;
          }

          try {
            const images = window.scanner.getScannedImages(response, true, false);
            
            if (!images || images.length === 0) {
              toast.error('لم يتم العثور على صور ممسوحة.');
              return;
            }

            // Save scanner name for next time
            try {
              const parsedResponse = JSON.parse(response);
              if (parsedResponse?.scanned?.[0]?.src_name) {
                const scannerName = parsedResponse.scanned[0].src_name;
                if (scannerName && scannerName !== 'select') {
                  localStorage.setItem('preferred_scanner', scannerName);
                }
              }
            } catch {}

            // Convert scanned images to File objects
            const newFiles: File[] = images.map((img, index) => {
              let base64Data = img.src;
              if (base64Data.startsWith('data:')) {
                base64Data = base64Data.split(',')[1];
              }
              
              const blob = base64ToBlob(base64Data);
              const timestamp = Date.now();
              return new File([blob], `scan_${timestamp}_${index}.jpg`, { type: 'image/jpeg' });
            });

            // Add to appropriate file list
            if (fileType === 'insurance') {
              setInsuranceFiles([...insuranceFiles, ...newFiles]);
            } else {
              setCrmFiles([...crmFiles, ...newFiles]);
            }

            toast.success(`تم مسح ${newFiles.length} صورة بنجاح`);
          } catch (parseError) {
            console.error('Error parsing scanned images:', parseError);
            toast.error('خطأ في معالجة الصور الممسوحة.');
          }
        },
        scanRequest
      );
    } catch (err) {
      setScanning(null);
      console.error('Scanner error:', err);
      toast.error('خطأ في الاتصال بالسكانر. تأكد من تثبيت ScanApp.');
    }
  };
  
  const getCarType = () => {
    if (createNewCar) return newCar.car_type;
    return selectedCar?.car_type || existingCar?.car_type || null;
  };

  // File handlers
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type: 'insurance' | 'crm') => {
    const files = e.target.files;
    if (!files) return;
    
    const fileArray = Array.from(files);
    if (type === 'insurance') {
      setInsuranceFiles([...insuranceFiles, ...fileArray]);
    } else {
      setCrmFiles([...crmFiles, ...fileArray]);
    }
    e.target.value = '';
  };

  const removeFile = (index: number, type: 'insurance' | 'crm') => {
    if (type === 'insurance') {
      setInsuranceFiles(insuranceFiles.filter((_, i) => i !== index));
    } else {
      setCrmFiles(crmFiles.filter((_, i) => i !== index));
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Fetch companies when policy type changes
  useEffect(() => {
    if (policy.policy_type_parent) {
      fetchCompanies(policy.policy_type_parent);
    }
  }, [policy.policy_type_parent]);

  // Fetch road services when ROAD_SERVICE is selected
  useEffect(() => {
    if (policy.policy_type_parent === 'ROAD_SERVICE') {
      fetchRoadServices(getCarType() || undefined);
    }
  }, [policy.policy_type_parent, getCarType()]);

  // Fetch accident fee services when ACCIDENT_FEE_EXEMPTION is selected
  useEffect(() => {
    if (policy.policy_type_parent === 'ACCIDENT_FEE_EXEMPTION') {
      fetchAccidentFeeServices();
    }
  }, [policy.policy_type_parent]);

  // Fetch package companies when THIRD_FULL or ELZAMI + package mode
  useEffect(() => {
    if ((policy.policy_type_parent === 'THIRD_FULL' || policy.policy_type_parent === 'ELZAMI') && packageMode) {
      fetchPackageCompanies();
    }
  }, [policy.policy_type_parent, packageMode]);

  // Auto-select Company X for Road Service and Accident Fee policies
  useEffect(() => {
    if ((policy.policy_type_parent === 'ROAD_SERVICE' || policy.policy_type_parent === 'ACCIDENT_FEE_EXEMPTION') 
        && !policy.company_id 
        && companies.length > 0) {
      const companyX = companies.find(c => c.id === COMPANY_X_ID);
      if (companyX) {
        setPolicy({ ...policy, company_id: COMPANY_X_ID });
        handleCompanyBrokerAutoSet(companyX);
      }
    }
  }, [policy.policy_type_parent, companies, policy.company_id]);

  // Auto-fetch price for Road Service
  useEffect(() => {
    if (policy.policy_type_parent === 'ROAD_SERVICE' 
        && policy.road_service_id 
        && policy.company_id) {
      fetchRoadServicePrice(policy.company_id, policy.road_service_id);
    }
  }, [policy.policy_type_parent, policy.road_service_id, policy.company_id, clientLessThan24]);

  // Auto-fetch price for Accident Fee
  useEffect(() => {
    if (policy.policy_type_parent === 'ACCIDENT_FEE_EXEMPTION' 
        && policy.accident_fee_service_id 
        && policy.company_id) {
      fetchAccidentFeePrice(policy.company_id, policy.accident_fee_service_id);
    }
  }, [policy.policy_type_parent, policy.accident_fee_service_id, policy.company_id]);

  const fetchRoadServicePrice = async (companyId: string, roadServiceId: string) => {
    setLoadingPrice(true);
    const carType = getCarType() || 'car';
    const ageBand = clientLessThan24 ? 'UNDER_24' : 'UP_24';
    
    // Try exact age band first, then fallback to ANY
    let { data } = await supabase
      .from('company_road_service_prices')
      .select('selling_price')
      .eq('company_id', companyId)
      .eq('road_service_id', roadServiceId)
      .eq('car_type', carType as 'car' | 'cargo' | 'small' | 'taxi' | 'tjeradown4' | 'tjeraup4')
      .eq('age_band', ageBand)
      .maybeSingle();
    
    if (!data) {
      const { data: anyData } = await supabase
        .from('company_road_service_prices')
        .select('selling_price')
        .eq('company_id', companyId)
        .eq('road_service_id', roadServiceId)
        .eq('car_type', carType as 'car' | 'cargo' | 'small' | 'taxi' | 'tjeradown4' | 'tjeraup4')
        .eq('age_band', 'ANY')
        .maybeSingle();
      data = anyData;
    }
    
    setLoadingPrice(false);
    if (data) {
      setPolicy({ ...policy, insurance_price: data.selling_price.toString() });
    }
  };

  const fetchAccidentFeePrice = async (companyId: string, serviceId: string) => {
    setLoadingPrice(true);
    const { data } = await supabase
      .from('company_accident_fee_prices')
      .select('selling_price')
      .eq('company_id', companyId)
      .eq('accident_fee_service_id', serviceId)
      .maybeSingle();
    
    setLoadingPrice(false);
    if (data) {
      setPolicy({ ...policy, insurance_price: data.selling_price.toString() });
    }
  };

  const fetchCompanies = async (policyType: string) => {
    setLoadingCompanies(true);
    
    // For ROAD_SERVICE - only fetch companies that have road service pricing configured
    if (policyType === 'ROAD_SERVICE') {
      const { data: priceCompanyIds } = await supabase
        .from('company_road_service_prices')
        .select('company_id');
      
      const uniqueCompanyIds = [...new Set((priceCompanyIds || []).map(p => p.company_id))];
      
      if (uniqueCompanyIds.length > 0) {
        const { data } = await supabase
          .from('insurance_companies')
          .select('id, name, name_ar, category_parent, elzami_commission, broker_id')
          .eq('active', true)
          .in('id', uniqueCompanyIds)
          .order('name');
        
        setLoadingCompanies(false);
        if (data) {
          setCompanies(data as Company[]);
        }
        return;
      }
    }
    
    // For ACCIDENT_FEE_EXEMPTION - only fetch companies that have accident fee pricing
    if (policyType === 'ACCIDENT_FEE_EXEMPTION') {
      const { data: priceCompanyIds } = await supabase
        .from('company_accident_fee_prices')
        .select('company_id');
      
      const uniqueCompanyIds = [...new Set((priceCompanyIds || []).map(p => p.company_id))];
      
      if (uniqueCompanyIds.length > 0) {
        const { data } = await supabase
          .from('insurance_companies')
          .select('id, name, name_ar, category_parent, elzami_commission, broker_id')
          .eq('active', true)
          .in('id', uniqueCompanyIds)
          .order('name');
        
        setLoadingCompanies(false);
        if (data) {
          setCompanies(data as Company[]);
        }
        return;
      }
    }
    
    // Default fetch logic for other policy types
    let query = supabase
      .from('insurance_companies')
      .select('id, name, name_ar, category_parent, elzami_commission, broker_id')
      .eq('active', true)
      .order('name');
    
    if (policyType !== 'ACCIDENT_FEE_EXEMPTION') {
      query = query.contains('category_parent', [policyType]);
    }
    
    const { data } = await query;
    setLoadingCompanies(false);
    if (data) {
      setCompanies(data as Company[]);
      if (data.length === 1) {
        const company = data[0];
        setPolicy({ ...policy, company_id: company.id });
        // Auto-set broker if company has broker_id
        handleCompanyBrokerAutoSet(company);
      }
    }
  };

  // Auto-set broker when company is selected (if company has broker_id)
  const handleCompanyBrokerAutoSet = (company: Company | undefined) => {
    if (company?.broker_id) {
      // Company is linked to a broker - auto-set broker and direction
      setPolicyBrokerId(company.broker_id);
      setBrokerDirection('from_broker');  // Broker created for us
    }
  };

  // Handle company change
  const handleCompanyChange = (companyId: string) => {
    setPolicy({ ...policy, company_id: companyId });
    const company = companies.find(c => c.id === companyId);
    
    if (company?.broker_id) {
      // Company is linked to a broker - auto-set and lock
      setPolicyBrokerId(company.broker_id);
      setBrokerDirection('from_broker');
    } else {
      // Company has no broker - clear auto-set values (user can select manually)
      // If user selects a broker manually, direction will be "to_broker"
    }
  };

  const fetchRoadServices = async (carType?: string) => {
    const { data } = await supabase
      .from('road_services')
      .select('*')
      .eq('active', true)
      .order('sort_order');
    
    if (data) {
      const filtered = carType 
        ? data.filter((rs: any) => rs.allowed_car_types?.includes(carType))
        : data;
      setRoadServices(filtered as RoadService[]);
    }
  };

  const fetchAccidentFeeServices = async () => {
    const { data } = await supabase
      .from('accident_fee_services')
      .select('*')
      .eq('active', true)
      .order('sort_order');
    
    if (data) {
      setAccidentFeeServices(data as AccidentFeeService[]);
    }
  };

  const fetchPackageCompanies = async () => {
    // Fetch ELZAMI companies
    const { data: elzamiData } = await supabase
      .from('insurance_companies')
      .select('id, name, name_ar, category_parent, elzami_commission, broker_id')
      .eq('active', true)
      .contains('category_parent', ['ELZAMI'])
      .order('name');
    
    if (elzamiData) {
      setPackageElzamiCompanies(elzamiData as Company[]);
    }

    // Fetch THIRD_FULL companies  
    const { data: thirdFullData } = await supabase
      .from('insurance_companies')
      .select('id, name, name_ar, category_parent, elzami_commission, broker_id')
      .eq('active', true)
      .contains('category_parent', ['THIRD_FULL'])
      .order('name');
    
    if (thirdFullData) {
      setPackageThirdFullCompanies(thirdFullData as Company[]);
    }

    // Fetch Road Service companies
    const { data: rsCompanies } = await supabase
      .from('insurance_companies')
      .select('id, name, name_ar, category_parent, elzami_commission, broker_id')
      .eq('active', true)
      .contains('category_parent', ['ROAD_SERVICE'])
      .order('name');
    
    if (rsCompanies) {
      setPackageRoadServiceCompanies(rsCompanies as Company[]);
    }

    // Fetch Accident Fee companies
    const { data: afeCompanies } = await supabase
      .from('insurance_companies')
      .select('id, name, name_ar, category_parent, elzami_commission, broker_id')
      .eq('active', true)
      .order('name');
    
    if (afeCompanies) {
      setPackageAccidentCompanies(afeCompanies as Company[]);
    }

    // Fetch services
    const { data: services } = await supabase
      .from('road_services')
      .select('*')
      .eq('active', true)
      .order('sort_order');
    
    if (services) {
      setPackageRoadServices(services as RoadService[]);
    }

    const { data: afeServices } = await supabase
      .from('accident_fee_services')
      .select('*')
      .eq('active', true)
      .order('sort_order');
    
    if (afeServices) {
      setPackageAccidentFeeServices(afeServices as AccidentFeeService[]);
    }
  };

  // Calculate end date range (±3 days from auto-calculated)
  const getEndDateRange = () => {
    if (!policy.start_date) return { min: '', max: '' };
    const startDate = new Date(policy.start_date);
    const baseEndDate = new Date(startDate);
    baseEndDate.setFullYear(baseEndDate.getFullYear() + 1);
    baseEndDate.setDate(baseEndDate.getDate() - 1);
    
    const minDate = new Date(baseEndDate);
    minDate.setDate(minDate.getDate() - 3);
    const maxDate = new Date(baseEndDate);
    maxDate.setDate(maxDate.getDate() + 3);
    
    return {
      min: minDate.toISOString().split('T')[0],
      max: maxDate.toISOString().split('T')[0],
    };
  };

  // Auto-update end date when start date changes
  useEffect(() => {
    if (policy.start_date) {
      const startDate = new Date(policy.start_date);
      const endDate = new Date(startDate);
      endDate.setFullYear(endDate.getFullYear() + 1);
      endDate.setDate(endDate.getDate() - 1);
      setPolicy({ ...policy, end_date: endDate.toISOString().split('T')[0] });
    }
  }, [policy.start_date]);

  const FieldError = ({ error }: { error?: string }) => {
    if (!error) return null;
    return (
      <p className="text-xs text-destructive mt-1 flex items-center gap-1">
        <AlertCircle className="h-3 w-3" />
        {error}
      </p>
    );
  };

  // Check if broker is required for this policy type
  const requiresBroker = CAR_POLICY_TYPES.find(t => t.value === policy.policy_type_parent)?.requiresBroker || false;

  return (
    <div className="space-y-6">
      {/* LIGHT mode: Show category info */}
      {isLightMode && selectedCategory && (
        <Card className="p-3 bg-muted/50">
          <p className="text-sm text-muted-foreground">نوع التأمين</p>
          <p className="font-medium">{selectedCategory.name_ar || selectedCategory.name}</p>
        </Card>
      )}

      {/* FULL mode: Policy Type Selection */}
      {!isLightMode && (
        <div>
          <Label>نوع الوثيقة *</Label>
          <Select 
            value={policy.policy_type_parent} 
            onValueChange={(v) => setPolicy({ ...policy, policy_type_parent: v, policy_type_child: "", company_id: "" })}
          >
            <SelectTrigger className={cn(errors.policy_type_parent ? "border-destructive" : "")}>
              <SelectValue placeholder="اختر نوع الوثيقة" />
            </SelectTrigger>
            <SelectContent>
              {CAR_POLICY_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError error={errors.policy_type_parent} />
        </div>
      )}

      {/* THIRD/FULL child type */}
      {policy.policy_type_parent === 'THIRD_FULL' && (
        <div>
          <Label>النوع الفرعي *</Label>
          <Select 
            value={policy.policy_type_child} 
            onValueChange={(v) => setPolicy({ ...policy, policy_type_child: v })}
          >
            <SelectTrigger className={cn(errors.policy_type_child ? "border-destructive" : "")}>
              <SelectValue placeholder="اختر النوع الفرعي" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="THIRD">ثالث</SelectItem>
              <SelectItem value="FULL">شامل</SelectItem>
            </SelectContent>
          </Select>
          <FieldError error={errors.policy_type_child} />
        </div>
      )}

      {/* Car Value for FULL insurance */}
      {policy.policy_type_parent === 'THIRD_FULL' && policy.policy_type_child === 'FULL' && (
        <div>
          <Label>قيمة السيارة (₪) *</Label>
          <Input
            type="number"
            value={policy.full_car_value || ''}
            onChange={(e) => setPolicy({ ...policy, full_car_value: e.target.value })}
            placeholder={
              selectedCar?.car_value?.toString() || 
              existingCar?.car_value?.toString() || 
              (createNewCar && newCar.car_value ? newCar.car_value : 'أدخل قيمة السيارة')
            }
            className={cn(errors.full_car_value ? "border-destructive" : "")}
          />
          <p className="text-xs text-muted-foreground mt-1">
            مطلوب لحساب سعر التأمين الشامل
          </p>
          <FieldError error={errors.full_car_value} />
        </div>
      )}

      {policy.policy_type_parent === 'ROAD_SERVICE' && (
        <div>
          <Label>خدمة الطريق *</Label>
          <Select 
            value={policy.road_service_id} 
            onValueChange={(v) => setPolicy({ ...policy, road_service_id: v })}
          >
            <SelectTrigger className={cn(errors.road_service_id ? "border-destructive" : "")}>
              <SelectValue placeholder="اختر خدمة الطريق" />
            </SelectTrigger>
            <SelectContent>
              {roadServices.map((rs) => (
                <SelectItem key={rs.id} value={rs.id}>
                  {rs.name_ar || rs.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError error={errors.road_service_id} />
        </div>
      )}

      {/* Accident Fee Service Selection */}
      {policy.policy_type_parent === 'ACCIDENT_FEE_EXEMPTION' && (
        <div>
          <Label>نوع الإعفاء *</Label>
          <Select 
            value={policy.accident_fee_service_id} 
            onValueChange={(v) => setPolicy({ ...policy, accident_fee_service_id: v })}
          >
            <SelectTrigger className={cn(errors.accident_fee_service_id ? "border-destructive" : "")}>
              <SelectValue placeholder="اختر نوع الإعفاء" />
            </SelectTrigger>
            <SelectContent>
              {accidentFeeServices.map((afs) => (
                <SelectItem key={afs.id} value={afs.id}>
                  {afs.name_ar || afs.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError error={errors.accident_fee_service_id} />
        </div>
      )}

      {/* Company Selection */}
      {!isLightMode && (
        <div>
          <Label>شركة التأمين *</Label>
          <Select 
            value={policy.company_id} 
            onValueChange={handleCompanyChange}
            disabled={!policy.policy_type_parent}
          >
            <SelectTrigger className={cn(
              errors.company_id ? "border-destructive" : "",
              !policy.policy_type_parent && "opacity-50"
            )}>
              <SelectValue placeholder={policy.policy_type_parent ? "اختر الشركة" : "اختر نوع الوثيقة أولاً"} />
            </SelectTrigger>
            <SelectContent>
              {loadingCompanies ? (
                <div className="p-2 text-center text-sm text-muted-foreground">جاري التحميل...</div>
              ) : companies.length === 0 ? (
                <div className="p-2 text-center text-sm text-muted-foreground">لا توجد شركات لهذا النوع</div>
              ) : (
                companies.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name_ar || c.name}
                    {c.broker_id && <span className="text-muted-foreground text-xs mr-2">(وسيط)</span>}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <FieldError error={errors.company_id} />
        </div>
      )}

      {/* Price Input - RIGHT AFTER Company select, before Package section */}
      {/* Only show when NOT linked to broker (broker pricing section handles this case below) */}
      {policy.company_id && !companies.find(c => c.id === policy.company_id)?.broker_id && (
        <div>
          <Label>السعر (₪) *</Label>
          <Input
            type="number"
            value={policy.insurance_price}
            onChange={(e) => setPolicy({ ...policy, insurance_price: e.target.value })}
            placeholder="أدخل السعر"
            className={cn("text-lg", errors.insurance_price ? "border-destructive" : "")}
          />
          <FieldError error={errors.insurance_price} />
        </div>
      )}

      {/* Office Commission for ELZAMI main policy */}
      {policy.policy_type_parent === 'ELZAMI' && policy.company_id && (
        <div>
          <Label>عمولة للمكتب (₪)</Label>
          <Input
            type="number"
            value={policy.office_commission}
            onChange={(e) => setPolicy({ ...policy, office_commission: e.target.value })}
            placeholder="0"
            className="text-amber-600 font-medium"
          />
          <p className="text-xs text-muted-foreground mt-1">
            عمولة الوكالة على معاملة الإلزامي (تدخل في حساب العميل)
          </p>
        </div>
      )}

      {/* Issue Date - before start/end dates, for all types */}
      <div>
        <Label>تاريخ الإصدار</Label>
        <ArabicDatePicker
          value={policy.issue_date}
          onChange={(date) => setPolicy({ ...policy, issue_date: date })}
          placeholder="تاريخ الإصدار (افتراضي = تاريخ البداية)"
        />
        <p className="text-xs text-muted-foreground mt-1">
          التاريخ الذي تحسبه الشركة (افتراضياً = تاريخ البداية)
        </p>
      </div>

      {/* Dates - Before Package Section to clarify these are for main policy */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>تاريخ البداية *</Label>
          <ArabicDatePicker
            value={policy.start_date}
            onChange={(date) => setPolicy({ ...policy, start_date: date, issue_date: policy.issue_date === policy.start_date ? date : policy.issue_date })}
            placeholder="اختر تاريخ البداية"
            className={errors.start_date ? "border-destructive" : ""}
          />
          <FieldError error={errors.start_date} />
        </div>
        <div>
          <Label>تاريخ النهاية *</Label>
          <ArabicDatePicker
            value={policy.end_date}
            onChange={(date) => setPolicy({ ...policy, end_date: date })}
            placeholder="اختر تاريخ النهاية"
            className={errors.end_date ? "border-destructive" : ""}
          />
          <FieldError error={errors.end_date} />
        </div>
      </div>

      {/* Package Mode - For THIRD_FULL and ELZAMI - BEFORE BROKER */}
      {(policy.policy_type_parent === 'THIRD_FULL' || policy.policy_type_parent === 'ELZAMI') && (() => {
        // Check if main policy requirements are met before enabling package addons
        const isMainPolicyComplete = () => {
          if (!policy.policy_type_parent || !policy.company_id) return false;
          // For THIRD_FULL, also require subtype selection
          if (policy.policy_type_parent === 'THIRD_FULL' && !policy.policy_type_child) return false;
          return true;
        };
        const canEnablePackage = isMainPolicyComplete();

        return (
          <Card className={cn(
            "p-4 transition-colors",
            packageMode ? "border-primary bg-primary/5" : "bg-secondary/30",
            !canEnablePackage && "opacity-60"
          )}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Package className="h-5 w-5 text-primary" />
                <div>
                  <Label className="text-base font-medium">إضافات الباقة</Label>
                  <p className="text-sm text-muted-foreground">
                    {policy.policy_type_parent === 'ELZAMI' 
                      ? 'ثالث/شامل، خدمات الطريق، إعفاء رسوم حادث'
                      : 'إلزامي، خدمات الطريق، إعفاء رسوم حادث'
                    }
                  </p>
                  {!canEnablePackage && (
                    <p className="text-xs text-amber-600 mt-1">
                      يرجى إكمال بيانات الوثيقة الأساسية أولاً (النوع، الشركة{policy.policy_type_parent === 'THIRD_FULL' ? '، النوع الفرعي' : ''})
                    </p>
                  )}
                </div>
              </div>
              <Switch
                checked={packageMode}
                onCheckedChange={setPackageMode}
                disabled={!canEnablePackage}
              />
            </div>

            {packageMode && (
              <div className="mt-4 pt-4 border-t">
                <PackageBuilderSection
                  addons={packageAddons}
                  onAddonsChange={setPackageAddons}
                  mainPolicyType={policy.policy_type_parent}
                  mainStartDate={policy.start_date}
                  mainEndDate={policy.end_date}
                  roadServices={packageRoadServices}
                  accidentFeeServices={packageAccidentFeeServices}
                  roadServiceCompanies={packageRoadServiceCompanies}
                  accidentFeeCompanies={packageAccidentCompanies}
                  elzamiCompanies={packageElzamiCompanies}
                  thirdFullCompanies={packageThirdFullCompanies}
                  carType={getCarType() || undefined}
                  errors={errors}
                  ageBand={clientLessThan24 ? 'UNDER_24' : 'UP_24'}
                />
              </div>
            )}
          </Card>
        );
      })()}

      {/* Broker Section - Auto-detection or manual selection */}
      {requiresBroker && (() => {
        const selectedCompany = companies.find(c => c.id === policy.company_id);
        const isCompanyLinkedToBroker = !!selectedCompany?.broker_id;
        const linkedBroker = isCompanyLinkedToBroker 
          ? brokers.find(b => b.id === selectedCompany.broker_id) 
          : null;
        
        return (
          <Card className="p-4 space-y-4 bg-muted/30">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4" />
              <Label className="font-medium">الوسيط</Label>
              {isCompanyLinkedToBroker && (
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  تم التحديد تلقائياً
                </span>
              )}
            </div>
            
            {isCompanyLinkedToBroker ? (
              // Company is linked to broker - show locked info
              <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{linkedBroker?.name || 'وسيط'}</p>
                    <p className="text-xs text-muted-foreground">من الوسيط (تلقائي)</p>
                  </div>
                  <ArrowLeftRight className="h-4 w-4 text-primary" />
                </div>
              </div>
            ) : (
              // No linked broker - show manual selection
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm">اختيار الوسيط</Label>
                  <Select 
                    value={policyBrokerId || 'none'} 
                    onValueChange={(v) => {
                      const newBrokerId = v === 'none' ? '' : v;
                      setPolicyBrokerId(newBrokerId);
                      // If user selects a broker manually, set direction to "to_broker"
                      if (newBrokerId) {
                        setBrokerDirection('to_broker');
                      } else {
                        setBrokerDirection('');
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="بدون وسيط" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">بدون وسيط</SelectItem>
                      {brokers.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {policyBrokerId && policyBrokerId !== 'none' && (
                  <div className="flex items-end">
                    <div className="p-3 bg-muted rounded-lg flex-1">
                      <p className="text-sm font-medium">إلى الوسيط</p>
                      <p className="text-xs text-muted-foreground">نحن أنشأنا للوسيط</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })()}

      {/* Broker Buy Price - Show when company is linked to a broker */}
      {(() => {
        const selectedCompany = companies.find(c => c.id === policy.company_id);
        const isCompanyLinkedToBroker = !!selectedCompany?.broker_id;
        
        if (!isCompanyLinkedToBroker) return null;
        
        const brokerBuyPrice = parseFloat(policy.broker_buy_price) || 0;
        const sellingPrice = parseFloat(policy.insurance_price) || 0;
        const profit = sellingPrice - brokerBuyPrice;
        
        return (
          <Card className="p-4 space-y-4 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
            <div className="flex items-center gap-2 mb-2">
              <ArrowLeftRight className="h-4 w-4 text-amber-600" />
              <Label className="font-medium text-amber-700 dark:text-amber-300">تسعير الوسيط</Label>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Broker Buy Price */}
              <div>
                <Label className="text-sm">سعر الشراء من الوسيط (₪)</Label>
                <Input
                  type="number"
                  value={policy.broker_buy_price}
                  onChange={(e) => setPolicy({ ...policy, broker_buy_price: e.target.value })}
                  placeholder="0"
                  className="text-lg"
                />
              </div>
              
              {/* Selling Price */}
              <div>
                <Label className="text-sm">سعر البيع للعميل (₪) *</Label>
                <Input
                  type="number"
                  value={policy.insurance_price}
                  onChange={(e) => setPolicy({ ...policy, insurance_price: e.target.value })}
                  placeholder="0"
                  className={cn("text-lg", errors.insurance_price ? "border-destructive" : "")}
                />
                <FieldError error={errors.insurance_price} />
              </div>
              
              {/* Profit Display */}
              <div>
                <Label className="text-sm">الربح (₪)</Label>
                <div className={cn(
                  "h-10 flex items-center justify-center rounded-md text-lg font-bold",
                  profit >= 0 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                )}>
                  ₪{profit.toLocaleString()}
                </div>
              </div>
            </div>
          </Card>
        );
      })()}

      {/* ELZAMI Commission Display - Always shown as cost (red) */}
      {policy.policy_type_parent === 'ELZAMI' && policy.company_id && (
        <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium text-red-700 dark:text-red-300">العمولة</Label>
            <span className="text-lg font-bold text-red-600">
              ₪{(companies.find(c => c.id === policy.company_id)?.elzami_commission || 0).toLocaleString()}
            </span>
          </div>
          <p className="text-xs text-red-500 dark:text-red-400 mt-1">
            هذا المبلغ سيُخصم من رصيد AB
          </p>
        </div>
      )}

      {/* Pricing Breakdown Card - AFTER extras */}
      {(pricing.basePrice > 0 || packageMode) && (
        <PricingCard
          pricing={pricing}
          showAddons={packageMode}
        />
      )}

      {/* Notes */}
      <div>
        <Label>ملاحظات</Label>
        <Textarea
          value={policy.notes}
          onChange={(e) => setPolicy({ ...policy, notes: e.target.value })}
          placeholder="ملاحظات إضافية..."
          rows={3}
        />
      </div>

      {/* File Uploaders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Insurance Files */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-primary" />
              <Label className="font-semibold">ملفات العميل</Label>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Scan Button */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => handleDirectScan('insurance')}
                disabled={scanning === 'insurance'}
              >
                {scanning === 'insurance' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="h-4 w-4" />
                )}
                مسح
              </Button>
              {/* Upload Button */}
              <div className="relative">
                <input
                  ref={insuranceInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,video/*"
                  onChange={(e) => handleFileSelect(e, 'insurance')}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full"
                />
                <Button type="button" size="sm" variant="outline" className="gap-1.5">
                  <Upload className="h-4 w-4" />
                  رفع ملف
                </Button>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            فواتير وإيصالات ترسل للعميل
          </p>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {insuranceFiles.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground text-sm">
                لا توجد ملفات
              </div>
            ) : (
              insuranceFiles.map((file, index) => (
                <div key={index} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {file.type.startsWith('image/') ? (
                      <ImageIcon className="h-4 w-4 text-primary flex-shrink-0" />
                    ) : (
                      <FolderOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                    <span className="text-sm truncate">{file.name}</span>
                    <span className="text-xs text-muted-foreground">({formatFileSize(file.size)})</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive flex-shrink-0"
                    onClick={() => removeFile(index, 'insurance')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* CRM Files */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <Label className="font-semibold">ملفات داخلية</Label>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Scan Button */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => handleDirectScan('crm')}
                disabled={scanning === 'crm'}
              >
                {scanning === 'crm' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="h-4 w-4" />
                )}
                مسح
              </Button>
              {/* Upload Button */}
              <div className="relative">
                <input
                  ref={crmInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,video/*"
                  onChange={(e) => handleFileSelect(e, 'crm')}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full"
                />
                <Button type="button" size="sm" variant="outline" className="gap-1.5">
                  <Upload className="h-4 w-4" />
                  رفع ملف
                </Button>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            هوية، رخصة، صور سيارة - ملفات للاستخدام الداخلي فقط
          </p>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {crmFiles.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground text-sm">
                لا توجد ملفات
              </div>
            ) : (
              crmFiles.map((file, index) => (
                <div key={index} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {file.type.startsWith('image/') ? (
                      <ImageIcon className="h-4 w-4 text-primary flex-shrink-0" />
                    ) : (
                      <FolderOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                    <span className="text-sm truncate">{file.name}</span>
                    <span className="text-xs text-muted-foreground">({formatFileSize(file.size)})</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive flex-shrink-0"
                    onClick={() => removeFile(index, 'crm')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
