// Cheque Number Validation Utilities

export const CHEQUE_NUMBER_MAX_LENGTH = 10;

/**
 * Validates a cheque number
 * - Must contain only digits
 * - Must not be empty
 * - Must not exceed max length
 */
export function validateChequeNumber(value: string): {
  isValid: boolean;
  error: string | null;
  sanitized: string;
} {
  // Remove non-digits
  const sanitized = value.replace(/\D/g, '');
  
  if (!sanitized) {
    return {
      isValid: false,
      error: 'رقم الشيك مطلوب',
      sanitized: '',
    };
  }
  
  if (sanitized.length > CHEQUE_NUMBER_MAX_LENGTH) {
    return {
      isValid: false,
      error: `رقم الشيك يجب ألا يتجاوز ${CHEQUE_NUMBER_MAX_LENGTH} أرقام`,
      sanitized: sanitized.slice(0, CHEQUE_NUMBER_MAX_LENGTH),
    };
  }
  
  return {
    isValid: true,
    error: null,
    sanitized,
  };
}

/**
 * Sanitizes cheque number input (removes non-digits, enforces max length)
 */
export function sanitizeChequeNumber(value: string): string {
  return value.replace(/\D/g, '').slice(0, CHEQUE_NUMBER_MAX_LENGTH);
}

/**
 * Determines cheque status based on payment date
 * - If payment_date has passed and status is pending -> should be 'cashed'
 * - Else keep the current status
 */
export function getEffectiveChequeStatus(
  paymentDate: string,
  currentStatus: string | null
): string {
  // If already cashed, returned, cancelled, or transferred_out - keep it
  if (currentStatus === 'cashed' || currentStatus === 'returned' || currentStatus === 'cancelled' || currentStatus === 'transferred_out') {
    return currentStatus;
  }
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const chequeDate = new Date(paymentDate);
  chequeDate.setHours(0, 0, 0, 0);
  
  // If cheque date has passed, it should be considered 'cashed'
  if (chequeDate <= today) {
    return 'cashed';
  }
  
  return currentStatus || 'pending';
}

/**
 * Checks if a cheque is overdue (pending and date has passed)
 * transferred_out cheques are never overdue (they're not AB's responsibility)
 */
export function isChequeOverdue(paymentDate: string, status: string | null): boolean {
  if (status === 'cashed' || status === 'returned' || status === 'cancelled' || status === 'transferred_out') {
    return false;
  }
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const chequeDate = new Date(paymentDate);
  chequeDate.setHours(0, 0, 0, 0);
  
  return chequeDate < today && (status === 'pending' || !status);
}
