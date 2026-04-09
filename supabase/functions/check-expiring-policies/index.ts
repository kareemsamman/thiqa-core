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

    console.log('Checking for expiring policies...');

    // Get policies expiring in the next 7 days that haven't been notified yet
    const today = new Date();
    const in7Days = new Date(today);
    in7Days.setDate(in7Days.getDate() + 7);

    const todayStr = today.toISOString().split('T')[0];
    const in7DaysStr = in7Days.toISOString().split('T')[0];

    console.log(`Looking for policies expiring between ${todayStr} and ${in7DaysStr}`);

    // Fetch expiring policies with client info
    const { data: expiringPolicies, error: policiesError } = await supabase
      .from('policies')
      .select(`
        id,
        policy_number,
        end_date,
        client_id,
        branch_id,
        clients!inner(full_name)
      `)
      .gte('end_date', todayStr)
      .lte('end_date', in7DaysStr)
      .eq('cancelled', false)
      .is('deleted_at', null);

    if (policiesError) {
      console.error('Error fetching expiring policies:', policiesError);
      throw policiesError;
    }

    console.log(`Found ${expiringPolicies?.length || 0} expiring policies`);

    if (!expiringPolicies || expiringPolicies.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No expiring policies found', count: 0 }),
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

    console.log(`Found ${activeUsers?.length || 0} active users`);

    // Check existing notifications to avoid duplicates
    const policyIds = expiringPolicies.map(p => p.id);
    const { data: existingNotifications, error: notifError } = await supabase
      .from('notifications')
      .select('entity_id')
      .eq('type', 'expiring')
      .eq('entity_type', 'policy')
      .in('entity_id', policyIds);

    if (notifError) {
      console.error('Error checking existing notifications:', notifError);
    }

    const alreadyNotifiedPolicyIds = new Set(existingNotifications?.map(n => n.entity_id) || []);
    console.log(`Already notified ${alreadyNotifiedPolicyIds.size} policies`);

    // Create notifications for each expiring policy
    const notifications: any[] = [];
    
    for (const policy of expiringPolicies) {
      // Skip if already notified
      if (alreadyNotifiedPolicyIds.has(policy.id)) {
        continue;
      }

      const clientName = (policy.clients as any)?.full_name || 'غير معروف';
      const daysUntilExpiry = Math.ceil((new Date(policy.end_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      // Find users who can access this branch
      const usersToNotify = activeUsers?.filter(user => {
        // Admin (no branch_id) can see all
        if (!user.branch_id) return true;
        // Branch users can only see their branch
        return user.branch_id === policy.branch_id;
      }) || [];

      for (const user of usersToNotify) {
        notifications.push({
          user_id: user.id,
          type: 'expiring',
          title: 'وثيقة تنتهي قريباً',
          message: `وثيقة العميل ${clientName} ${policy.policy_number ? `رقم ${policy.policy_number}` : ''} تنتهي خلال ${daysUntilExpiry} ${daysUntilExpiry === 1 ? 'يوم' : 'أيام'}`,
          link: '/policies',
          entity_type: 'policy',
          entity_id: policy.id,
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
        message: `Created ${notifications.length} notifications for ${expiringPolicies.length - alreadyNotifiedPolicyIds.size} expiring policies`,
        policiesChecked: expiringPolicies.length,
        notificationsCreated: notifications.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in check-expiring-policies:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
