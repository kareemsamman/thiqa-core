import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    // Get authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify user
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const url = new URL(req.url)
    const paymentId = url.searchParams.get('payment_id')

    if (!paymentId) {
      return new Response(JSON.stringify({ error: 'Missing payment_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch payment status
    const { data: payment, error: paymentError } = await supabase
      .from('policy_payments')
      .select('id, tranzila_transaction_id, tranzila_approval_code, tranzila_response_code, refused')
      .eq('id', paymentId)
      .single()

    if (paymentError || !payment) {
      return new Response(JSON.stringify({ error: 'Payment not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Determine status: paid if response_code is 000/0 and refused=false
    let status = 'pending'
    if ((payment.tranzila_response_code === '000' || payment.tranzila_response_code === '0') && payment.refused === false) {
      status = 'paid'
    } else if (payment.refused === true && payment.tranzila_response_code) {
      status = 'failed'
    }

    return new Response(JSON.stringify({
      payment_id: payment.id,
      status,
      transaction_id: payment.tranzila_transaction_id,
      approval_code: payment.tranzila_approval_code,
      response_code: payment.tranzila_response_code,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Error in tranzila-status:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
