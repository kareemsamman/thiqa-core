import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveSmsSettings } from "../_shared/sms-settings.ts";
import { resolveAgentId } from "../_shared/agent-branding.ts";

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

    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user is admin
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { letter_id, phone_number } = await req.json();
    
    if (!letter_id || !phone_number) {
      return new Response(JSON.stringify({ error: 'letter_id and phone_number are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Sending SMS for letter:', letter_id, 'to:', phone_number);

    // Fetch letter
    const { data: letter, error: letterError } = await supabase
      .from('correspondence_letters')
      .select('*')
      .eq('id', letter_id)
      .single();

    if (letterError || !letter) {
      return new Response(JSON.stringify({ error: 'Letter not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Generate HTML if not already generated
    let letterUrl = letter.generated_url;
    if (!letterUrl) {
      console.log('Generating HTML first...');
      
      // Fetch from sms_settings with invoice_templates join
      const { data: smsSettings } = await supabase
        .from('sms_settings')
        .select(`
          company_phone_links,
          company_location,
          invoice_templates:default_signature_template_id (logo_url)
        `)
        .limit(1)
        .single();

      let phoneLinks: { phone: string; label?: string }[] = [];
      if (smsSettings?.company_phone_links) {
        try {
          phoneLinks = typeof smsSettings.company_phone_links === 'string'
            ? JSON.parse(smsSettings.company_phone_links)
            : smsSettings.company_phone_links;
        } catch {
          phoneLinks = [];
        }
      }

      const companyName = siteSettings?.site_title || 'وكالة التأمين';
      const logoUrl = (smsSettings?.invoice_templates as any)?.logo_url || '';
      const phonesHtml = phoneLinks.map(p => `<span>${p.label ? `${p.label}: ` : ''}${p.phone}</span>`).join(' | ');

      const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${letter.title} - ${companyName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Tahoma, sans-serif; line-height: 1.8; background: #f5f5f5; padding: 20px; }
    .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { text-align: center; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 2px solid #e5e7eb; }
    .header img { max-height: 80px; margin-bottom: 10px; }
    .logo-placeholder { width: 80px; height: 80px; background: #3b82f6; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 24px; margin-bottom: 10px; }
    .recipient { margin-top: 16px; font-size: 18px; font-weight: 600; }
    .content { min-height: 300px; line-height: 2; }
    .content img { max-width: 100%; height: auto; margin: 10px 0; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 14px; }
    .footer .company-name { font-weight: 600; color: #374151; margin-bottom: 8px; }
    @media print { body { background: white; padding: 0; } .container { box-shadow: none; padding: 20px; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" />` : `<div class="logo-placeholder">AB</div>`}
      ${letter.recipient_name ? `<div class="recipient">إلى: ${letter.recipient_name}</div>` : ''}
    </div>
    <div class="content">${letter.body_html || ''}</div>
    <div class="footer">
      <p class="company-name">${companyName}</p>
      ${phonesHtml ? `<p>${phonesHtml}</p>` : ''}
    </div>
  </div>
</body>
</html>`;

      const bunnyStorageKey = Deno.env.get('BUNNY_API_KEY');
      const bunnyStorageZone = Deno.env.get('BUNNY_STORAGE_ZONE') || 'kareem';
      const bunnyCdnUrl = Deno.env.get('BUNNY_CDN_URL') || 'https://kareem.b-cdn.net';

      if (!bunnyStorageKey) {
        return new Response(JSON.stringify({ error: 'Storage not configured' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const storagePath = `correspondence/${letter.id}/letter.html`;
      const uploadUrl = `https://storage.bunnycdn.com/${bunnyStorageZone}/${storagePath}`;
      letterUrl = `${bunnyCdnUrl}/${storagePath}`;

      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'AccessKey': bunnyStorageKey,
          'Content-Type': 'text/html; charset=utf-8',
        },
        body: html,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.status}`);
      }

      // Purge cache
      try {
        await fetch(`https://api.bunny.net/purge?url=${encodeURIComponent(letterUrl)}`, {
          method: 'POST',
          headers: { 'AccessKey': bunnyStorageKey },
        });
      } catch (e) {
        console.error('Cache purge failed:', e);
      }

      // Update letter URL
      await supabase
        .from('correspondence_letters')
        .update({ generated_url: letterUrl })
        .eq('id', letter.id);
    }

    // Get SMS credentials (with Thiqa platform fallback)
    const agentId = await resolveAgentId(supabase, user.id);
    const smsSettings = await resolveSmsSettings(supabase, agentId);

    if (!smsSettings) {
      return new Response(JSON.stringify({ error: 'SMS service is disabled' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normalize phone
    let phone = phone_number.replace(/\D/g, '');
    if (phone.startsWith('972')) {
      phone = '0' + phone.slice(3);
    }
    if (!phone.startsWith('0')) {
      phone = '0' + phone;
    }

    const companyName = siteSettings?.site_title || 'وكالة التأمين';

    // Build SMS message
    const message = `رسالة من ${companyName}:
${letter.recipient_name}

للاطلاع على الرسالة:
${letterUrl}`;

    // Escape XML
    const escapeXml = (str: string) =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const dlr = crypto.randomUUID();
    const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?><sms><user><username>${escapeXml(smsSettings.sms_user)}</username></user><source>${escapeXml(smsSettings.sms_source)}</source><destinations><phone id="${dlr}">${escapeXml(phone)}</phone></destinations><message>${escapeXml(message)}</message></sms>`;

    console.log('Sending SMS to:', phone);

    const smsResponse = await fetch('https://019sms.co.il/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'Authorization': `Bearer ${smsSettings.sms_token}`,
      },
      body: xmlPayload,
    });

    const responseText = await smsResponse.text();
    console.log('SMS response:', responseText);

    const isSuccess = responseText.includes('<status>0</status>');

    // Look up client by letter's client_id or recipient phone
    let letterClientId = letter.client_id || null;
    if (!letterClientId && phone) {
      const { data: matchedClient } = await supabase
        .from('clients')
        .select('id')
        .eq('phone_number', phone)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();
      if (matchedClient) letterClientId = matchedClient.id;
    }

    // Log SMS
    await supabase.from('sms_logs').insert({
      phone_number: phone,
      message: message.slice(0, 500),
      status: isSuccess ? 'sent' : 'failed',
      error_message: isSuccess ? null : responseText.slice(0, 500),
      sms_type: 'correspondence',
      entity_type: 'correspondence',
      entity_id: letter.id,
      client_id: letterClientId,
      created_by: user.id,
    });

    if (!isSuccess) {
      return new Response(JSON.stringify({ error: 'SMS sending failed', details: responseText }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update letter status
    await supabase
      .from('correspondence_letters')
      .update({ 
        status: 'sent',
        sent_at: new Date().toISOString(),
        recipient_phone: phone,
      })
      .eq('id', letter.id);

    console.log('SMS sent successfully');

    return new Response(
      JSON.stringify({ success: true, url: letterUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in send-correspondence-sms:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
