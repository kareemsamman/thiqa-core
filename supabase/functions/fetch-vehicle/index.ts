import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Israeli Government Vehicle API
const GOV_API_URL = 'https://data.gov.il/api/3/action/datastore_search';
const RESOURCE_ID = '053cea08-09bc-40ec-8f7a-156f0677aff3';

interface VehicleData {
  car_number: string;
  manufacturer_name: string | null;
  model: string | null;
  model_number: string | null;
  year: number | null;
  color: string | null;
  license_type: string | null;
  license_expiry: string | null;
  last_license: string | null;
  car_type: string | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'غير مصرح' }), {
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
      return new Response(JSON.stringify({ error: 'رمز غير صالح' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user is active
    const { data: profile } = await supabase
      .from('profiles')
      .select('status')
      .eq('id', user.id)
      .single();

    if (!profile || profile.status !== 'active') {
      return new Response(JSON.stringify({ error: 'المستخدم غير نشط' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse request body
    const { car_number } = await req.json();

    if (!car_number || typeof car_number !== 'string') {
      return new Response(JSON.stringify({ error: 'رقم السيارة مطلوب' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Clean car number - remove dashes, spaces, etc
    const cleanedNumber = car_number.replace(/[-\s]/g, '').trim();

    console.log(`Fetching vehicle data for: ${cleanedNumber}`);

    // Call Israeli Government API
    const apiUrl = `${GOV_API_URL}?resource_id=${RESOURCE_ID}&q=${encodeURIComponent(cleanedNumber)}&limit=5`;
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('Government API error:', response.status);
      return new Response(JSON.stringify({ error: 'فشل الاتصال بخدمة البيانات الحكومية' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiData = await response.json();

    if (!apiData.success || !apiData.result?.records?.length) {
      return new Response(JSON.stringify({ 
        error: 'لم يتم العثور على مركبة بهذا الرقم',
        found: false
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find exact match
    const record = apiData.result.records.find((r: any) => {
      const recordNumber = String(r.mispar_rechev || '').replace(/[-\s]/g, '');
      return recordNumber === cleanedNumber;
    }) || apiData.result.records[0];

    // Map government API fields to our schema
    const vehicleData: VehicleData = {
      car_number: cleanedNumber,
      manufacturer_name: record.tozeret_nm || record.tozeret_cd || null,
      model: record.kinuy_mishari || null,
      model_number: record.degem_nm || record.degem_cd || null,
      year: record.shnat_yitzur ? parseInt(record.shnat_yitzur) : null,
      color: record.tzeva_rechev || null,
      license_type: record.sug_degem || null,
      license_expiry: record.tokef_dt || null,
      last_license: record.mivchan_acharon_dt || null,
      car_type: mapCarType(record.sug_degem),
    };

    console.log('Vehicle data found:', vehicleData);

    return new Response(JSON.stringify({ 
      success: true, 
      found: true,
      data: vehicleData 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Fetch vehicle error:', error);
    return new Response(JSON.stringify({ error: 'خطأ داخلي في الخادم' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Map government car type to our enum
function mapCarType(sugDegem: string | null): string {
  if (!sugDegem) return 'car';
  
  const lower = sugDegem.toLowerCase();
  
  if (lower.includes('מסחר') || lower.includes('commercial')) return 'cargo';
  if (lower.includes('מונית') || lower.includes('taxi')) return 'taxi';
  if (lower.includes('קטנוע') || lower.includes('אופנוע')) return 'small';
  
  return 'car';
}
