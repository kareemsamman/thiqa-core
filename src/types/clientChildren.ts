// Types for Client Children / Additional Drivers

export interface ClientChild {
  id: string;
  client_id: string;
  full_name: string;
  id_number: string;
  birth_date: string | null;
  phone: string | null;
  relation: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PolicyChild {
  id: string;
  policy_id: string;
  child_id: string;
  child?: ClientChild;
  created_at?: string;
}

export interface NewChildForm {
  id: string; // temp ID for UI tracking
  full_name: string;
  id_number: string;
  birth_date: string;
  phone: string;
  relation: string;
  notes: string;
}

export const RELATION_OPTIONS = [
  { value: 'ابن', label: 'ابن' },
  { value: 'ابنة', label: 'ابنة' },
  { value: 'زوج', label: 'زوج' },
  { value: 'زوجة', label: 'زوجة' },
  { value: 'سائق إضافي', label: 'سائق إضافي' },
  { value: 'أخرى', label: 'أخرى' },
] as const;

export const createEmptyChildForm = (): NewChildForm => ({
  id: crypto.randomUUID(),
  full_name: '',
  id_number: '',
  birth_date: '',
  phone: '',
  relation: 'سائق إضافي',
  notes: '',
});
