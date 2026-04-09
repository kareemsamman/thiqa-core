import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Checking for cheques due soon...');

    // Get cheques due in the next 3 days that are still pending
    const today = new Date();
    const in3Days = new Date(today);
    in3Days.setDate(in3Days.getDate() + 3);

    const todayStr = today.toISOString().split('T')[0];
    const in3DaysStr = in3Days.toISOString().split('T')[0];

    console.log(`Looking for cheques due between ${todayStr} and ${in3DaysStr}`);

    // Fetch pending cheques with client and policy info
    const { data: pendingCheques, error: chequesError } = await supabase
      .from('policy_payments')
      .select(`
        id,
        amount,
        payment_date,
        cheque_number,
        policy_id,
        branch_id,
        policies!policy_payments_policy_id_fkey(
          id,
          policy_number,
          client_id,
          clients!policies_client_id_fkey(full_name, phone_number)
        )
      `)
      .eq('payment_type', 'cheque')
      .or('cheque_status.is.null,cheque_status.eq.pending')
      .gte('payment_date', todayStr)
      .lte('payment_date', in3DaysStr);

    if (chequesError) {
      console.error('Error fetching pending cheques:', chequesError);
      throw chequesError;
    }

    console.log(`Found ${pendingCheques?.length || 0} cheques due soon`);

    if (!pendingCheques || pendingCheques.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No cheques due soon', count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get all active users to notify
    const { data: activeUsers, error: usersError } = await supabase
      .from('profiles')
      .select('id, branch_id')
      .eq('status', 'active');

    if (usersError) {
      console.error('Error fetching active users:', usersError);
      throw usersError;
    }

    // Check existing notifications to avoid duplicates (check for today only)
    const chequeIds = pendingCheques.map(c => c.id);
    const { data: existingNotifications, error: notifError } = await supabase
      .from('notifications')
      .select('entity_id, created_at')
      .eq('type', 'cheque_reminder')
      .eq('entity_type', 'payment')
      .in('entity_id', chequeIds)
      .gte('created_at', todayStr);

    if (notifError) {
      console.error('Error checking existing notifications:', notifError);
    }

    const alreadyNotifiedToday = new Set(existingNotifications?.map(n => n.entity_id) || []);
    console.log(`Already notified ${alreadyNotifiedToday.size} cheques today`);

    // Create notifications for each cheque due
    const notifications: any[] = [];
    
    for (const cheque of pendingCheques) {
      // Skip if already notified today
      if (alreadyNotifiedToday.has(cheque.id)) {
        continue;
      }

      const policy = cheque.policies as any;
      const clientName = policy?.clients?.full_name || 'غير معروف';
      const daysUntilDue = Math.ceil((new Date(cheque.payment_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const formattedAmount = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(cheque.amount);
      
      // Find users who can access this branch
      const usersToNotify = activeUsers?.filter(user => {
        // Admin (no branch_id) can see all
        if (!user.branch_id) return true;
        // Branch users can only see their branch
        return user.branch_id === cheque.branch_id;
      }) || [];

      for (const user of usersToNotify) {
        notifications.push({
          user_id: user.id,
          type: 'cheque_reminder',
          title: 'شيك قريب الاستحقاق',
          message: `شيك رقم ${cheque.cheque_number || '-'} للعميل ${clientName} بمبلغ ${formattedAmount} يستحق ${daysUntilDue === 0 ? 'اليوم' : daysUntilDue === 1 ? 'غداً' : `خلال ${daysUntilDue} أيام`}`,
          link: '/cheques',
          entity_type: 'payment',
          entity_id: cheque.id,
        });
      }
    }

    console.log(`Creating ${notifications.length} new notifications`);

    if (notifications.length > 0) {
      const { error: insertError } = await supabase
        .from('notifications')
        .insert(notifications);

      if (insertError) {
        console.error('Error inserting notifications:', insertError);
        throw insertError;
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Created ${notifications.length} notifications for ${pendingCheques.length - alreadyNotifiedToday.size} cheques due soon`,
        chequesChecked: pendingCheques.length,
        notificationsCreated: notifications.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in check-cheque-reminders:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
