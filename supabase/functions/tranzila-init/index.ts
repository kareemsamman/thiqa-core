import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface InitPaymentRequest {
  policy_id: string
  amount: number
  payment_date: string
  notes?: string
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get authorization header for user context
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get user from JWT
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body: InitPaymentRequest = await req.json()
    const { policy_id, amount, payment_date, notes } = body

    if (!policy_id || !amount || amount <= 0) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch Tranzila settings
    const { data: settings, error: settingsError } = await supabase
      .from('payment_settings')
      .select('*')
      .eq('provider', 'tranzila')
      .single()

    if (settingsError || !settings) {
      console.error('Settings error:', settingsError)
      return new Response(JSON.stringify({ error: 'Payment settings not configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!settings.is_enabled) {
      return new Response(JSON.stringify({ error: 'Tranzila payments are disabled' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Generate unique index for this transaction (max 12 chars for myid field)
    // Note: We generate this AFTER creating the payment so we can use the payment ID
    // The actual tranzilaIndex will be set after insert

    // First, fetch the policy to get its branch_id (for RLS visibility)
    const { data: policyData, error: policyError } = await supabase
      .from('policies')
      .select('branch_id')
      .eq('id', policy_id)
      .single()

    if (policyError) {
      console.error('Policy fetch error:', policyError)
      return new Response(JSON.stringify({ error: 'Policy not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Create pending payment record with branch_id for worker visibility
    const { data: payment, error: paymentError } = await supabase
      .from('policy_payments')
      .insert({
        policy_id,
        amount,
        payment_type: 'visa',
        payment_date,
        notes: notes || null,
        provider: 'tranzila',
        tranzila_index: 'pending', // Temporary, will update after getting ID
        created_by_admin_id: user.id,
        refused: null, // null = pending, false = paid, true = refused
        branch_id: policyData?.branch_id || null, // Inherit branch from policy for RLS
      })
      .select()
      .single()

    if (paymentError) {
      console.error('Payment creation error:', paymentError)
      return new Response(JSON.stringify({ error: 'Failed to create payment record' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Generate short unique index using payment ID (max 12 chars for Tranzila myid field)
    // Format: last 8 chars of UUID (no dashes) + last 4 digits of timestamp
    const paymentIdShort = payment.id.replace(/-/g, '').slice(-8)
    const timestampShort = Date.now().toString().slice(-4)
    const tranzilaIndex = `${paymentIdShort}${timestampShort}`

    // Update payment with actual tranzila_index
    await supabase
      .from('policy_payments')
      .update({ tranzila_index: tranzilaIndex })
      .eq('id', payment.id)

    // Determine terminal: sandbox only for super admin (morshed500@gmail.com) when test_mode is on
    const SUPER_ADMIN_EMAIL = 'morshed500@gmail.com'
    const useSandbox = settings.test_mode && user.email === SUPER_ADMIN_EMAIL
    const terminalName = useSandbox
      ? (settings.sandbox_terminal_name || 'demo5964')
      : settings.terminal_name

    if (!terminalName) {
      return new Response(JSON.stringify({ error: 'Terminal name not configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const iframeUrl = `https://direct.tranzila.com/${terminalName}/iframenew.php`
    
    // Build form fields for POST submission (per Tranzila docs)
    // See: https://docs.tranzila.com/docs/payments-billing/795m2yi7q4nmq-iframe-integration
    const formFields: Record<string, string> = {
      sum: amount.toString(),
      currency: '1', // 1 = NIS
      cred_type: '8', // 8 = installments (תשלומים)
      maxpay: '12', // Up to 12 payments
      lang: 'il', // Hebrew language
      tranmode: 'A', // A = standard transaction
      newprocess: '1', // 3DS V2 (can also be enabled in terminal settings)
      myid: tranzilaIndex, // Our reference for tracking this payment
    }

    // Build edge function URLs for success/fail - these are simple HTML pages
    const baseEdgeFunctionUrl = `${supabaseUrl}/functions/v1/payment-result`
    
    // Always use edge function URLs (ignore settings.success_url/fail_url as they may be stale)
    formFields.success_url_address = `${baseEdgeFunctionUrl}?status=success&payment_id=${payment.id}`
    formFields.fail_url_address = `${baseEdgeFunctionUrl}?status=failed&payment_id=${payment.id}`
    
    // Webhook for server-to-server notification
    if (settings.notify_url) {
      formFields.notify_url_address = settings.notify_url
    }

    console.log('Generated Tranzila form fields:', JSON.stringify(formFields))

    return new Response(JSON.stringify({
      success: true,
      test_mode: useSandbox,
      payment_id: payment.id,
      iframe_url: iframeUrl,
      form_fields: formFields, // Return fields for POST submission
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Error in tranzila-init:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
