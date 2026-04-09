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

    console.log('Starting birthday and license expiry SMS cron job...');

    // Get SMS settings
    const { data: smsSettings, error: settingsError } = await supabase
      .from('sms_settings')
      .select('*')
      .single();

    if (settingsError || !smsSettings) {
      console.error('SMS settings not found:', settingsError);
      return new Response(JSON.stringify({ error: 'SMS settings not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!smsSettings.is_enabled) {
      console.log('SMS service is disabled');
      return new Response(JSON.stringify({ message: 'SMS service is disabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const todayMonth = today.getMonth() + 1;
    const todayDay = today.getDate();

    // Calculate date 1 month from now for license expiry
    const oneMonthFromNow = new Date(today);
    oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
    const oneMonthFromNowStr = oneMonthFromNow.toISOString().split('T')[0];

    const results = {
      birthdaySent: 0,
      birthdaySkipped: 0,
      birthdayFailed: 0,
      licenseSent: 0,
      licenseSkipped: 0,
      licenseFailed: 0,
    };

    // Helper function to send SMS
    async function sendSms(phone: string, message: string): Promise<boolean> {
      try {
        // Normalize phone number
        let normalizedPhone = phone.replace(/\D/g, '');
        if (normalizedPhone.startsWith('972')) {
          normalizedPhone = '0' + normalizedPhone.slice(3);
        }
        if (!normalizedPhone.startsWith('0')) {
          normalizedPhone = '0' + normalizedPhone;
        }

        const escapeXml = (str: string) =>
          str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

        const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<sms>
  <user>${escapeXml(smsSettings.sms_user)}</user>
  <source>${escapeXml(smsSettings.sms_source)}</source>
  <destinations>
    <phone>${escapeXml(normalizedPhone)}</phone>
  </destinations>
  <message>${escapeXml(message)}</message>
</sms>`;

        const response = await fetch('https://019sms.co.il/api', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/xml',
            'Authorization': `Bearer ${smsSettings.sms_token}`,
          },
          body: xmlPayload,
        });

        const responseText = await response.text();
        return responseText.includes('<status>0</status>') || 
               responseText.includes('success') ||
               response.ok;
      } catch (error) {
        console.error('SMS send error:', error);
        return false;
      }
    }

    // ===== BIRTHDAY SMS =====
    if (smsSettings.birthday_sms_enabled) {
      console.log('Processing birthday SMS...');

      // Get clients with birthday today (matching month and day)
      const { data: birthdayClients, error: birthdayError } = await supabase
        .from('clients')
        .select('id, full_name, phone_number, birth_date')
        .is('deleted_at', null)
        .not('phone_number', 'is', null)
        .not('birth_date', 'is', null);

      if (birthdayError) {
        console.error('Error fetching birthday clients:', birthdayError);
      } else if (birthdayClients) {
        // Filter clients whose birthday is today
        const todayBirthdayClients = birthdayClients.filter(client => {
          if (!client.birth_date) return false;
          const birthDate = new Date(client.birth_date);
          return birthDate.getMonth() + 1 === todayMonth && birthDate.getDate() === todayDay;
        });

        console.log(`Found ${todayBirthdayClients.length} clients with birthday today`);

        for (const client of todayBirthdayClients) {
          // Check if already sent today
          const { data: existing } = await supabase
            .from('automated_sms_log')
            .select('id')
            .eq('sms_type', 'birthday')
            .eq('client_id', client.id)
            .eq('sent_for_date', todayStr)
            .single();

          if (existing) {
            console.log(`Birthday SMS already sent to ${client.full_name}`);
            results.birthdaySkipped++;
            continue;
          }

          // Prepare message
          const message = (smsSettings.birthday_sms_template || 'عيد ميلاد سعيد {client_name}!')
            .replace(/{client_name}/g, client.full_name);

          // Send SMS
          const success = await sendSms(client.phone_number!, message);

          // Log to automated_sms_log
          await supabase.from('automated_sms_log').insert({
            sms_type: 'birthday',
            client_id: client.id,
            phone_number: client.phone_number,
            message,
            status: success ? 'sent' : 'failed',
            sent_for_date: todayStr,
          });

          // Also log to sms_logs
          await supabase.from('sms_logs').insert({
            phone_number: client.phone_number,
            message: message.slice(0, 500),
            status: success ? 'sent' : 'failed',
            sms_type: 'birthday',
            entity_type: 'client',
            entity_id: client.id,
            client_id: client.id,
          });

          if (success) {
            console.log(`Birthday SMS sent to ${client.full_name}`);
            results.birthdaySent++;
          } else {
            console.log(`Birthday SMS failed for ${client.full_name}`);
            results.birthdayFailed++;
          }

          // Small delay
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } else {
      console.log('Birthday SMS is disabled');
    }

    // ===== LICENSE EXPIRY SMS =====
    if (smsSettings.license_expiry_sms_enabled) {
      console.log('Processing license expiry SMS...');

      // Get cars with license expiring in 1 month (within 3 days window)
      const minDate = new Date(oneMonthFromNow);
      minDate.setDate(minDate.getDate() - 1);
      const maxDate = new Date(oneMonthFromNow);
      maxDate.setDate(maxDate.getDate() + 1);

      const { data: expiringCars, error: carsError } = await supabase
        .from('cars')
        .select(`
          id,
          car_number,
          license_expiry,
          client_id,
          clients!inner(id, full_name, phone_number)
        `)
        .is('deleted_at', null)
        .not('license_expiry', 'is', null)
        .gte('license_expiry', minDate.toISOString().split('T')[0])
        .lte('license_expiry', maxDate.toISOString().split('T')[0]);

      if (carsError) {
        console.error('Error fetching expiring cars:', carsError);
      } else if (expiringCars) {
        console.log(`Found ${expiringCars.length} cars with license expiring in ~1 month`);

        for (const car of expiringCars) {
          const client = car.clients as any;
          if (!client?.phone_number) {
            console.log(`Skipping car ${car.car_number} - no phone number`);
            results.licenseSkipped++;
            continue;
          }

          // Check if already sent for this car's expiry
          const { data: existing } = await supabase
            .from('automated_sms_log')
            .select('id')
            .eq('sms_type', 'license_expiry')
            .eq('car_id', car.id)
            .eq('sent_for_date', car.license_expiry)
            .single();

          if (existing) {
            console.log(`License expiry SMS already sent for car ${car.car_number}`);
            results.licenseSkipped++;
            continue;
          }

          // Prepare message
          const message = (smsSettings.license_expiry_sms_template || 'تنبيه: رخصة سيارتك {car_number} ستنتهي قريباً')
            .replace(/{client_name}/g, client.full_name)
            .replace(/{car_number}/g, car.car_number);

          // Send SMS
          const success = await sendSms(client.phone_number, message);

          // Log to automated_sms_log
          await supabase.from('automated_sms_log').insert({
            sms_type: 'license_expiry',
            client_id: client.id,
            car_id: car.id,
            phone_number: client.phone_number,
            message,
            status: success ? 'sent' : 'failed',
            sent_for_date: car.license_expiry,
          });

          // Also log to sms_logs
          await supabase.from('sms_logs').insert({
            phone_number: client.phone_number,
            message: message.slice(0, 500),
            status: success ? 'sent' : 'failed',
            sms_type: 'license_expiry',
            entity_type: 'car',
            entity_id: car.id,
            client_id: client.id,
          });

          if (success) {
            console.log(`License expiry SMS sent for car ${car.car_number}`);
            results.licenseSent++;
          } else {
            console.log(`License expiry SMS failed for car ${car.car_number}`);
            results.licenseFailed++;
          }

          // Small delay
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } else {
      console.log('License expiry SMS is disabled');
    }

    console.log('Cron job completed:', results);

    return new Response(
      JSON.stringify({
        success: true,
        ...results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in cron-birthday-license-sms:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
