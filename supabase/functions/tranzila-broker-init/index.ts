import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface InitBrokerPaymentRequest {
  broker_id: string
  amount: number
  direction: 'we_owe' | 'broker_owes'
  settlement_date: string
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

    const body: InitBrokerPaymentRequest = await req.json()
    const { broker_id, amount, direction, settlement_date, notes } = body

    if (!broker_id || !amount || amount <= 0) {
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

    // Generate unique index for this transaction
    const tranzilaIndex = `broker-${broker_id}-${Date.now()}`

    // Create pending broker settlement record
    const { data: settlement, error: settlementError } = await supabase
      .from('broker_settlements')
      .insert({
        broker_id,
        direction,
        total_amount: amount,
        settlement_date,
        notes: notes || null,
        status: 'pending',
        payment_type: 'visa',
        created_by_admin_id: user.id,
        tranzila_transaction_id: tranzilaIndex, // Use as our index
        refused: null, // null = pending
      })
      .select()
      .single()

    if (settlementError) {
      console.error('Settlement creation error:', settlementError)
      return new Response(JSON.stringify({ error: 'Failed to create settlement record' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // If test mode, return simulated success
    if (settings.test_mode) {
      // Update settlement to success immediately in test mode
      await supabase
        .from('broker_settlements')
        .update({
          status: 'completed',
          refused: false,
          tranzila_approval_code: 'TEST-APPROVED',
        })
        .eq('id', settlement.id)

      return new Response(JSON.stringify({
        success: true,
        test_mode: true,
        settlement_id: settlement.id,
        message: 'Payment simulated successfully (test mode)',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Build Tranzila form data
    const terminalName = settings.terminal_name
    if (!terminalName) {
      return new Response(JSON.stringify({ error: 'Terminal name not configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const iframeUrl = `https://direct.tranzila.com/${terminalName}/iframenew.php`
    
    // Build form fields for POST submission
    const formFields: Record<string, string> = {
      sum: amount.toString(),
      currency: '1', // 1 = NIS
      cred_type: '8', // 8 = installments
      maxpay: '12',
      lang: 'il',
      tranmode: 'A',
      newprocess: '1',
      myid: tranzilaIndex, // Our reference
    }

    // Build edge function URLs for success/fail
    const baseEdgeFunctionUrl = `${supabaseUrl}/functions/v1/broker-payment-result`
    formFields.success_url_address = `${baseEdgeFunctionUrl}?status=success&settlement_id=${settlement.id}`
    formFields.fail_url_address = `${baseEdgeFunctionUrl}?status=failed&settlement_id=${settlement.id}`

    console.log('Generated Tranzila form fields for broker payment:', JSON.stringify(formFields))

    return new Response(JSON.stringify({
      success: true,
      test_mode: false,
      settlement_id: settlement.id,
      iframe_url: iframeUrl,
      form_fields: formFields,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Error in tranzila-broker-init:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
