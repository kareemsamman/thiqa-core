import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('Missing authorization header');
      return new Response(
        JSON.stringify({ success: false, message: 'غير مصرح' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(
        JSON.stringify({ success: false, message: 'جلسة غير صالحة' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body = await req.json();
    const { phone_number, extension_id, extension_number: legacyExtensionNumber } = body;

    if (!phone_number) {
      return new Response(
        JSON.stringify({ success: false, message: 'رقم الهاتف مطلوب' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get PBX credentials from auth_settings table
    const { data: authSettings, error: authSettingsError } = await supabase
      .from('auth_settings')
      .select('ippbx_enabled, ippbx_token_id')
      .limit(1)
      .single();

    if (authSettingsError) {
      console.error('Auth settings fetch error:', authSettingsError);
      return new Response(
        JSON.stringify({ success: false, message: 'خطأ في جلب إعدادات الاتصال' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!authSettings?.ippbx_enabled) {
      return new Response(
        JSON.stringify({ success: false, message: 'خاصية الاتصال السريع غير مفعلة' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tokenId = authSettings.ippbx_token_id;

    if (!tokenId) {
      console.error('Missing Token ID in auth_settings');
      return new Response(
        JSON.stringify({ success: false, message: 'لم يتم تكوين رمز التوثيق (Token ID)' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let extensionNumber: string;
    let extensionPassword: string;

    // New flow: get extension from pbx_extensions table
    if (extension_id) {
      const { data: extension, error: extError } = await supabase
        .from('pbx_extensions')
        .select('extension_number, password_md5')
        .eq('id', extension_id)
        .single();

      if (extError || !extension) {
        console.error('Extension fetch error:', extError);
        return new Response(
          JSON.stringify({ success: false, message: 'التحويلة غير موجودة' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      extensionNumber = extension.extension_number;
      extensionPassword = extension.password_md5;
    } 
    // Legacy flow: get extension number from request and password from auth_settings
    else if (legacyExtensionNumber) {
      extensionNumber = legacyExtensionNumber;
      
      // Try to find matching extension in new table first
      const { data: extension } = await supabase
        .from('pbx_extensions')
        .select('password_md5')
        .eq('extension_number', legacyExtensionNumber)
        .single();

      if (extension) {
        extensionPassword = extension.password_md5;
      } else {
        // Fallback to old auth_settings password (backward compatibility)
        const { data: oldSettings } = await supabase
          .from('auth_settings')
          .select('ippbx_extension_password')
          .limit(1)
          .single();
        
        extensionPassword = oldSettings?.ippbx_extension_password || '';
      }
    } 
    // No extension specified - use default
    else {
      const { data: defaultExt, error: defaultError } = await supabase
        .from('pbx_extensions')
        .select('extension_number, password_md5')
        .eq('is_default', true)
        .single();

      if (defaultError || !defaultExt) {
        console.error('No default extension found:', defaultError);
        return new Response(
          JSON.stringify({ success: false, message: 'لا توجد تحويلة افتراضية' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      extensionNumber = defaultExt.extension_number;
      extensionPassword = defaultExt.password_md5;
    }

    if (!extensionNumber || !extensionPassword) {
      return new Response(
        JSON.stringify({ success: false, message: 'بيانات التحويلة غير مكتملة' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Clean phone number (remove dashes and spaces)
    const cleanPhone = phone_number.replace(/[-\s]/g, '');

    console.log(`Initiating call: ${extensionNumber} -> ${cleanPhone}`);

    // Call IPPBX API
    const pbxPayload = {
      token_id: tokenId,
      phone_number: cleanPhone,
      extension_number: extensionNumber,
      extension_password: extensionPassword,
    };

    const pbxResponse = await fetch(
      'https://master.ippbx.co.il/ippbx_api/v1.4/api/info/click2call',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pbxPayload),
      }
    );

    const pbxData = await pbxResponse.json().catch(() => ({}));
    console.log('PBX Response:', pbxData);

    if (pbxResponse.ok && pbxData?.status === 'SUCCESS') {
      return new Response(
        JSON.stringify({ 
          success: true, 
          status: 'SUCCESS', 
          message: 'تم بدء الاتصال بنجاح' 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      return new Response(
        JSON.stringify({ 
          success: false, 
          status: pbxData?.status || 'FAILED',
          message: pbxData?.message || 'فشل في بدء الاتصال' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('Click2Call error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'حدث خطأ في الخادم' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
