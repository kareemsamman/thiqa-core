import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SUPER_ADMIN_EMAIL = 'morshed500@gmail.com';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // CRITICAL: Only super admin or admin-role users can delete policies
    const isSuper = user.email === SUPER_ADMIN_EMAIL;
    if (!isSuper) {
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .single();
      if (!roleData) {
        console.log(`Unauthorized delete attempt by: ${user.email}`);
        return new Response(JSON.stringify({ error: 'Only admins can delete policies' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Get policy ID(s) from request body
    const { policyIds } = await req.json();

    if (!policyIds || !Array.isArray(policyIds) || policyIds.length === 0) {
      return new Response(JSON.stringify({ error: 'No policy IDs provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Super admin ${user.email} is deleting policies: ${policyIds.join(', ')}`);

    const uniq = (arr: string[]) => Array.from(new Set(arr));

    // For packages, expand the deletion set to include all policies with the same group_id
    let allPolicyIds: string[] = uniq([...policyIds]);

    const { data: seedPolicies, error: seedError } = await supabase
      .from('policies')
      .select('id, group_id')
      .in('id', policyIds);

    if (seedError) {
      console.error('Error fetching seed policies:', seedError);
      return new Response(JSON.stringify({
        error: 'Failed to resolve package policies',
        details: seedError.message,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const groupIds = uniq((seedPolicies || []).map(p => p.group_id).filter(Boolean) as string[]);
    if (groupIds.length > 0) {
      const { data: groupPolicies, error: groupError } = await supabase
        .from('policies')
        .select('id')
        .in('group_id', groupIds);

      if (groupError) {
        console.error('Error fetching group policies:', groupError);
        return new Response(JSON.stringify({
          error: 'Failed to resolve package policies',
          details: groupError.message,
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      allPolicyIds = uniq([...allPolicyIds, ...(groupPolicies || []).map(p => p.id)]);
    }

    console.log(`Total policies to delete (including package members): ${allPolicyIds.length}`);

    // ── Notify X-Service about deletions (before we delete data) ──
    try {
      // Fetch policy + client + car info for service-type policies
      const { data: servicePoliciesToNotify } = await supabase
        .from('policies')
        .select(`
          id, policy_type_parent, policy_number, start_date, end_date,
          payed_for_company, notes, car_id, client_id,
          clients!inner(full_name, id_number, phone_number),
          cars(car_number, car_type, manufacturer_name, model, year, color)
        `)
        .in('id', allPolicyIds)
        .in('policy_type_parent', ['ROAD_SERVICE', 'ACCIDENT_FEE_EXEMPTION']);

      if (servicePoliciesToNotify && servicePoliciesToNotify.length > 0) {
        const batchPayload = servicePoliciesToNotify.map((p: any) => ({
          policy_id: p.id,
          action: 'delete',
          client: {
            full_name: p.clients?.full_name || '',
            id_number: p.clients?.id_number || '',
            phone1: p.clients?.phone_number || '',
          },
          car: {
            car_number: p.cars?.car_number || '',
            car_type: p.cars?.car_type || null,
            manufacturer: p.cars?.manufacturer_name || '',
            model: p.cars?.model || '',
            year: p.cars?.year || null,
            color: p.cars?.color || '',
          },
          policy_details: {
            service_type: p.policy_type_parent === 'ROAD_SERVICE' ? 'road_service' : 'accident_fee',
            policy_number: p.policy_number,
            start_date: p.start_date,
            end_date: p.end_date,
            sell_price: p.payed_for_company || 0,
            notes: p.notes || '',
          },
        }));

        // Fire-and-forget: don't block deletion if X-Service notification fails
        fetch(`${supabaseUrl}/functions/v1/notify-xservice-change`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({ action: 'delete', policies: batchPayload }),
        }).catch(err => console.error('X-Service delete notification failed:', err));

        console.log(`Notified X-Service about ${batchPayload.length} service policies being deleted`);
      }
    } catch (notifyErr) {
      console.error('Error preparing X-Service delete notification:', notifyErr);
      // Don't block deletion
    }

    // Delete related data in correct order to avoid FK constraints

    // 1) IMPORTANT: Unlock system-generated payments (ELZAMI) so they can be deleted.
    // The DB trigger blocks DELETE when OLD.locked=true.
    const { error: unlockError } = await supabase
      .from('policy_payments')
      .update({ locked: false })
      .in('policy_id', allPolicyIds)
      .eq('locked', true);

    if (unlockError) {
      console.error('Error unlocking payments:', unlockError);
      return new Response(JSON.stringify({
        error: 'Failed to unlock system payments',
        details: unlockError.message,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2) Delete policy payments
    const { error: paymentsError } = await supabase
      .from('policy_payments')
      .delete()
      .in('policy_id', allPolicyIds);

    if (paymentsError) {
      console.error('Error deleting policy payments:', paymentsError);
      return new Response(JSON.stringify({
        error: 'Failed to delete policy payments',
        details: paymentsError.message,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Deleted policy payments');

    // 3. Delete ledger entries
    const { error: ledgerError } = await supabase
      .from('ab_ledger')
      .delete()
      .in('policy_id', allPolicyIds);
    
    if (ledgerError) {
      console.error('Error deleting ledger entries:', ledgerError);
    } else {
      console.log('Deleted ledger entries');
    }

    // 4. Delete customer wallet transactions related to these policies
    const { error: walletError } = await supabase
      .from('customer_wallet_transactions')
      .delete()
      .in('policy_id', allPolicyIds);
    
    if (walletError) {
      console.error('Error deleting wallet transactions:', walletError);
    } else {
      console.log('Deleted wallet transactions');
    }

    // 5. Delete customer signatures
    const { error: signaturesError } = await supabase
      .from('customer_signatures')
      .delete()
      .in('policy_id', allPolicyIds);
    
    if (signaturesError) {
      console.error('Error deleting signatures:', signaturesError);
    } else {
      console.log('Deleted signatures');
    }

    // 6. Delete media files (soft delete)
    const { error: mediaError } = await supabase
      .from('media_files')
      .update({ deleted_at: new Date().toISOString() })
      .in('entity_id', allPolicyIds)
      .eq('entity_type', 'policy');
    
    if (mediaError) {
      console.error('Error deleting media files:', mediaError);
    } else {
      console.log('Soft-deleted media files');
    }

    // 7. Delete accident reports and third parties
    const { data: accidentReports } = await supabase
      .from('accident_reports')
      .select('id')
      .in('policy_id', allPolicyIds);
    
    if (accidentReports && accidentReports.length > 0) {
      const accidentIds = accidentReports.map(a => a.id);
      
      // Delete third parties first
      const { error: thirdPartiesError } = await supabase
        .from('accident_third_parties')
        .delete()
        .in('accident_report_id', accidentIds);
      
      if (thirdPartiesError) {
        console.error('Error deleting accident third parties:', thirdPartiesError);
      }
      
      // Delete accident reports
      const { error: accidentsError } = await supabase
        .from('accident_reports')
        .delete()
        .in('policy_id', allPolicyIds);
      
      if (accidentsError) {
        console.error('Error deleting accident reports:', accidentsError);
      } else {
        console.log('Deleted accident reports and third parties');
      }
    }

    // 8. Delete broker settlement items that reference these policies
    const { error: brokerSettlementItemsError } = await supabase
      .from('broker_settlement_items')
      .delete()
      .in('policy_id', allPolicyIds);
    
    if (brokerSettlementItemsError) {
      console.error('Error deleting broker settlement items:', brokerSettlementItemsError);
    } else {
      console.log('Deleted broker settlement items');
    }

    // 9. Delete policy_transfers that reference these policies (as either policy_id or new_policy_id)
    const { error: transfersError } = await supabase
      .from('policy_transfers')
      .delete()
      .or(`policy_id.in.(${allPolicyIds.join(',')}),new_policy_id.in.(${allPolicyIds.join(',')})`);
    
    if (transfersError) {
      console.error('Error deleting policy transfers:', transfersError);
    } else {
      console.log('Deleted policy transfers');
    }

    // 10. Finally, delete the policies themselves
    const { error: policiesError } = await supabase
      .from('policies')
      .delete()
      .in('id', allPolicyIds);
    
    if (policiesError) {
      console.error('Error deleting policies:', policiesError);
      return new Response(JSON.stringify({ 
        error: 'Failed to delete policies',
        details: policiesError.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Successfully deleted ${allPolicyIds.length} policies and all related data`);

    return new Response(JSON.stringify({ 
      success: true, 
      deletedCount: allPolicyIds.length,
      deletedPolicyIds: allPolicyIds
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Delete policy error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
