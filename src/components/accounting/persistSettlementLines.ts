import { supabase } from '@/integrations/supabase/client';
import type { PaymentLine, SettlementKind, SettlementMode } from './AddSettlementDialog';

interface PersistArgs {
  mode: SettlementMode;
  kind: SettlementKind;
  entityId: string;
  policyId?: string | null;
  branchId?: string | null;
  /** Lines that already passed the dialog's validation loop. */
  effective: PaymentLine[];
  notes: string;
  userId: string | null;
  agentId: string | null;
}

/**
 * Shared writer for company/broker/client settlement lines. Lives outside
 * AddSettlementDialog so the cancel/transfer modals can stage payment
 * lines in memory and persist them atomically at confirm time — keeping
 * the DB-shape logic in one place instead of duplicating it.
 */
export async function persistSettlementLines(args: PersistArgs): Promise<void> {
  const { mode, kind, entityId, policyId, branchId, effective, notes, userId, agentId } = args;

  // Multi-line client disbursements share one settlement_session_id so
  // the BEFORE INSERT trigger reuses a single D{nn}/YYYY voucher across
  // all lines instead of allocating a new number per row.
  const clientSettlementSessionId =
    mode === 'client' && effective.length > 0 ? crypto.randomUUID() : null;

  for (const line of effective) {
    const isCustomerCheque = line.payment_type === 'customer_cheque';
    const customerChequeIds: string[] = isCustomerCheque
      ? (line.selected_cheques ?? []).map((c) => c.id)
      : [];
    const amount = isCustomerCheque
      ? (line.selected_cheques ?? []).reduce((s, c) => s + Number(c.amount || 0), 0)
      : Number(line.amount || 0);

    // Settlement_date: we use the issue date for cheques (when money
    // logically left), and payment_date for everything else. The separate
    // due date is persisted alongside in cheque_due_date.
    const settlementDate =
      line.payment_type === 'cheque'
        ? line.cheque_issue_date ?? line.payment_date
        : line.payment_date;

    const shared = {
      total_amount: amount,
      settlement_date: settlementDate,
      status: 'completed' as const,
      notes: notes || null,
      created_by_admin_id: userId,
      agent_id: agentId,
      payment_type: line.payment_type,
      cheque_number: line.payment_type === 'cheque' ? line.cheque_number ?? null : null,
      bank_code: line.payment_type === 'cheque' ? line.bank_code ?? null : null,
      branch_code: line.payment_type === 'cheque' ? line.branch_code ?? null : null,
      cheque_due_date:
        line.payment_type === 'cheque'
          ? line.cheque_due_date ?? line.cheque_issue_date ?? settlementDate
          : null,
      cheque_issue_date:
        line.payment_type === 'cheque' ? line.cheque_issue_date ?? settlementDate : null,
      cheque_image_url:
        line.payment_type === 'cheque' ? line.cheque_image_urls?.[0] ?? null : null,
      cheque_image_urls:
        line.payment_type === 'cheque' ? line.cheque_image_urls ?? [] : [],
      bank_reference:
        line.payment_type === 'bank_transfer' ? line.bank_reference ?? null : null,
      customer_cheque_ids: customerChequeIds,
      refused: false,
    };

    let settlementId: string | null = null;
    if (mode === 'company') {
      const { data, error } = await supabase
        .from('company_settlements')
        .insert({
          ...shared,
          company_id: entityId,
          direction: kind === 'disbursement' ? 'outgoing' : 'incoming',
        } as never)
        .select('id')
        .single();
      if (error) throw error;
      settlementId = (data as { id: string }).id;
    } else if (mode === 'broker') {
      const { data, error } = await supabase
        .from('broker_settlements')
        .insert({
          ...shared,
          broker_id: entityId,
          direction: kind === 'disbursement' ? 'we_owe' : 'broker_owes',
        } as never)
        .select('id')
        .single();
      if (error) throw error;
      settlementId = (data as { id: string }).id;
    } else {
      // mode === 'client'
      //
      // Disbursement only (the dialog short-circuits 'receipt' at the
      // open path — client payments go through policy_payments). The DB
      // triggers handle voucher_number + receipts mirror automatically;
      // we just send the raw line and let the BEFORE/AFTER triggers do
      // their thing.
      const { data, error } = await supabase
        .from('client_settlements')
        .insert({
          ...shared,
          client_id: entityId,
          policy_id: policyId ?? null,
          branch_id: branchId ?? null,
          settlement_session_id: clientSettlementSessionId,
        } as never)
        .select('id')
        .single();
      if (error) throw error;
      settlementId = (data as { id: string }).id;
    }

    if (isCustomerCheque && customerChequeIds.length > 0 && settlementId) {
      const { error: updateError } = await supabase
        .from('policy_payments')
        .update({
          cheque_status: 'transferred_out',
          transferred_to_type: mode,
          transferred_to_id: entityId,
          transferred_payment_id: settlementId,
          transferred_at: new Date().toISOString(),
        })
        .in('id', customerChequeIds);
      if (updateError) throw updateError;
    }
  }
}
