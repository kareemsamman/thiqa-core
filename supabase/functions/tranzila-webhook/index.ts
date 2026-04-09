import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new globalThis.Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Tranzila sends data as form-encoded or query params
    let data: Record<string, string> = {}
    
    if (req.method === 'POST') {
      const contentType = req.headers.get('content-type') || ''
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await req.formData()
        formData.forEach((value, key) => {
          data[key] = value.toString()
        })
      } else if (contentType.includes('application/json')) {
        data = await req.json()
      } else {
        // Try to parse as form data anyway
        const text = await req.text()
        const params = new URLSearchParams(text)
        params.forEach((value, key) => {
          data[key] = value
        })
      }
    } else if (req.method === 'GET') {
      const url = new URL(req.url)
      url.searchParams.forEach((value, key) => {
        data[key] = value
      })
    }

    console.log('Tranzila webhook received:', JSON.stringify(data))

    // Extract Tranzila response fields
    const {
      myid,           // Our transaction reference (tranzila_index)
      index,          // Tranzila transaction index
    } = data

    // Also check for alternative field names Tranzila might use
    const responseCode = data.Response || data.response || data.ResponseCode
    const confirmationCode = data.ConfirmationCode || data.confirmationcode || data.ApprovalCode
    const tranzilaIndex = index || data.Index || data.TranzactionIndex
    const ourIndex = myid || data.Myid || data.myId

    if (!ourIndex) {
      console.error('Missing transaction reference (myid)')
      return new globalThis.Response('Missing myid', { 
        status: 400,
        headers: corsHeaders 
      })
    }

    // Find the payment by our index
    const { data: payment, error: findError } = await supabase
      .from('policy_payments')
      .select('*, policies!inner(branch_id)')
      .eq('tranzila_index', ourIndex)
      .single()

    if (findError || !payment) {
      console.error('Payment not found:', ourIndex, findError)
      return new globalThis.Response('Payment not found', { 
        status: 404,
        headers: corsHeaders 
      })
    }

    // Get branch_id from the policy to set on the payment
    const policyBranchId = (payment as any).policies?.branch_id || null

    // Check if payment was already processed (refused=false means paid for visa)
    if (payment.tranzila_response_code === '000' || payment.tranzila_response_code === '0') {
      console.log('Payment already processed:', payment.id)
      return new globalThis.Response('OK', { 
        status: 200,
        headers: corsHeaders 
      })
    }

    // Determine if payment was successful
    // Tranzila uses "000" or "0" for successful transactions
    const isSuccess = responseCode === '000' || responseCode === '0'

    if (isSuccess) {
      // Update payment to success - use refused=false to indicate paid
      // Also set branch_id from policy if it was missing
      const { error: updateError } = await supabase
        .from('policy_payments')
        .update({
          refused: false,
          tranzila_transaction_id: tranzilaIndex,
          tranzila_approval_code: confirmationCode,
          tranzila_response_code: responseCode,
          branch_id: payment.branch_id || policyBranchId,
        })
        .eq('id', payment.id)

      if (updateError) {
        console.error('Failed to update payment:', updateError)
        return new globalThis.Response('Update failed', { 
          status: 500,
          headers: corsHeaders 
        })
      }

      console.log('Payment marked as paid:', payment.id)
    } else {
      // Mark as failed - use refused=true
      const { error: updateError } = await supabase
        .from('policy_payments')
        .update({
          tranzila_response_code: responseCode,
          refused: true,
          notes: payment.notes 
            ? `${payment.notes}\nTranzila error: ${responseCode}` 
            : `Tranzila error: ${responseCode}`,
        })
        .eq('id', payment.id)

      if (updateError) {
        console.error('Failed to update payment:', updateError)
      }

      console.log('Payment marked as failed:', payment.id, responseCode)
    }

    // Return OK to Tranzila
    return new globalThis.Response('OK', { 
      status: 200,
      headers: corsHeaders 
    })

  } catch (error) {
    console.error('Error in tranzila-webhook:', error)
    return new globalThis.Response('Internal error', { 
      status: 500,
      headers: corsHeaders 
    })
  }
})
