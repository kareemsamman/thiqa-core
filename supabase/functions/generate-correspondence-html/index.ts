import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Version for cache busting - update on each deployment
const VERSION = 'v2.0.0';

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

    const { letter_id } = await req.json();
    
    if (!letter_id) {
      return new Response(JSON.stringify({ error: 'letter_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[${VERSION}] Generating HTML for letter:`, letter_id);

    // Fetch letter data
    const { data: letter, error: letterError } = await supabase
      .from('correspondence_letters')
      .select('*')
      .eq('id', letter_id)
      .single();

    if (letterError || !letter) {
      console.error('Letter not found:', letterError);
      return new Response(JSON.stringify({ error: 'Letter not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch company info from sms_settings
    const { data: smsSettings } = await supabase
      .from('sms_settings')
      .select('company_phone_links, company_location')
      .limit(1)
      .single();

    // Parse phone links
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

    const companyName = 'ثقة للتأمين';
    const companyLocation = smsSettings?.company_location || '';
    
    // Format date
    const letterDate = new Date(letter.created_at).toLocaleDateString('en-GB');

    // Build phone links for footer
    const phonesFooterHtml = phoneLinks.map((p, i) => {
      const label = p.label ? `${p.label}: ` : '';
      const separator = i > 0 ? ' | ' : '';
      return `${separator}${label}${p.phone}`;
    }).join('');

    // Build complete HTML with professional official letter design
    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${letter.title} - ${companyName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, Tahoma, sans-serif;
      line-height: 1.8;
      background: #f1f5f9;
      padding: 20px;
      min-height: 100vh;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      box-shadow: 0 2px 10px rgba(0,0,0,0.08);
      border-radius: 4px;
      overflow: hidden;
    }
    .letterhead {
      padding: 32px 40px 24px;
      border-bottom: 3px double #0d9488;
      text-align: center;
    }
    .letterhead h1 {
      font-size: 28px;
      font-weight: bold;
      margin: 0;
      color: #0d9488;
      letter-spacing: 1px;
    }
    .letterhead p {
      font-size: 13px;
      margin: 4px 0 0;
      color: #64748b;
    }
    .letter-meta {
      padding: 24px 40px 16px;
    }
    .date-line {
      text-align: left;
      margin-bottom: 20px;
      color: #374151;
      font-size: 14px;
    }
    .meta-row {
      margin-bottom: 8px;
      font-size: 14px;
    }
    .meta-label {
      color: #64748b;
    }
    .meta-value {
      color: #1e293b;
      font-weight: 600;
    }
    .separator {
      border-bottom: 1px solid #e5e7eb;
      margin: 16px 0 20px;
    }
    .content {
      padding: 0 40px 32px;
      min-height: 200px;
      font-size: 14px;
      line-height: 2;
      color: #1e293b;
    }
    .content img {
      max-width: 100%;
      height: auto;
      margin: 10px 0;
    }
    .greeting {
      margin-bottom: 16px;
    }
    .closing {
      margin-top: 32px;
    }
    .signature-area {
      padding: 16px 40px 32px;
      text-align: left;
    }
    .signature-block {
      display: inline-block;
      text-align: center;
    }
    .signature-name {
      font-size: 16px;
      color: #0d9488;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .signature-line {
      width: 120px;
      border-top: 1px solid #94a3b8;
      padding-top: 6px;
      color: #64748b;
      font-size: 12px;
    }
    .footer {
      border-top: 3px double #0d9488;
      padding: 16px 40px;
      text-align: center;
      color: #64748b;
      font-size: 12px;
      background: #f8fafc;
    }
    @media print {
      body { 
        background: white; 
        padding: 0; 
      }
      .container { 
        box-shadow: none; 
        max-width: 100%;
      }
      .letterhead {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .footer {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
  </style>
  <script>
    if (window.location.search.includes('print=1')) {
      window.onload = function() { setTimeout(function() { window.print(); }, 500); };
    }
  </script>
</head>
<body>
  <div class="container">
    <!-- Elegant Letterhead -->
    <div class="letterhead">
      <h1>${companyName}</h1>
      <p>وكالة تأمين معتمدة</p>
    </div>

    <!-- Letter Meta -->
    <div class="letter-meta">
      <div class="date-line">التاريخ: ${letterDate}</div>
      
      <div class="meta-row">
        <span class="meta-label">إلى: </span>
        <span class="meta-value">${letter.recipient_name || '---'}</span>
      </div>
      
      <div class="meta-row">
        <span class="meta-label">الموضوع: </span>
        <span class="meta-value">${letter.title || 'رسالة رسمية'}</span>
      </div>
      
      <div class="separator"></div>
    </div>

    <!-- Body Content -->
    <div class="content">
      <p class="greeting">
        ${letter.recipient_name ? `حضرة السيد/ة ${letter.recipient_name} المحترم/ة،` : 'تحية طيبة وبعد،'}
      </p>
      
      ${letter.body_html || ''}
      
      <div class="closing">
        <p>وتفضلوا بقبول فائق الاحترام والتقدير،</p>
      </div>
    </div>

    <!-- Signature Area -->
    <div class="signature-area">
      <div class="signature-block">
        <div class="signature-name">${companyName}</div>
        <div class="signature-line">التوقيع والختم</div>
      </div>
    </div>

    <!-- Simple Footer -->
    <div class="footer">
      ${phonesFooterHtml}${companyLocation ? ` | ${companyLocation}` : ''}
    </div>
  </div>
</body>
</html>`;

    // Upload to BunnyCDN
    const bunnyStorageKey = Deno.env.get('BUNNY_API_KEY');
    const bunnyAccountKey = Deno.env.get('BUNNY_ACCOUNT_API_KEY');
    const bunnyStorageZone = Deno.env.get('BUNNY_STORAGE_ZONE') || 'kareem';
    const bunnyCdnUrl = Deno.env.get('BUNNY_CDN_URL') || 'https://kareem.b-cdn.net';

    if (!bunnyStorageKey) {
      console.error('BUNNY_API_KEY not configured');
      return new Response(JSON.stringify({ error: 'Storage not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fixed filename for stable URL
    const storagePath = `correspondence/${letter.id}/letter.html`;
    const uploadUrl = `https://storage.bunnycdn.com/${bunnyStorageZone}/${storagePath}`;
    const cdnBaseUrl = bunnyCdnUrl.startsWith('http') ? bunnyCdnUrl : `https://${bunnyCdnUrl}`;
    const cdnUrl = `${cdnBaseUrl}/${storagePath}`;

    console.log('Uploading to:', uploadUrl);

    // Upload HTML
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'AccessKey': bunnyStorageKey,
        'Content-Type': 'text/html; charset=utf-8',
      },
      body: html,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('Upload failed:', errorText);
      throw new Error(`Upload failed: ${uploadResponse.status}`);
    }

    console.log('Upload successful, purging cache...');

    // Purge CDN cache
    if (bunnyAccountKey) {
      try {
        const purgeUrl = `https://api.bunny.net/purge?url=${encodeURIComponent(cdnUrl)}`;
        const purgeResponse = await fetch(purgeUrl, {
          method: 'POST',
          headers: { 'AccessKey': bunnyAccountKey },
        });
        if (purgeResponse.ok) {
          console.log('Cache purged successfully');
        } else {
          console.warn('CDN purge failed:', await purgeResponse.text());
        }
      } catch (purgeError) {
        console.error('Cache purge failed (non-fatal):', purgeError);
      }
    } else {
      console.warn('BUNNY_ACCOUNT_API_KEY not set - cache purge skipped');
    }

    // Update letter with generated URL (add cache buster)
    const timestamp = Date.now();
    const urlWithCacheBuster = `${cdnUrl}?v=${timestamp}`;
    
    await supabase
      .from('correspondence_letters')
      .update({ 
        generated_url: urlWithCacheBuster,
        updated_at: new Date().toISOString(),
      })
      .eq('id', letter.id);

    console.log(`[${VERSION}] Letter URL updated:`, urlWithCacheBuster);

    return new Response(
      JSON.stringify({ success: true, url: urlWithCacheBuster, _version: VERSION }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in generate-correspondence-html:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
