import { supabase } from '@/integrations/supabase/client';
import type { PaymentLine, SettlementKind, SettlementMode } from './AddSettlementDialog';

interface PersistArgs {
  mode: SettlementMode;
  kind: SettlementKind;
  entityId: string;
  /** Display name of the entity (broker/company/client). Used by the
   *  broker path to fill receipts.client_name so the row reads
   *  naturally on /receipts (which renders client_name as the
   *  "العميل / الجهة" column). The legacy column name is a
   *  historical artefact — it's just "counterparty display" now. */
  entityName?: string | null;
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
 *
 * Returns the IDs of every settlement row created plus the shared
 * settlement_session_id (when mode === 'client' with at least one line).
 * Callers that need to surface the auto-mirrored receipts row (e.g. the
 * post-cancel "send سند صرف" dialog) use these to look up the matching
 * receipts.id without re-querying by timestamp.
 */
export interface PersistSettlementResult {
  settlementIds: string[];
  clientSettlementSessionId: string | null;
  /** Set when the broker mirror landed — the caller (/receipts wizard)
   *  uses it to open the post-save print/SMS dialog. NULL for client/
   *  company modes (no mirror) and for broker saves that bailed mid-
   *  flight (settlementIds populated but mirror INSERT failed). */
  brokerReceiptId?: string | null;
}
export async function persistSettlementLines(
  args: PersistArgs,
): Promise<PersistSettlementResult> {
  const {
    mode,
    kind,
    entityId,
    entityName,
    policyId,
    branchId,
    effective,
    notes,
    userId,
    agentId,
  } = args;

  // Multi-line client disbursements share one settlement_session_id so
  // the BEFORE INSERT trigger reuses a single D{nn}/YYYY voucher across
  // all lines instead of allocating a new number per row.
  const clientSettlementSessionId =
    mode === 'client' && effective.length > 0 ? crypto.randomUUID() : null;

  const settlementIds: string[] = [];

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

    if (settlementId) settlementIds.push(settlementId);
  }

  // Broker mirror — surface the new voucher on /receipts. We create
  // ONE receipts row per save (regardless of how many lines), summing
  // the amounts and tagging the row with the broker. Multi-method
  // saves (cheque + cash + …) collapse into payment_method='multiple'
  // so the receipts table's payment-method filter has something
  // unambiguous to match. Disbursements get a D{nn}/{year} voucher
  // number from the shared allocator; incoming receipts leave
  // voucher_number NULL and let the table's serial receipt_number
  // surface as R{n}/{year} via the page's formatter.
  let brokerReceiptId: string | null = null;
  if (mode === 'broker' && settlementIds.length > 0 && effective.length > 0) {
    const totalAmount = effective.reduce(
      (sum, line) => sum + Number(line.amount || 0),
      0,
    );
    const uniqueMethods = Array.from(new Set(effective.map((l) => l.payment_type)));
    const paymentMethodForReceipt =
      uniqueMethods.length === 1 ? uniqueMethods[0] : 'multiple';
    const firstChequeNumber = effective.find((l) => l.payment_type === 'cheque')
      ?.cheque_number ?? null;
    const todayIso = new Date().toISOString().split('T')[0];

    let voucherNumber: string | null = null;
    if (kind === 'disbursement' && agentId) {
      const year = new Date(todayIso).getFullYear();
      const { data: allocatedNum } = await supabase.rpc(
        'allocate_disbursement_number',
        { p_agent_id: agentId, p_year: year } as never,
      );
      if (typeof allocatedNum === 'string') voucherNumber = allocatedNum;
    }

    const { data: receiptRow, error: receiptErr } = await supabase
      .from('receipts')
      .insert({
        receipt_type: kind === 'disbursement' ? 'disbursement' : 'payment',
        source: 'auto',
        voucher_number: voucherNumber,
        client_id: null,
        client_name: entityName ?? 'وسيط',
        broker_id: entityId,
        broker_settlement_id: settlementIds[0],
        amount: totalAmount,
        receipt_date: todayIso,
        payment_method: paymentMethodForReceipt,
        cheque_number: firstChequeNumber,
        notes: notes || null,
        agent_id: agentId,
        branch_id: branchId ?? null,
        created_by: userId,
      } as never)
      .select('id')
      .single();
    if (receiptErr) {
      // Non-fatal: settlements are already in. Log + continue; caller
      // can detect the missing brokerReceiptId in the result and
      // toast accordingly without rolling back accounting state.
      console.error('[persistSettlementLines] broker mirror failed:', receiptErr);
    } else if (receiptRow) {
      brokerReceiptId = (receiptRow as { id: string }).id;
    }
  }

  return { settlementIds, clientSettlementSessionId, brokerReceiptId };
}
