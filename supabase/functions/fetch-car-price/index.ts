import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Israeli Government Car Price API (Mehir Yevuan - מחיר יבואן)
const GOV_API_URL = 'https://data.gov.il/api/3/action/datastore_search';
const PACKAGE_URL = 'https://data.gov.il/api/3/action/package_show';

interface CarPriceData {
  price: number | null;
  manufacturer: string | null;
  model: string | null;
  year: number | null;
  degem_nm: string | null;
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
    const { manufacturer, model, year } = await req.json();

    if (!manufacturer || !year) {
      return new Response(JSON.stringify({ error: 'بيانات السيارة مطلوبة' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Fetching car price for: ${manufacturer} ${model} ${year}`);

    // First, get the package info to find the correct resource ID
    let resourceId = '';
    try {
      const pkgResponse = await fetch(`${PACKAGE_URL}?id=mehir_yevuan`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      
      if (pkgResponse.ok) {
        const pkgData = await pkgResponse.json();
        if (pkgData.success && pkgData.result?.resources) {
          // Find the datastore resource
          const datastoreResource = pkgData.result.resources.find(
            (r: any) => r.datastore_active === true || r.format === 'CSV'
          );
          if (datastoreResource) {
            resourceId = datastoreResource.id;
          }
        }
      }
    } catch (e) {
      console.log('Could not fetch package info, trying fallback resource ID');
    }

    // Fallback resource ID for mehir_yevuan
    if (!resourceId) {
      resourceId = '142afde2-6228-49f9-8a29-9b6c3a0cbe40';
    }

    console.log('Using resource ID:', resourceId);

    // Search for car price by manufacturer and year
    // Build search query - searching by manufacturer name and year
    const searchTerms = [];
    searchTerms.push(manufacturer);
    if (model) searchTerms.push(model);
    
    const apiUrl = `${GOV_API_URL}?resource_id=${resourceId}&limit=50&q=${encodeURIComponent(searchTerms.join(' '))}`;
    
    console.log('API URL:', apiUrl);

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.error('Government API error:', response.status);
      // Try alternative API approach - searching by filters
      const filterApiUrl = `${GOV_API_URL}?resource_id=${resourceId}&limit=50&filters={"shnat_yitzur":"${year}"}`;
      
      const filterResponse = await fetch(filterApiUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      
      if (!filterResponse.ok) {
        return new Response(JSON.stringify({ 
          error: 'فشل الاتصال بخدمة أسعار السيارات',
          details: 'Unable to connect to price service'
        }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const apiData = await response.json();

    if (!apiData.success) {
      return new Response(JSON.stringify({ 
        error: 'فشل في الحصول على بيانات الأسعار',
        found: false
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const records = apiData.result?.records || [];
    console.log(`Found ${records.length} records`);

    // Try to find best match
    let bestMatch: any = null;
    let bestScore = 0;

    const manufacturerLower = manufacturer.toLowerCase();
    const modelLower = model?.toLowerCase() || '';
    const targetYear = parseInt(year);

    for (const record of records) {
      let score = 0;
      
      // Check manufacturer match
      const recordManufacturer = (record.tozeret_nm || record.tozeret_cd || '').toLowerCase();
      if (recordManufacturer.includes(manufacturerLower) || manufacturerLower.includes(recordManufacturer)) {
        score += 3;
      }
      
      // Check model match
      const recordModel = (record.kinuy_mishari || record.degem_nm || '').toLowerCase();
      if (modelLower && (recordModel.includes(modelLower) || modelLower.includes(recordModel))) {
        score += 2;
      }
      
      // Check year match
      const recordYear = parseInt(record.shnat_yitzur);
      if (recordYear === targetYear) {
        score += 5;
      } else if (Math.abs(recordYear - targetYear) <= 1) {
        score += 2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = record;
      }
    }

    if (!bestMatch || bestScore < 3) {
      return new Response(JSON.stringify({ 
        success: true,
        found: false,
        data: {
          price: null,
          manufacturer,
          model,
          year: targetYear,
          message: 'لم يتم العثور على سعر مطابق'
        }
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract price from record
    // Common field names for price in mehir_yevuan
    const price = bestMatch.mehir_yevuan || 
                  bestMatch.mehir || 
                  bestMatch.price || 
                  bestMatch.mehir_mechona ||
                  bestMatch.mehir_basis ||
                  null;

    const priceData: CarPriceData = {
      price: price ? parseFloat(price) : null,
      manufacturer: bestMatch.tozeret_nm || manufacturer,
      model: bestMatch.kinuy_mishari || model,
      year: bestMatch.shnat_yitzur ? parseInt(bestMatch.shnat_yitzur) : targetYear,
      degem_nm: bestMatch.degem_nm || null,
    };

    console.log('Price data found:', priceData);

    return new Response(JSON.stringify({ 
      success: true, 
      found: true,
      data: priceData 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Fetch car price error:', error);
    return new Response(JSON.stringify({ error: 'خطأ داخلي في الخادم' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
