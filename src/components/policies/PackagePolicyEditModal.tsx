import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClickablePhone } from "@/components/shared/ClickablePhone";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Save, X, Shield, Car, Truck, FileCheck, Package, Calculator, User, Plus, Check, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { calculatePolicyProfit } from "@/lib/pricingCalculator";
import { formatCurrency } from "@/lib/utils";
import { digitsOnly, isValidIsraeliId } from "@/lib/validation";
import { ClientChild, NewChildForm, RELATION_OPTIONS, createEmptyChildForm } from "@/types/clientChildren";
import type { Enums } from "@/integrations/supabase/types";
import { PackageBuilderSection } from "@/components/policies/wizard/PackageBuilderSection";
import type { PackageAddon, Company, RoadService as PkgRoadService, AccidentFeeService as PkgAccidentFeeService } from "@/components/policies/wizard/types";
import { PolicySuccessDialog } from "@/components/policies/PolicySuccessDialog";

// Helper to calculate end date (1 year - 1 day from start)
const calculateEndDate = (startDate: string): string => {
  if (!startDate) return "";
  const start = new Date(startDate);
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() - 1);
  return end.toISOString().split("T")[0];
};

// Helper to check if age is under 24
const isUnder24 = (birthDate: string | null): boolean | null => {
  if (!birthDate) return null;
  const today = new Date();
  const birth = new Date(birthDate);
  const age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    return age - 1 < 24;
  }
  return age < 24;
};

// Format date for display
const formatBirthDate = (dateStr: string | null): string => {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-GB");
};

interface PolicyData {
  id: string;
  policy_type_parent: string;
  policy_type_child: string | null;
  start_date: string;
  end_date: string;
  insurance_price: number;
  is_under_24?: boolean | null;
  group_id: string | null;
  // Per-row fields ported in from PolicyEditDrawer so single-policy edit
  // through this modal keeps full feature parity.
  broker_id?: string | null;
  office_commission?: number | null;
  notes?: string | null;
  insurance_companies?: {
    id: string;
    name: string;
    name_ar: string | null;
  } | null;
  road_services?: {
    id: string;
    name: string;
    name_ar: string | null;
  } | null;
  accident_fee_services?: {
    id: string;
    name: string;
    name_ar: string | null;
  } | null;
  cars?: {
    car_type: string | null;
    car_value: number | null;
    year: number | null;
    car_number: string | null;
  } | null;
  clients?: {
    full_name: string | null;
  } | null;
}

interface PackagePolicyEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Either groupId (package mode — edits every sibling in the group) or
  // policyId (single mode — edits just one row, with the option to grow
  // it into a package via the addon builder). Pass null/undefined for
  // whichever you're not using.
  groupId?: string | null;
  policyId?: string | null;
  initialPolicyId?: string | null;
  onSaved?: () => void;
}

interface EditState {
  startDate: string;
  endDate: string;
  issueDate: string;
  insurancePrice: string;
  // For non-service rows this IS the insurance company id. For
  // ROAD_SERVICE / ACCIDENT_FEE_EXEMPTION rows it's the *service* id
  // (a road_services / accident_fee_services row), kept under the same
  // name to avoid touching every consumer.
  companyId: string;
  // Real insurance company (insurance_companies.id) for service rows —
  // the printed package invoice joins on this column, so we surface it
  // as a separate select for ROAD_SERVICE / ACCIDENT_FEE_EXEMPTION.
  // Unused (left blank) for non-service rows.
  insuranceCompanyId: string;
  // The (possibly switched) policy type. In package mode the UI only
  // allows ROAD_SERVICE ↔ ACCIDENT_FEE_EXEMPTION switches; in single
  // mode the user can flip between any of the four types.
  policyType: string;
  policyTypeChild: string;
  officeCommission: string;
  notes: string;
}

interface LookupOption {
  id: string;
  label: string;
}

interface BrokerOption {
  id: string;
  name: string;
}

const NO_BROKER = "__NO_BROKER__";

const policyTypeLabels: Record<string, string> = {
  ELZAMI: "إلزامي",
  THIRD_FULL: "ثالث/شامل",
  ROAD_SERVICE: "خدمات الطريق",
  ACCIDENT_FEE_EXEMPTION: "إعفاء رسوم حادث",
};

const policyChildLabels: Record<string, string> = {
  THIRD: "طرف ثالث",
  FULL: "شامل",
};

const policyTypeConfig: Record<string, { icon: React.ElementType; bg: string; text: string; border: string }> = {
  ELZAMI: { icon: Shield, bg: "bg-blue-500/10", text: "text-blue-700", border: "border-blue-500/30" },
  THIRD_FULL: { icon: Car, bg: "bg-purple-500/10", text: "text-purple-700", border: "border-purple-500/30" },
  ROAD_SERVICE: { icon: Truck, bg: "bg-orange-500/10", text: "text-orange-700", border: "border-orange-500/30" },
  ACCIDENT_FEE_EXEMPTION: { icon: FileCheck, bg: "bg-green-500/10", text: "text-green-700", border: "border-green-500/30" },
};

// Sort order for policy types
const policyTypeSortOrder: Record<string, number> = {
  THIRD_FULL: 1,
  ELZAMI: 2,
  ROAD_SERVICE: 3,
  ACCIDENT_FEE_EXEMPTION: 4,
};

export function PackagePolicyEditModal({
  open,
  onOpenChange,
  groupId,
  policyId,
  initialPolicyId,
  onSaved,
}: PackagePolicyEditModalProps) {
  const { toast } = useToast();
  // Single mode triggers when there's no groupId but a policyId — shows
  // one card and lets the user convert into a package by enabling addons.
  const isSingleMode = !groupId && !!policyId;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [policies, setPolicies] = useState<PolicyData[]>([]);
  const [editStates, setEditStates] = useState<Record<string, EditState>>({});
  const [clientName, setClientName] = useState<string>("");
  const [carNumber, setCarNumber] = useState<string>("");

  // Extra drivers state
  const [clientId, setClientId] = useState<string | null>(null);
  const [existingChildren, setExistingChildren] = useState<ClientChild[]>([]);
  const [linkedChildIds, setLinkedChildIds] = useState<string[]>([]);
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);
  const [newChildren, setNewChildren] = useState<NewChildForm[]>([]);
  const [childErrors, setChildErrors] = useState<Record<string, Record<string, string>>>({});

  // Company / provider lookup lists keyed by policy type so the select for
  // each row shows only the right pool.
  const [elzamiCompanies, setElzamiCompanies] = useState<LookupOption[]>([]);
  const [thirdFullCompanies, setThirdFullCompanies] = useState<LookupOption[]>([]);
  const [roadServices, setRoadServices] = useState<LookupOption[]>([]);
  const [accidentFeeServices, setAccidentFeeServices] = useState<LookupOption[]>([]);
  const [brokers, setBrokers] = useState<BrokerOption[]>([]);
  // Single broker for the whole package — replaces the per-row select.
  // Initialized from the THIRD_FULL row when present, otherwise from
  // the first row that has a broker set.
  const [packageBrokerId, setPackageBrokerId] = useState<string>(NO_BROKER);

  // Extra context needed to insert new addon policies into the package
  // (everything inherits from the existing package — same client, car,
  // branch, age band).
  const [carId, setCarId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [carType, setCarType] = useState<string | null>(null);
  const [carValue, setCarValue] = useState<number | null>(null);
  const [carYear, setCarYear] = useState<number | null>(null);

  // Client-level under-24 state. The radio mirrors PolicyEditDrawer's UI
  // (only "none" / "client" — "additional_driver" was a legacy mode that
  // the old drawer no longer exposed). Driver name/id are kept as-is when
  // the existing record had additional_driver, so we don't accidentally
  // clobber legacy data on save.
  const [under24Type, setUnder24Type] = useState<'none' | 'client' | 'additional_driver'>('none');
  const [under24DriverName, setUnder24DriverName] = useState<string>("");
  const [under24DriverId, setUnder24DriverId] = useState<string>("");

  // Package builder state — mirrors the wizard so we can reuse
  // PackageBuilderSection. Initialize all four addon types as defaults
  // (PackageBuilderSection's updateAddon only mutates entries that
  // already exist in the array). Cards for types already present in the
  // package are hidden via `hideTypes` below.
  const [packageAddons, setPackageAddons] = useState<PackageAddon[]>([
    { type: "elzami", enabled: false, company_id: "", insurance_price: "", elzami_commission: 0, office_commission: "0", start_date: "", end_date: "" },
    { type: "third_full", enabled: false, company_id: "", insurance_price: "", policy_type_child: "", broker_buy_price: "", start_date: "", end_date: "" },
    { type: "road_service", enabled: false, road_service_id: "", company_id: "", insurance_price: "", start_date: "", end_date: "" },
    { type: "accident_fee_exemption", enabled: false, accident_fee_service_id: "", company_id: "", insurance_price: "", start_date: "", end_date: "" },
  ]);
  const [pkgElzamiCompanies, setPkgElzamiCompanies] = useState<Company[]>([]);
  const [pkgThirdFullCompanies, setPkgThirdFullCompanies] = useState<Company[]>([]);
  const [pkgRoadServiceCompanies, setPkgRoadServiceCompanies] = useState<Company[]>([]);
  const [pkgAccidentFeeCompanies, setPkgAccidentFeeCompanies] = useState<Company[]>([]);
  const [pkgRoadServices, setPkgRoadServices] = useState<PkgRoadService[]>([]);
  const [pkgAccidentFeeServices, setPkgAccidentFeeServices] = useState<PkgAccidentFeeService[]>([]);

  // Print/SMS dialog after save — same component the wizard uses, so
  // editing a package gets the same "ready to send" UX as creating one.
  const [clientPhone, setClientPhone] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [successPolicyId, setSuccessPolicyId] = useState<string | null>(null);
  // Whether the just-saved record is a package (true if pre-existing
  // package, or single-mode policy that was promoted with addons).
  const [successIsPackage, setSuccessIsPackage] = useState(true);

  const getCompanyOptions = useCallback(
    (policyType: string): LookupOption[] => {
      if (policyType === 'ELZAMI') return elzamiCompanies;
      if (policyType === 'THIRD_FULL') return thirdFullCompanies;
      if (policyType === 'ROAD_SERVICE') return roadServices;
      if (policyType === 'ACCIDENT_FEE_EXEMPTION') return accidentFeeServices;
      return [];
    },
    [elzamiCompanies, thirdFullCompanies, roadServices, accidentFeeServices],
  );

  // Fetch policy/policies + lookups. Branches on mode: groupId fetches
  // every sibling in the package, policyId fetches just the one row.
  const fetchPolicies = useCallback(async () => {
    if ((!groupId && !policyId) || !open) return;

    setLoading(true);
    try {
      const baseSelect = `
          id,
          policy_type_parent,
          policy_type_child,
          start_date,
          end_date,
          issue_date,
          insurance_price,
          is_under_24,
          group_id,
          client_id,
          car_id,
          branch_id,
          broker_id,
          office_commission,
          notes,
          insurance_companies (id, name, name_ar),
          road_services (id, name, name_ar),
          accident_fee_services (id, name, name_ar),
          cars (car_type, car_value, year, car_number),
          clients (id, full_name, phone_number, less_than_24, under24_type, under24_driver_name, under24_driver_id)
      `;

      let data: any[] | null = null;
      if (groupId) {
        const { data: groupData, error } = await supabase
          .from("policies")
          .select(baseSelect)
          .eq("group_id", groupId)
          .order("created_at", { ascending: true });
        if (error) throw error;
        data = (groupData as any[]) || [];
      } else if (policyId) {
        const { data: oneData, error } = await supabase
          .from("policies")
          .select(baseSelect)
          .eq("id", policyId)
          .single();
        if (error) throw error;
        data = oneData ? [oneData as any] : [];
      }

      // Sort by policy type
      const sortedData = (data || []).sort((a, b) => {
        const orderA = policyTypeSortOrder[a.policy_type_parent] || 99;
        const orderB = policyTypeSortOrder[b.policy_type_parent] || 99;
        return orderA - orderB;
      });

      setPolicies(sortedData);

      // Initialize edit states
      const states: Record<string, EditState> = {};
      sortedData.forEach((p) => {
        let currentCompanyId = '';
        if (p.policy_type_parent === 'ROAD_SERVICE') currentCompanyId = p.road_services?.id || '';
        else if (p.policy_type_parent === 'ACCIDENT_FEE_EXEMPTION') currentCompanyId = p.accident_fee_services?.id || '';
        else currentCompanyId = p.insurance_companies?.id || '';
        states[p.id] = {
          startDate: p.start_date || "",
          endDate: p.end_date || "",
          issueDate: p.issue_date || p.start_date || "",
          insurancePrice: p.insurance_price?.toString() || "0",
          companyId: currentCompanyId,
          insuranceCompanyId: p.insurance_companies?.id || "",
          policyType: p.policy_type_parent,
          policyTypeChild: p.policy_type_child || "",
          officeCommission: p.office_commission != null ? String(p.office_commission) : "0",
          notes: p.notes || "",
        };
      });
      setEditStates(states);

      // Seed the single package-level broker from the most relevant
      // row: prefer THIRD_FULL (which is the row that conceptually
      // owns the broker), fall back to any row that has a broker set.
      const brokerSource = sortedData.find((p) => p.policy_type_parent === 'THIRD_FULL' && p.broker_id)
        || sortedData.find((p) => p.broker_id);
      setPackageBrokerId(brokerSource?.broker_id || NO_BROKER);

      // Fetch the lookup tables in parallel so the selects populate before
      // the user starts editing.
      const [icRes, rsRes, afRes, pkgRsRes, pkgAfRes, brokersRes] = await Promise.all([
        supabase
          .from('insurance_companies')
          .select('id, name, name_ar, category_parent, elzami_commission, broker_id')
          .order('name_ar', { ascending: true }),
        supabase
          .from('road_services')
          .select('id, name, name_ar')
          .order('name_ar', { ascending: true }),
        supabase
          .from('accident_fee_services')
          .select('id, name, name_ar')
          .order('name_ar', { ascending: true }),
        // Full rows (with allowed_car_types / active) for the package
        // builder's filtering logic — kept as a separate fetch so we
        // don't disturb the existing LookupOption selects.
        supabase
          .from('road_services')
          .select('id, name, name_ar, allowed_car_types, active')
          .eq('active', true)
          .order('sort_order', { ascending: true }),
        supabase
          .from('accident_fee_services')
          .select('id, name, name_ar, active')
          .eq('active', true)
          .order('sort_order', { ascending: true }),
        supabase
          .from('brokers')
          .select('id, name')
          .order('name'),
      ]);

      const toOption = (row: any): LookupOption => ({
        id: row.id,
        label: row.name_ar || row.name,
      });

      // `category_parent` on insurance_companies is a text[] array
      // (["ELZAMI"], ["THIRD_FULL"], or both) — not a single value — so
      // the earlier `=== 'ELZAMI'` check was comparing an array to a
      // string and always evaluating false, which is why every company
      // dropdown came up empty. Use Array.isArray + .includes instead.
      const icRows = (icRes.data || []) as any[];
      const matchesCategory = (row: any, category: string): boolean => {
        if (Array.isArray(row.category_parent)) {
          return row.category_parent.includes(category);
        }
        // Legacy rows imported before the column was converted from a
        // single enum still store a plain string — fall back to equality
        // so they keep surfacing in the right bucket.
        return row.category_parent === category;
      };
      setElzamiCompanies(
        icRows.filter((r) => matchesCategory(r, 'ELZAMI')).map(toOption),
      );
      setThirdFullCompanies(
        icRows
          .filter((r) => {
            // THIRD_FULL covers both شامل and طرف ثالث rows. Companies
            // without any category_parent fall in here too because those
            // are usually older THIRD_FULL rows that predate the column.
            if (matchesCategory(r, 'THIRD_FULL')) return true;
            if (!r.category_parent || (Array.isArray(r.category_parent) && r.category_parent.length === 0)) {
              return true;
            }
            return false;
          })
          .map(toOption),
      );
      setRoadServices((rsRes.data || []).map(toOption));
      setAccidentFeeServices((afRes.data || []).map(toOption));
      setBrokers((brokersRes.data || []) as BrokerOption[]);

      // Build the typed Company[] buckets the package builder expects.
      // Road service / accident fee company filters mirror Step3 of the
      // wizard — accident fee uses the full active company list because
      // the data team hasn't tagged those rows with category_parent yet.
      const fullCompanies = icRows as Company[];
      setPkgElzamiCompanies(fullCompanies.filter((r) => matchesCategory(r, 'ELZAMI')));
      setPkgThirdFullCompanies(
        fullCompanies.filter((r) => {
          if (matchesCategory(r, 'THIRD_FULL')) return true;
          if (!r.category_parent || (Array.isArray(r.category_parent) && r.category_parent.length === 0)) return true;
          return false;
        }),
      );
      setPkgRoadServiceCompanies(fullCompanies.filter((r) => matchesCategory(r, 'ROAD_SERVICE')));
      setPkgAccidentFeeCompanies(fullCompanies);
      setPkgRoadServices((pkgRsRes.data || []) as PkgRoadService[]);
      setPkgAccidentFeeServices((pkgAfRes.data || []) as PkgAccidentFeeService[]);

      // Get client name, car number, and client_id from first policy
      if (sortedData.length > 0) {
        const first: any = sortedData[0];
        setClientName(first.clients?.full_name || "");
        setCarNumber(first.cars?.car_number || "");
        const cId = first.client_id;
        setClientId(cId || null);
        // Capture car / branch / age band so we can stamp newly-added
        // addon policies with the same context as the rest of the package.
        setCarId(first.car_id || null);
        setBranchId(first.branch_id || null);
        setCarType(first.cars?.car_type || null);
        setCarValue(first.cars?.car_value ?? null);
        setCarYear(first.cars?.year ?? null);
        // Phone comes from the joined clients row now.
        setClientPhone(first.clients?.phone_number || null);

        // is_under_24 is per-policy in the schema but uniform across the
        // package — pull from THIRD_FULL when present, else from any row.
        const ageSourcePolicy = sortedData.find((p) => p.policy_type_parent === 'THIRD_FULL') || sortedData[0];

        // Seed under24 controls from the client row. Prefer the explicit
        // under24_type column; fall back to less_than_24 / is_under_24 to
        // cover legacy rows from before that column existed.
        const clientRow = first.clients;
        const seededType: 'none' | 'client' | 'additional_driver' =
          clientRow?.under24_type && clientRow.under24_type !== 'none'
            ? clientRow.under24_type
            : (ageSourcePolicy.is_under_24 || clientRow?.less_than_24)
              ? 'client'
              : 'none';
        setUnder24Type(seededType);
        setUnder24DriverName(clientRow?.under24_driver_name || "");
        setUnder24DriverId(clientRow?.under24_driver_id || "");

        // Fetch existing children for this client
        if (cId) {
          const { data: childrenData } = await supabase
            .from("client_children")
            .select("*")
            .eq("client_id", cId)
            .order("created_at", { ascending: true });
          setExistingChildren(childrenData || []);

          // Find the main policy (THIRD_FULL) to get linked children
          const mainPolicy = sortedData.find(p => p.policy_type_parent === "THIRD_FULL");
          if (mainPolicy) {
            const { data: linkedData } = await supabase
              .from("policy_children")
              .select("child_id")
              .eq("policy_id", mainPolicy.id);
            const ids = (linkedData || []).map(l => l.child_id);
            setLinkedChildIds(ids);
            setSelectedChildIds(ids);
          } else {
            setLinkedChildIds([]);
            setSelectedChildIds([]);
          }
        }
      }
    } catch (error) {
      console.error("Error fetching policies:", error);
      toast({
        title: "خطأ",
        description: "فشل في تحميل المعاملات",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [groupId, policyId, open, toast]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setPolicies([]);
      setEditStates({});
      setClientName("");
      setCarNumber("");
      setClientId(null);
      setExistingChildren([]);
      setLinkedChildIds([]);
      setSelectedChildIds([]);
      setNewChildren([]);
      setChildErrors({});
      setCarId(null);
      setBranchId(null);
      setCarType(null);
      setCarValue(null);
      setCarYear(null);
      setUnder24Type('none');
      setUnder24DriverName("");
      setUnder24DriverId("");
      setPackageAddons([
        { type: "elzami", enabled: false, company_id: "", insurance_price: "", elzami_commission: 0, office_commission: "0", start_date: "", end_date: "" },
        { type: "third_full", enabled: false, company_id: "", insurance_price: "", policy_type_child: "", broker_buy_price: "", start_date: "", end_date: "" },
        { type: "road_service", enabled: false, road_service_id: "", company_id: "", insurance_price: "", start_date: "", end_date: "" },
        { type: "accident_fee_exemption", enabled: false, accident_fee_service_id: "", company_id: "", insurance_price: "", start_date: "", end_date: "" },
      ]);
      setClientPhone(null);
      setShowSuccessDialog(false);
      setSuccessPolicyId(null);
      setSuccessIsPackage(true);
      setPackageBrokerId(NO_BROKER);
    }
  }, [open]);

  const updateEditState = <K extends keyof EditState>(policyId: string, field: K, value: EditState[K]) => {
    setEditStates((prev) => {
      const newState = { ...prev[policyId], [field]: value } as EditState;

      // Auto-calculate end date when start date changes
      if (field === "startDate" && typeof value === 'string' && value) {
        newState.endDate = calculateEndDate(value);
      }

      return { ...prev, [policyId]: newState };
    });
  };

  // Toggle child selection
  const toggleChild = (childId: string) => {
    if (selectedChildIds.includes(childId)) {
      setSelectedChildIds(selectedChildIds.filter(id => id !== childId));
    } else {
      setSelectedChildIds([...selectedChildIds, childId]);
    }
  };

  // Validate new child form
  const validateNewChild = (child: NewChildForm, allNewChildren: NewChildForm[]): Record<string, string> => {
    const errors: Record<string, string> = {};

    if (!child.full_name.trim()) {
      errors.full_name = "الاسم مطلوب";
    }

    if (!child.id_number.trim()) {
      errors.id_number = "رقم الهوية مطلوب";
    } else if (!isValidIsraeliId(child.id_number)) {
      errors.id_number = "رقم هوية غير صالح";
    } else {
      const normalized = digitsOnly(child.id_number).trim();
      const duplicateInNew = allNewChildren.some(
        c => c.id !== child.id && digitsOnly(c.id_number).trim() === normalized
      );
      const duplicateInExisting = existingChildren.some(
        c => digitsOnly(c.id_number).trim() === normalized
      );

      if (duplicateInNew) {
        errors.id_number = "رقم الهوية مكرر في القائمة";
      } else if (duplicateInExisting) {
        errors.id_number = "رقم الهوية موجود مسبقاً للعميل";
      }
    }

    return errors;
  };

  // Add new child form
  const handleAddNewChild = () => {
    setNewChildren((prev) => [...prev, createEmptyChildForm()]);
  };

  // Ref for auto-scroll to new child
  const newChildBottomRef = useRef<HTMLDivElement>(null);
  const prevNewChildrenLengthRef = useRef(newChildren.length);

  // Ref + previous-enabled-set for scrolling the package builder into
  // view when the user toggles a card on (otherwise the freshly-expanded
  // form sits off-screen at the bottom of the modal).
  const addonSectionRef = useRef<HTMLDivElement>(null);
  const prevEnabledAddonsRef = useRef<Set<PackageAddon['type']>>(new Set());

  useEffect(() => {
    const enabledNow = new Set(packageAddons.filter((a) => a.enabled).map((a) => a.type));
    const newlyEnabled = [...enabledNow].some((t) => !prevEnabledAddonsRef.current.has(t));
    if (newlyEnabled) {
      // Wait for the expanded card markup to render before scrolling so
      // we land at the bottom of the now-taller section.
      setTimeout(() => {
        addonSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 50);
    }
    prevEnabledAddonsRef.current = enabledNow;
  }, [packageAddons]);

  // Auto-scroll when new child is added
  useEffect(() => {
    if (newChildren.length > prevNewChildrenLengthRef.current) {
      setTimeout(() => {
        newChildBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 100);
    }
    prevNewChildrenLengthRef.current = newChildren.length;
  }, [newChildren.length]);

  // Update new child field
  const handleUpdateNewChild = (index: number, field: keyof NewChildForm, value: string) => {
    const updated = [...newChildren];
    updated[index] = { ...updated[index], [field]: value };
    setNewChildren(updated);

    // Recompute errors
    const nextErrors: Record<string, Record<string, string>> = {};
    for (const c of updated) {
      nextErrors[c.id] = validateNewChild(c, updated);
    }
    setChildErrors(nextErrors);
  };

  // Remove new child form
  const handleRemoveNewChild = (index: number) => {
    const updated = newChildren.filter((_, i) => i !== index);
    setNewChildren(updated);

    const nextErrors: Record<string, Record<string, string>> = {};
    for (const c of updated) {
      nextErrors[c.id] = validateNewChild(c, updated);
    }
    setChildErrors(nextErrors);
  };

  const calculateTotal = () => {
    return Object.values(editStates).reduce((sum, state) => {
      return sum + (parseFloat(state.insurancePrice) || 0);
    }, 0);
  };

  const handleSaveAll = async () => {
    if (policies.length === 0) return;

    // Validate new children before saving
    const hasErrors = newChildren.some(child => {
      const errors = validateNewChild(child, newChildren);
      return Object.keys(errors).length > 0;
    });

    if (hasErrors) {
      toast({
        title: "خطأ في البيانات",
        description: "يرجى تصحيح أخطاء السائقين الإضافيين",
        variant: "destructive",
      });
      return;
    }

    // Validate any newly-enabled package addons. The wizard's
    // PackageBuilderSection does not validate on its own — it expects
    // the host (the wizard) to gate save. Catching empty fields here
    // also covers the case where the company-pricing filter silently
    // wipes the road_service / accident_fee selection after the user
    // picks a company that doesn't price the chosen service.
    const addonLabels: Record<PackageAddon['type'], string> = {
      elzami: 'إلزامي',
      third_full: 'ثالث/شامل',
      road_service: 'خدمات الطريق',
      accident_fee_exemption: 'إعفاء رسوم حادث',
    };
    for (const addon of packageAddons) {
      if (!addon.enabled) continue;
      const label = addonLabels[addon.type];
      const price = parseFloat(addon.insurance_price);
      if (!price || price <= 0) {
        toast({ title: "خطأ في البيانات", description: `أدخل السعر للإضافة (${label})`, variant: "destructive" });
        return;
      }
      if (addon.type === 'third_full' && !addon.policy_type_child) {
        toast({ title: "خطأ في البيانات", description: `اختر النوع (ثالث/شامل) للإضافة (${label})`, variant: "destructive" });
        return;
      }
      if ((addon.type === 'elzami' || addon.type === 'third_full') && !addon.company_id) {
        toast({ title: "خطأ في البيانات", description: `اختر شركة التأمين للإضافة (${label})`, variant: "destructive" });
        return;
      }
      if (addon.type === 'road_service') {
        if (!addon.road_service_id) {
          toast({ title: "خطأ في البيانات", description: `اختر نوع الخدمة للإضافة (${label})`, variant: "destructive" });
          return;
        }
        if (!addon.company_id) {
          toast({ title: "خطأ في البيانات", description: `اختر الشركة للإضافة (${label})`, variant: "destructive" });
          return;
        }
      }
      if (addon.type === 'accident_fee_exemption') {
        if (!addon.accident_fee_service_id) {
          toast({ title: "خطأ في البيانات", description: `اختر نوع الخدمة للإضافة (${label})`, variant: "destructive" });
          return;
        }
        if (!addon.company_id) {
          toast({ title: "خطأ في البيانات", description: `اختر الشركة للإضافة (${label})`, variant: "destructive" });
          return;
        }
      }
      if (!addon.start_date || !addon.end_date) {
        toast({ title: "خطأ في البيانات", description: `حدد تواريخ البدء والانتهاء للإضافة (${label})`, variant: "destructive" });
        return;
      }
    }

    setSaving(true);
    try {
      // 1. Create new children if any
      const newChildIds: string[] = [];
      if (clientId && newChildren.length > 0) {
        for (const child of newChildren) {
          const { data: inserted, error: insertError } = await supabase
            .from("client_children")
            .insert({
              client_id: clientId,
              full_name: child.full_name,
              id_number: digitsOnly(child.id_number),
              birth_date: child.birth_date || null,
              phone: child.phone || null,
              relation: child.relation || null,
              notes: child.notes || null,
            })
            .select("id")
            .single();

          if (insertError) throw insertError;
          if (inserted) newChildIds.push(inserted.id);
        }
      }

      // 2. Update policy_children for main policy (THIRD_FULL)
      const mainPolicy = policies.find(p => p.policy_type_parent === "THIRD_FULL");
      if (mainPolicy) {
        const allSelectedIds = [...selectedChildIds, ...newChildIds];

        // Remove old links that are no longer selected
        const toRemove = linkedChildIds.filter(id => !allSelectedIds.includes(id));
        if (toRemove.length > 0) {
          await supabase
            .from("policy_children")
            .delete()
            .eq("policy_id", mainPolicy.id)
            .in("child_id", toRemove);
        }

        // Add new links
        const toAdd = allSelectedIds.filter(id => !linkedChildIds.includes(id));
        if (toAdd.length > 0) {
          await supabase
            .from("policy_children")
            .insert(toAdd.map(childId => ({
              policy_id: mainPolicy.id,
              child_id: childId,
            })));
        }
      }

      // 3. Persist client-level under24 fields. Mirrors PolicyEditDrawer:
      // legacy `additional_driver` rows keep their driver name/id; "none"
      // and "client" wipe the driver fields.
      if (clientId) {
        await supabase
          .from('clients')
          .update({
            under24_type: under24Type,
            under24_driver_name: under24Type === 'additional_driver' ? under24DriverName : null,
            under24_driver_id: under24Type === 'additional_driver' ? under24DriverId : null,
            less_than_24: under24Type !== 'none',
            updated_at: new Date().toISOString(),
          })
          .eq('id', clientId);
      }
      const clientUnder24 = under24Type !== 'none';

      // 4. If we're in single mode and the user enabled addons, the
      // existing single policy needs a group_id so the addons can attach
      // to it. Create a policy_groups row up front and stamp the existing
      // row with that id during the update step below.
      let effectiveGroupId: string | null = groupId || null;
      const enabledAddons = packageAddons.filter((a) => a.enabled);
      if (isSingleMode && enabledAddons.length > 0 && !effectiveGroupId) {
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
        effectiveGroupId = groupData?.id || null;
      }

      // 5. Process each policy
      for (const policy of policies) {
        const state = editStates[policy.id];
        if (!state) continue;

        const price = parseFloat(state.insurancePrice) || 0;
        let companyPayment = price;
        let profit = 0;

        // Resolve the selected company/provider id and the (possibly
        // switched) policy type. Only service rows let the user flip
        // between ROAD_SERVICE ↔ ACCIDENT_FEE_EXEMPTION; everything else
        // stays on its original type.
        const selectedId = state.companyId || '';
        const effectiveType = state.policyType || policy.policy_type_parent;
        const effectiveChild = effectiveType === 'THIRD_FULL'
          ? (state.policyTypeChild || policy.policy_type_child || null)
          : null;

        // Recalculate profit based on the (possibly edited) policy type
        // using the selected company.
        if (effectiveType === "ELZAMI") {
          const { data: companyData } = await supabase
            .from("insurance_companies")
            .select("elzami_commission")
            .eq("id", selectedId)
            .single();
          profit = companyData?.elzami_commission || 0;
          companyPayment = price;
        } else if (effectiveType === "ROAD_SERVICE") {
          if (selectedId) {
            const { data: priceData } = await supabase
              .from("company_road_service_prices")
              .select("company_cost")
              .eq("road_service_id", selectedId)
              .limit(1)
              .maybeSingle();
            companyPayment = priceData?.company_cost || price;
          }
          profit = price - companyPayment;
        } else if (effectiveType === "ACCIDENT_FEE_EXEMPTION") {
          if (selectedId) {
            const { data: priceData } = await supabase
              .from("company_accident_fee_prices")
              .select("company_cost")
              .eq("accident_fee_service_id", selectedId)
              .limit(1)
              .maybeSingle();
            companyPayment = priceData?.company_cost || price;
          }
          profit = price - companyPayment;
        } else if (effectiveType === "THIRD_FULL" && selectedId) {
          const ageBand: Enums<"age_band"> = clientUnder24 ? "UNDER_24" : "UP_24";
          const result = await calculatePolicyProfit({
            policyTypeParent: effectiveType as Enums<"policy_type_parent">,
            policyTypeChild: (effectiveChild || null) as Enums<"policy_type_child"> | null,
            companyId: selectedId,
            carType: (policy.cars?.car_type || "car") as Enums<"car_type">,
            ageBand,
            carValue: policy.cars?.car_value || null,
            carYear: policy.cars?.year || null,
            insurancePrice: price,
          });
          companyPayment = result.companyPayment;
          profit = result.profit;
        }

        // Build the update payload — route the selected id to the correct
        // foreign-key column depending on the effective policy type and
        // null out the other service column if the row just switched
        // from ROAD_SERVICE to ACCIDENT_FEE_EXEMPTION (or vice versa).
        const updatePayload: Record<string, any> = {
          start_date: state.startDate,
          end_date: state.endDate,
          issue_date: state.issueDate || state.startDate,
          insurance_price: price,
          payed_for_company: companyPayment,
          profit,
          office_commission: effectiveType === 'ELZAMI'
            ? (parseFloat(state.officeCommission) || 0)
            : 0,
          notes: state.notes || null,
          // One broker for the whole package — applied to every row.
          broker_id: packageBrokerId === NO_BROKER ? null : packageBrokerId,
          is_under_24: clientUnder24,
          updated_at: new Date().toISOString(),
        };

        // Stamp newly-created package id onto the existing single policy
        // when the user just promoted it into a package.
        if (isSingleMode && effectiveGroupId && policy.group_id !== effectiveGroupId) {
          updatePayload.group_id = effectiveGroupId;
        }

        if (effectiveType !== policy.policy_type_parent) {
          updatePayload.policy_type_parent = effectiveType as Enums<"policy_type_parent">;
        }
        if (effectiveType === 'THIRD_FULL') {
          updatePayload.policy_type_child = effectiveChild as Enums<"policy_type_child"> | null;
        } else if (effectiveType !== policy.policy_type_parent) {
          updatePayload.policy_type_child = null;
        }

        if (effectiveType === 'ROAD_SERVICE') {
          updatePayload.road_service_id = selectedId || null;
          updatePayload.accident_fee_service_id = null;
          // Persist the insurer chosen in the new "شركة التأمين"
          // select — printed invoice joins on company_id so leaving
          // it null was rendering "-" for the insurer column.
          updatePayload.company_id = state.insuranceCompanyId || null;
        } else if (effectiveType === 'ACCIDENT_FEE_EXEMPTION') {
          updatePayload.accident_fee_service_id = selectedId || null;
          updatePayload.road_service_id = null;
          updatePayload.company_id = state.insuranceCompanyId || null;
        } else {
          updatePayload.company_id = selectedId || null;
          updatePayload.road_service_id = null;
          updatePayload.accident_fee_service_id = null;
        }

        const { error } = await supabase
          .from("policies")
          .update(updatePayload)
          .eq("id", policy.id);

        if (error) throw error;
      }

      // 6. Insert any new addon policies the user enabled in the
      // package builder. Mirrors the wizard's addon-insert flow but
      // inherits client/car/branch/age band from the existing package
      // (or the freshly-promoted single policy).
      if (enabledAddons.length > 0) {
        const { data: { user } } = await supabase.auth.getUser();
        const ageBand: Enums<"age_band"> = clientUnder24 ? "UNDER_24" : "UP_24";
        const carTypeForCalc = (carType || "car") as Enums<"car_type">;
        const addonTypeMap: Record<PackageAddon['type'], Enums<"policy_type_parent">> = {
          elzami: 'ELZAMI',
          third_full: 'THIRD_FULL',
          road_service: 'ROAD_SERVICE',
          accident_fee_exemption: 'ACCIDENT_FEE_EXEMPTION',
        };

        for (const addon of enabledAddons) {
          const addonTypeParent = addonTypeMap[addon.type];
          const addonTypeChild = addon.type === 'third_full' && addon.policy_type_child
            ? (addon.policy_type_child as Enums<"policy_type_child">)
            : null;
          const addonInsurancePrice = parseFloat(addon.insurance_price) || 0;

          const profitData = await calculatePolicyProfit({
            policyTypeParent: addonTypeParent,
            policyTypeChild: addonTypeChild,
            companyId: addon.company_id || '',
            carType: carTypeForCalc,
            ageBand,
            carValue,
            carYear,
            insurancePrice: addonInsurancePrice,
            roadServiceId: addon.road_service_id || null,
            accidentFeeServiceId: addon.accident_fee_service_id || null,
          });

          const { error: addonError } = await supabase.from('policies').insert({
            client_id: clientId,
            car_id: carId || null,
            category_id: null,
            policy_type_parent: addonTypeParent,
            policy_type_child: addonTypeChild,
            // Match the wizard: save company_id for ALL addon types
            // including road_service / accident_fee. The printed package
            // invoice joins insurance_companies via company_id and would
            // render "-" for the insurer column without it. The in-app
            // PackageComponentsTable still prefers road_services /
            // accident_fee_services for the badge label, so keeping both
            // satisfies every consumer.
            company_id: addon.company_id || null,
            start_date: addon.start_date || null,
            end_date: addon.end_date || null,
            issue_date: addon.start_date || null,
            insurance_price: addonInsurancePrice,
            profit: profitData.profit,
            payed_for_company: profitData.companyPayment,
            company_cost_snapshot: profitData.companyPayment,
            road_service_id: addon.road_service_id || null,
            accident_fee_service_id: addon.accident_fee_service_id || null,
            office_commission: addon.type === 'elzami' ? parseFloat(addon.office_commission || '0') || 0 : 0,
            group_id: effectiveGroupId,
            is_under_24: clientUnder24,
            notes: 'إضافة ضمن باقة',
            branch_id: branchId || null,
            created_by_admin_id: user?.id || null,
          } as never);

          if (addonError) throw addonError;
        }
      }

      toast({
        title: "تم الحفظ",
        description: isSingleMode && enabledAddons.length === 0
          ? "تم تحديث المعاملة بنجاح"
          : "تم تحديث المعاملات بنجاح",
      });
      // Trigger the same print/SMS dialog the wizard shows after a new
      // package is created. PolicySuccessDialog resolves the rest of the
      // group via group_id, so any policy id from the package works.
      const anchorPolicyId = policies[0]?.id || null;
      if (anchorPolicyId) {
        setSuccessPolicyId(anchorPolicyId);
        // Treat as package whenever there are siblings or the user just
        // promoted a single into a package via addons.
        setSuccessIsPackage(!!effectiveGroupId);
        setShowSuccessDialog(true);
      } else {
        onOpenChange(false);
        onSaved?.();
      }
    } catch (error) {
      console.error("Error saving policies:", error);
      toast({
        title: "خطأ",
        description: "فشل في حفظ التغييرات",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!groupId && !policyId) return null;

  const titleText = 'تعديل المعاملة';
  const totalLabel = isSingleMode ? 'إجمالي' : 'إجمالي الباقة';
  const saveLabel = isSingleMode ? 'حفظ' : 'حفظ جميع التغييرات';
  const emptyText = isSingleMode ? 'لم يتم العثور على المعاملة' : 'لا توجد معاملات في هذه الباقة';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden !flex !flex-col p-6" dir="rtl">
        <DialogHeader className="text-right shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-primary/10">
              <Package className="h-4 w-4 text-primary" />
            </div>
            <div>
              <span>{titleText}</span>
              {clientName && (
                <span className="text-muted-foreground font-normal mr-2">
                  - {clientName}
                </span>
              )}
              {carNumber && (
                <span className="font-mono text-muted-foreground font-normal mr-1 ltr-nums">
                  ({carNumber})
                </span>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : policies.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Native overflow-y-auto — radix ScrollArea was swallowing
                wheel events inside the package builder cards on some
                browsers, leaving the modal effectively unscrollable
                once an addon was enabled. */}
            <div dir="rtl" className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
              <div className="space-y-2 py-1">
                {/* Single broker for the whole package — applied to
                    every row on save. Replaces the per-row broker
                    select that used to live inside each card. */}
                <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/30 border">
                  <Label className="text-sm font-semibold shrink-0">الوسيط للباقة</Label>
                  <Select
                    value={packageBrokerId}
                    onValueChange={setPackageBrokerId}
                  >
                    <SelectTrigger className="h-9 text-sm bg-background flex-1">
                      <SelectValue placeholder="بدون وسيط" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_BROKER}>بدون وسيط</SelectItem>
                      {brokers.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {policies.map((policy) => {
                  const state = editStates[policy.id];
                  // The effective type drives icon / color / options —
                  // fall back to the stored type when state hasn't loaded
                  // yet (first render before fetchPolicies resolves).
                  const effectiveType = state?.policyType || policy.policy_type_parent;
                  const config = policyTypeConfig[effectiveType] || policyTypeConfig.ELZAMI;
                  const Icon = config.icon;
                  const isServiceRow = effectiveType === 'ROAD_SERVICE' || effectiveType === 'ACCIDENT_FEE_EXEMPTION';

                  const companyOptions = getCompanyOptions(effectiveType);
                  const companyLabel = effectiveType === 'ROAD_SERVICE'
                    ? 'الخدمة'
                    : effectiveType === 'ACCIDENT_FEE_EXEMPTION'
                      ? 'الخدمة'
                      : 'شركة التأمين';

                  return (
                    <div
                      key={policy.id}
                      className={cn(
                        "rounded-xl border p-3 space-y-3",
                        config.border,
                        config.bg,
                      )}
                    >
                      {/* Header */}
                      <div className="flex items-center gap-2">
                        <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center bg-white/70 border", config.border)}>
                          <Icon className={cn("h-4 w-4", config.text)} />
                        </div>
                        <Badge className={cn("text-xs font-bold", config.bg, config.text, "border", config.border)}>
                          {policyTypeLabels[effectiveType] || effectiveType}
                          {effectiveType === 'THIRD_FULL' && state?.policyTypeChild
                            ? ` - ${policyChildLabels[state.policyTypeChild] || state.policyTypeChild}`
                            : ''}
                        </Badge>
                      </div>

                      {/* Type switcher: full type list in single mode, restricted
                          ROAD↔ACCIDENT switch otherwise (changing e.g. THIRD_FULL
                          → ELZAMI inside a package would create duplicates / break
                          tariff math, so it stays locked there). */}
                      {isSingleMode ? (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs font-semibold text-foreground/80">نوع المعاملة</Label>
                            <Select
                              value={effectiveType}
                              onValueChange={(v) => {
                                updateEditState(policy.id, 'policyType', v);
                                // Sub-type and company depend on the type, so wipe
                                // them whenever the type flips.
                                updateEditState(policy.id, 'policyTypeChild', '');
                                updateEditState(policy.id, 'companyId', '');
                              }}
                            >
                              <SelectTrigger className="h-9 text-sm bg-background">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ELZAMI">إلزامي</SelectItem>
                                <SelectItem value="THIRD_FULL">ثالث/شامل</SelectItem>
                                <SelectItem value="ROAD_SERVICE">خدمات الطريق</SelectItem>
                                <SelectItem value="ACCIDENT_FEE_EXEMPTION">إعفاء رسوم حادث</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {effectiveType === 'THIRD_FULL' && (
                            <div className="space-y-1">
                              <Label className="text-xs font-semibold text-foreground/80">النوع الفرعي</Label>
                              <Select
                                value={state?.policyTypeChild || ''}
                                onValueChange={(v) => updateEditState(policy.id, 'policyTypeChild', v)}
                              >
                                <SelectTrigger className="h-9 text-sm bg-background">
                                  <SelectValue placeholder="اختر..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="THIRD">طرف ثالث</SelectItem>
                                  <SelectItem value="FULL">شامل</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      ) : (
                        isServiceRow && (
                          <div className="space-y-1">
                            <Label className="text-xs font-semibold text-foreground/80">نوع الخدمة</Label>
                            <Select
                              value={effectiveType}
                              onValueChange={(v) => {
                                updateEditState(policy.id, 'policyType', v);
                                // Reset the selected service id whenever the
                                // type flips — the id belongs to a different
                                // table and would otherwise be invalid.
                                updateEditState(policy.id, 'companyId', '');
                              }}
                            >
                              <SelectTrigger className="h-9 text-sm bg-background">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ROAD_SERVICE">خدمات الطريق</SelectItem>
                                <SelectItem value="ACCIDENT_FEE_EXEMPTION">إعفاء رسوم حادث</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )
                      )}

                      {/* For service rows the second column holds the
                          insurance company picker (the printed invoice
                          joins on company_id). For other types the
                          row is just a single company select since the
                          broker now lives in the package-level header. */}
                      {isServiceRow ? (
                        (() => {
                          const insuranceList = effectiveType === 'ROAD_SERVICE'
                            ? pkgRoadServiceCompanies
                            : pkgAccidentFeeCompanies;
                          return (
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <Label className="text-xs font-semibold text-foreground/80">{companyLabel}</Label>
                                <Select
                                  value={state?.companyId || ''}
                                  onValueChange={(v) => updateEditState(policy.id, 'companyId', v)}
                                >
                                  <SelectTrigger className="h-9 text-sm bg-background">
                                    <SelectValue placeholder="اختر..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {companyOptions.length === 0 ? (
                                      <div className="px-2 py-1.5 text-xs text-muted-foreground">لا توجد خيارات متاحة</div>
                                    ) : (
                                      companyOptions.map((opt) => (
                                        <SelectItem key={opt.id} value={opt.id}>
                                          {opt.label}
                                        </SelectItem>
                                      ))
                                    )}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs font-semibold text-foreground/80">شركة التأمين</Label>
                                <Select
                                  value={state?.insuranceCompanyId || ''}
                                  onValueChange={(v) => updateEditState(policy.id, 'insuranceCompanyId', v)}
                                >
                                  <SelectTrigger className="h-9 text-sm bg-background">
                                    <SelectValue placeholder="اختر..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {insuranceList.length === 0 ? (
                                      <div className="px-2 py-1.5 text-xs text-muted-foreground">لا توجد شركات</div>
                                    ) : (
                                      insuranceList.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>
                                          {c.name_ar || c.name}
                                        </SelectItem>
                                      ))
                                    )}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold text-foreground/80">{companyLabel}</Label>
                          <Select
                            value={state?.companyId || ''}
                            onValueChange={(v) => updateEditState(policy.id, 'companyId', v)}
                          >
                            <SelectTrigger className="h-9 text-sm bg-background">
                              <SelectValue placeholder="اختر..." />
                            </SelectTrigger>
                            <SelectContent>
                              {companyOptions.length === 0 ? (
                                <div className="px-2 py-1.5 text-xs text-muted-foreground">لا توجد خيارات متاحة</div>
                              ) : (
                                companyOptions.map((opt) => (
                                  <SelectItem key={opt.id} value={opt.id}>
                                    {opt.label}
                                  </SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {/* Dates + Price */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold text-foreground/80">تاريخ الإصدار</Label>
                          <ArabicDatePicker
                            value={state?.issueDate || ""}
                            onChange={(v) => updateEditState(policy.id, "issueDate", v)}
                            compact
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold text-foreground/80">تاريخ البدء</Label>
                          <ArabicDatePicker
                            value={state?.startDate || ""}
                            onChange={(v) => updateEditState(policy.id, "startDate", v)}
                            compact
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold text-foreground/80">تاريخ الانتهاء</Label>
                          <ArabicDatePicker
                            value={state?.endDate || ""}
                            onChange={(v) => updateEditState(policy.id, "endDate", v)}
                            compact
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold text-foreground/80">السعر (₪)</Label>
                          <Input
                            type="number"
                            value={state?.insurancePrice || "0"}
                            onChange={(e) => updateEditState(policy.id, "insurancePrice", e.target.value)}
                            className="h-9 text-left ltr-nums text-sm font-semibold bg-background"
                            min="0"
                          />
                        </div>
                      </div>

                      {/* Office commission — only meaningful for ELZAMI rows. */}
                      {effectiveType === 'ELZAMI' && (
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold text-amber-600">عمولة للمكتب (₪)</Label>
                          <Input
                            type="number"
                            value={state?.officeCommission || "0"}
                            onChange={(e) => updateEditState(policy.id, "officeCommission", e.target.value)}
                            className="h-9 text-left ltr-nums text-sm bg-background"
                            placeholder="0"
                          />
                          <p className="text-[11px] text-muted-foreground">تدخل في حساب العميل كدين</p>
                        </div>
                      )}

                      {/* Notes */}
                      <div className="space-y-1">
                        <Label className="text-xs font-semibold text-foreground/80">ملاحظات</Label>
                        <Textarea
                          value={state?.notes || ""}
                          onChange={(e) => updateEditState(policy.id, 'notes', e.target.value)}
                          rows={2}
                          className="text-sm bg-background"
                        />
                      </div>
                    </div>
                  );
                })}

                {/* Modal-level under-24 control. Lives outside the per-card
                    grid because it's a client property — applies to every
                    policy in the modal, package or single. */}
                {clientId && (
                  <div className="space-y-2 p-3 bg-muted/30 rounded-lg border">
                    <Label className="text-sm font-semibold">أقل من 24 سنة</Label>
                    <RadioGroup
                      value={under24Type === 'additional_driver' ? 'client' : under24Type}
                      onValueChange={(v: 'none' | 'client') => setUnder24Type(v)}
                      className="flex flex-col gap-2"
                      dir="rtl"
                    >
                      <div dir="rtl" className="flex items-center gap-2">
                        <RadioGroupItem value="none" id={`under24_none_${policyId || groupId || 'modal'}`} />
                        <Label htmlFor={`under24_none_${policyId || groupId || 'modal'}`} className="cursor-pointer text-sm">لا</Label>
                      </div>
                      <div dir="rtl" className="flex items-center gap-2">
                        <RadioGroupItem value="client" id={`under24_client_${policyId || groupId || 'modal'}`} />
                        <Label htmlFor={`under24_client_${policyId || groupId || 'modal'}`} className="cursor-pointer text-sm">نعم – العميل أقل من 24</Label>
                      </div>
                    </RadioGroup>
                  </div>
                )}

                {/* Package additions — show cards only for addon types
                    that aren't already in the package, so the user can
                    extend an existing باقة without leaving the modal. */}
                {(() => {
                  const existingTypeMap: Record<string, PackageAddon['type']> = {
                    ELZAMI: 'elzami',
                    THIRD_FULL: 'third_full',
                    ROAD_SERVICE: 'road_service',
                    ACCIDENT_FEE_EXEMPTION: 'accident_fee_exemption',
                  };
                  const existingAddonTypes = policies
                    .map((p) => existingTypeMap[(editStates[p.id]?.policyType || p.policy_type_parent) as string])
                    .filter(Boolean) as PackageAddon['type'][];
                  // PackageBuilderSection's ELZAMI ↔ THIRD_FULL toggle is
                  // gated by mainPolicyType. THIRD_FULL beats ELZAMI as
                  // "main" since it's the one that anchors the package
                  // (drivers, broker) in the wizard too.
                  const mainPolicyType = existingAddonTypes.includes('third_full')
                    ? 'THIRD_FULL'
                    : existingAddonTypes.includes('elzami')
                      ? 'ELZAMI'
                      : 'THIRD_FULL';
                  const mainPolicy = policies.find((p) => p.policy_type_parent === mainPolicyType) || policies[0];
                  const mainState = mainPolicy ? editStates[mainPolicy.id] : null;
                  const mainStartDate = mainState?.startDate || mainPolicy?.start_date || '';
                  const mainEndDate = mainState?.endDate || mainPolicy?.end_date || '';
                  const allFour: PackageAddon['type'][] = ['elzami', 'third_full', 'road_service', 'accident_fee_exemption'];
                  const missing = allFour.filter((t) => !existingAddonTypes.includes(t));
                  if (missing.length === 0) return null;
                  return (
                    <div ref={addonSectionRef} className="space-y-2 p-3 bg-muted/20 rounded-lg border border-dashed">
                      <PackageBuilderSection
                        addons={packageAddons}
                        onAddonsChange={setPackageAddons}
                        mainPolicyType={mainPolicyType}
                        mainStartDate={mainStartDate}
                        mainEndDate={mainEndDate}
                        roadServices={pkgRoadServices}
                        accidentFeeServices={pkgAccidentFeeServices}
                        roadServiceCompanies={pkgRoadServiceCompanies}
                        accidentFeeCompanies={pkgAccidentFeeCompanies}
                        elzamiCompanies={pkgElzamiCompanies}
                        thirdFullCompanies={pkgThirdFullCompanies}
                        carType={carType || undefined}
                        ageBand={under24Type !== 'none' ? 'UNDER_24' : 'UP_24'}
                        hideTypes={existingAddonTypes}
                      />
                    </div>
                  );
                })()}

                {/* Extra Drivers Section */}
                {clientId && (
                  <div className="space-y-2 p-2 bg-muted/30 rounded-lg border">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-2">
                        <User className="h-3.5 w-3.5" />
                        السائقين الإضافيين / التابعين
                      </h4>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleAddNewChild}
                        className="gap-1 h-7 text-xs"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        إضافة جديد
                      </Button>
                    </div>

                    {/* Existing Children - Checkboxes */}
                    {existingChildren.length > 0 && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">اختر من التابعين الموجودين:</Label>
                        <div className="grid gap-1">
                          {existingChildren.map((child) => (
                            <label
                              key={child.id}
                              className={cn(
                                "flex items-center gap-2 p-1.5 rounded-md border cursor-pointer transition-colors",
                                selectedChildIds.includes(child.id)
                                  ? "bg-primary/10 border-primary"
                                  : "bg-background hover:bg-muted/50"
                              )}
                            >
                              <Checkbox
                                checked={selectedChildIds.includes(child.id)}
                                onCheckedChange={() => toggleChild(child.id)}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm flex items-center gap-2">
                                  {child.full_name}
                                  {isUnder24(child.birth_date) === true && (
                                    <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-700 border-amber-500/30">
                                      أقل من 24
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                                  <span className="font-mono ltr-nums">{child.id_number}</span>
                                  {child.relation && <span>• {child.relation}</span>}
                                  {child.birth_date && (
                                    <span className="flex items-center gap-1">
                                      <Calendar className="h-3 w-3" />
                                      <span className="ltr-nums">{formatBirthDate(child.birth_date)}</span>
                                    </span>
                                  )}
                                  {child.phone && (
                                    <ClickablePhone phone={child.phone} />
                                  )}
                                </div>
                              </div>
                              {selectedChildIds.includes(child.id) && (
                                <Check className="h-3.5 w-3.5 text-primary" />
                              )}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* New Children Forms */}
                    {newChildren.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">تابعين جدد (سيتم إضافتهم للعميل):</Label>
                        {newChildren.map((child, index) => {
                          const errors = childErrors[child.id] || {};
                          const isLast = index === newChildren.length - 1;

                          return (
                            <div
                              key={child.id}
                              className="p-2 rounded-lg border bg-background space-y-2"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-muted-foreground">
                                  سائق جديد #{index + 1}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 text-xs text-destructive hover:text-destructive px-2"
                                  onClick={() => handleRemoveNewChild(index)}
                                >
                                  حذف
                                </Button>
                              </div>

                              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
                                {/* Full Name */}
                                <div className="space-y-0.5">
                                  <Label className="text-xs">
                                    الاسم <span className="text-destructive">*</span>
                                  </Label>
                                  <Input
                                    value={child.full_name}
                                    onChange={(e) => handleUpdateNewChild(index, 'full_name', e.target.value)}
                                    placeholder="الاسم الكامل"
                                    className={cn("h-8 text-sm", errors.full_name && "border-destructive")}
                                    autoFocus={isLast}
                                  />
                                  {errors.full_name && (
                                    <p className="text-xs text-destructive">{errors.full_name}</p>
                                  )}
                                </div>

                                {/* ID Number */}
                                <div className="space-y-0.5">
                                  <Label className="text-xs">
                                    رقم الهوية <span className="text-destructive">*</span>
                                  </Label>
                                  <Input
                                    value={child.id_number}
                                    onChange={(e) => handleUpdateNewChild(index, 'id_number', digitsOnly(e.target.value).slice(0, 9))}
                                    placeholder="9 أرقام"
                                    maxLength={9}
                                    className={cn("h-8 text-sm ltr-input", errors.id_number && "border-destructive")}
                                  />
                                  {errors.id_number && (
                                    <p className="text-xs text-destructive">{errors.id_number}</p>
                                  )}
                                </div>

                                {/* Relation */}
                                <div className="space-y-0.5">
                                  <Label className="text-xs">الصلة</Label>
                                  <Select
                                    value={child.relation}
                                    onValueChange={(v) => handleUpdateNewChild(index, 'relation', v)}
                                  >
                                    <SelectTrigger className="h-8 text-sm">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {RELATION_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                          {opt.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>

                                {/* Birth Date */}
                                <div className="space-y-0.5">
                                  <Label className="text-xs">تاريخ الميلاد</Label>
                                  <ArabicDatePicker
                                    value={child.birth_date}
                                    onChange={(v) => handleUpdateNewChild(index, 'birth_date', v)}
                                    isBirthDate
                                    compact
                                  />
                                </div>

                                {/* Phone */}
                                <div className="space-y-0.5">
                                  <Label className="text-xs">الهاتف</Label>
                                  <Input
                                    value={child.phone}
                                    onChange={(e) => handleUpdateNewChild(index, 'phone', digitsOnly(e.target.value).slice(0, 10))}
                                    placeholder="05xxxxxxxx"
                                    maxLength={10}
                                    inputMode="numeric"
                                    className="h-8 text-sm ltr-input"
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        <div ref={newChildBottomRef} />
                      </div>
                    )}

                    {existingChildren.length === 0 && newChildren.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-1">
                        لا يوجد تابعين لهذا العميل. اضغط "إضافة جديد" لإضافة سائق إضافي.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Total Summary */}
            <div className="shrink-0 border-t pt-3 mt-1">
              <div className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calculator className="h-4 w-4" />
                  <span className="font-medium text-sm">{totalLabel}</span>
                </div>
                <div className="text-xl font-bold text-primary ltr-nums">
                  {formatCurrency(calculateTotal())}
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 shrink-0 pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            <X className="h-4 w-4 ml-1" />
            إلغاء
          </Button>
          <Button onClick={handleSaveAll} disabled={saving || loading || policies.length === 0}>
            {saving ? (
              <Loader2 className="h-4 w-4 ml-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 ml-1" />
            )}
            {saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Post-save print/SMS dialog — shares the exact component the
          new-policy wizard uses. Closing it also closes the edit modal
          and notifies the parent so it can refresh its policy list. */}
      {successPolicyId && clientId && (
        <PolicySuccessDialog
          open={showSuccessDialog}
          onOpenChange={setShowSuccessDialog}
          policyId={successPolicyId}
          clientId={clientId}
          clientPhone={clientPhone}
          isPackage={successIsPackage}
          // Edit flow doesn't add new payments — the receipt action
          // already lives in the package / payments screen for any
          // existing rows, so we hide it here.
          receiptPaymentIds={[]}
          onClose={() => {
            setShowSuccessDialog(false);
            setSuccessPolicyId(null);
            onOpenChange(false);
            onSaved?.();
          }}
        />
      )}
    </Dialog>
  );
}
