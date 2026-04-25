import { ColumnOption } from './ManageColumnsDropdown';

export const COMPANY_ISSUANCE_COLUMNS: ColumnOption[] = [
  { key: 'row_number', label: '#' },
  { key: 'document_number', label: 'رقم المعاملة', required: true },
  { key: 'receipts', label: 'سندات القبض' },
  { key: 'client_name', label: 'العميل' },
  { key: 'client_id_number', label: 'رقم هوية العميل' },
  { key: 'client_phone', label: 'رقم الهاتف' },
  { key: 'issue_date', label: 'تاريخ الإصدار' },
  { key: 'start_date', label: 'بدء التأمين' },
  { key: 'end_date', label: 'نهاية التأمين' },
  { key: 'car_number', label: 'رقم السيارة' },
  { key: 'car_value', label: 'سعر السيارة' },
  { key: 'payment_method', label: 'طريقة الدفع' },
  { key: 'company_name', label: 'شركة التأمين' },
  { key: 'policy_type', label: 'نوع التأمين' },
  { key: 'payed_for_company', label: 'المستحق للشركة' },
  { key: 'profit', label: 'الربح / العمولة' },
  { key: 'insurance_price', label: 'سعر التأمين' },
  { key: 'actions', label: 'إجراءات', required: true },
];

export const BROKER_ISSUANCE_COLUMNS: ColumnOption[] = [
  { key: 'row_number', label: '#' },
  { key: 'document_number', label: 'رقم المعاملة', required: true },
  { key: 'receipts', label: 'سندات القبض' },
  { key: 'client_name', label: 'العميل' },
  { key: 'client_id_number', label: 'رقم هوية العميل' },
  { key: 'client_phone', label: 'رقم الهاتف' },
  { key: 'issue_date', label: 'تاريخ الإصدار' },
  { key: 'start_date', label: 'بدء التأمين' },
  { key: 'end_date', label: 'نهاية التأمين' },
  { key: 'car_number', label: 'رقم السيارة' },
  { key: 'car_value', label: 'سعر السيارة' },
  { key: 'payment_method', label: 'طريقة الدفع' },
  { key: 'company_name', label: 'الوسيط / الشركة' },
  { key: 'policy_type', label: 'نوع التأمين' },
  { key: 'broker_buy_price', label: 'سعر الشراء من الوسيط' },
  { key: 'insurance_price', label: 'سعر البيع للعميل' },
  { key: 'profit', label: 'الربح' },
  { key: 'actions', label: 'إجراءات', required: true },
];

export const ISSUANCE_DEFAULT_OFF = new Set(['client_id_number', 'client_phone']);

export const SETTLEMENT_COLUMNS: ColumnOption[] = [
  { key: 'date', label: 'التاريخ', required: true },
  { key: 'entity', label: 'الجهة', required: true },
  { key: 'amount', label: 'المبلغ', required: true },
  { key: 'payment_type', label: 'طريقة الدفع' },
  { key: 'cheque_number', label: 'رقم الشيك' },
  { key: 'cheque_image', label: 'المرفق' },
  { key: 'direction', label: 'الاتجاه' },
  { key: 'status', label: 'الحالة' },
  { key: 'notes', label: 'ملاحظات' },
];

export const SETTLEMENT_DEFAULT_OFF = new Set(['notes']);
