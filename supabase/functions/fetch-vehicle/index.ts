import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Israeli Government Vehicle API (data.gov.il).
//
// The Israeli vehicle registry is split across several CKAN datastore
// resources by category. Querying just the "private + light commercial"
// resource (the original setup) misses taxis, buses, motorcycles, and
// trucks > 3.5T. We now hit all four in parallel and the first dataset
// that returns an exact plate match wins. Each `kind` maps cleanly to
// one of our six car_type enum values (car / cargo / small / taxi /
// tjeradown4 / tjeraup4).
const GOV_API_URL = 'https://data.gov.il/api/3/action/datastore_search';

type DatasetKind = 'private_commercial' | 'heavy_truck' | 'public_transport' | 'motorcycle';

interface DatasetSource {
  resourceId: string;
  kind: DatasetKind;
  // Hebrew label, useful for logs
  label: string;
}

const DATASETS: DatasetSource[] = [
  // Private + light-commercial vehicles. Has `sug_degem` we can grep
  // for "מסחר" to split between private (car) and light-commercial.
  { resourceId: '053cea08-09bc-40ec-8f7a-156f0677aff3', kind: 'private_commercial', label: 'private+commercial' },
  // Heavy trucks > 3.5T → always tjeraup4 (>4T commercial).
  { resourceId: 'cd3acc5c-03c3-4c89-9c54-d40f93c0d790', kind: 'heavy_truck', label: 'heavy_truck' },
  // Public transport: taxis + buses + minibuses. Distinguished by
  // `sug_rechev_nm` ("מונית" / "אוטובוס").
  { resourceId: 'cf29862d-ca25-4691-84f6-1be60dcb4a1e', kind: 'public_transport', label: 'public_transport' },
  // Two-wheelers — no perfect dropdown match, default to "small".
  { resourceId: 'bf9df4e2-d90d-4c0a-a400-19e15af8e95f', kind: 'motorcycle', label: 'motorcycle' },
];

// Vehicle-history datasets used purely for display-only enrichment in
// the MOT price-lookup panel. Coverage is partial (records start at
// 2017-01) so plates registered before then with no transfers/tests
// since simply won't appear — the response just nulls the fields out.
const HISTORY_MILEAGE_RESOURCE = '56063a99-8a3e-4ff4-912e-5966c0279bad';
const HISTORY_OWNERSHIP_RESOURCE = 'bb2355dc-9ec7-4f06-9c3f-3344672171da';

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
  // Display-only enrichment (not persisted to the cars table). The wizard
  // shows these in the MOT price-lookup panel as copy/reference chips.
  trim_level: string | null;
  ownership: string | null;
  mileage: number | null;
  owners_count: number | null;
  // New: which dataset answered, useful for the UI to show a hint
  source: DatasetKind | null;
}

interface DatasetHit {
  kind: DatasetKind;
  record: any;
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

    // Plate-as-int needed for the history datasets, which store
    // mispar_rechev as a numeric column (the search/q endpoint won't
    // match a digit string against an int field, so we filter directly).
    const plateInt = /^\d+$/.test(cleanedNumber) ? parseInt(cleanedNumber, 10) : null;

    // Hit every dataset in parallel — the 4 main registries plus the
    // 2 history datasets. allSettled so a single 5xx from one dataset
    // can't kill the whole lookup.
    const [settled, mileage, ownersCount] = await Promise.all([
      Promise.allSettled(DATASETS.map((ds) => searchDataset(ds, cleanedNumber))),
      plateInt !== null ? fetchMileage(plateInt) : Promise.resolve(null),
      plateInt !== null ? fetchOwnersCount(plateInt) : Promise.resolve(null),
    ]);

    const hits: DatasetHit[] = [];
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      const ds = DATASETS[i];
      if (result.status === 'fulfilled' && result.value) {
        hits.push({ kind: ds.kind, record: result.value });
      } else if (result.status === 'rejected') {
        console.error(`Dataset ${ds.label} lookup failed:`, result.reason);
      }
    }

    if (hits.length === 0) {
      return new Response(JSON.stringify({
        error: 'لم يتم العثور على مركبة بهذا الرقم',
        found: false,
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Prefer the MOST SPECIFIC dataset when more than one answers.
    // A taxi plate appears in both `private_commercial` (the catch-all
    // registry) and `public_transport` (only taxis/buses/minibuses) —
    // letting the catch-all win classified taxis as "خصوصي". The
    // specialised registries hold all the same enrichment fields
    // (tozeret/kinuy_mishari/shnat_yitzur/tzeva_rechev) plus the
    // category we actually want, so they win first.
    const priority: DatasetKind[] = ['public_transport', 'heavy_truck', 'motorcycle', 'private_commercial'];
    hits.sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind));
    const winner = hits[0];

    // Map government API fields to our schema. Field names are mostly
    // the same across datasets; the public_transport one uses
    // `sug_rechev_nm` instead of `sug_degem` for the type label.
    const r = winner.record;
    const licenseType = r.sug_degem ?? r.sug_rechev_nm ?? null;

    const vehicleData: VehicleData = {
      car_number: cleanedNumber,
      manufacturer_name: r.tozeret_nm || r.tozeret_cd || null,
      model: r.kinuy_mishari || null,
      model_number: r.degem_nm || r.degem_cd || null,
      year: r.shnat_yitzur ? parseInt(r.shnat_yitzur) : null,
      color: r.tzeva_rechev || null,
      license_type: licenseType,
      license_expiry: r.tokef_dt || null,
      last_license: r.mivchan_acharon_dt || null,
      car_type: mapCarType(winner.kind, licenseType, r),
      trim_level: r.ramat_gimur || null,
      ownership: r.baalut || null,
      mileage,
      owners_count: ownersCount,
      source: winner.kind,
    };

    console.log('Vehicle data found:', vehicleData);

    return new Response(JSON.stringify({
      success: true,
      found: true,
      data: vehicleData,
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

// Last recorded test odometer for this plate, in km. The history
// dataset only has rows for plates with logged events (color/structure/
// tire change or annual test record), so this returns null for plates
// without a matching record. Best-effort enrichment.
async function fetchMileage(plateInt: number): Promise<number | null> {
  const filter = encodeURIComponent(JSON.stringify({ mispar_rechev: plateInt }));
  const url = `${GOV_API_URL}?resource_id=${HISTORY_MILEAGE_RESOURCE}&filters=${filter}&limit=1`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    const records: any[] = data?.result?.records ?? [];
    if (records.length === 0) return null;
    const km = records[0].kilometer_test_aharon;
    if (typeof km === 'number') return km;
    const parsed = parseInt(String(km), 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Number of distinct private-ownership periods (baalut === "פרטי")
// for this plate. Dealer/lease intermediaries are excluded so the
// count matches what the MOT mehiron's "מספר בעלים" dropdown expects.
// Coverage starts 2017-01; pre-2017 history isn't in the dataset.
async function fetchOwnersCount(plateInt: number): Promise<number | null> {
  const filter = encodeURIComponent(
    JSON.stringify({ mispar_rechev: plateInt, baalut: 'פרטי' }),
  );
  // limit=0 keeps the response tiny — we only want `total`.
  const url = `${GOV_API_URL}?resource_id=${HISTORY_OWNERSHIP_RESOURCE}&filters=${filter}&limit=0`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    const total = data?.result?.total;
    if (typeof total === 'number' && total > 0) return total;
    return null;
  } catch {
    return null;
  }
}

// One CKAN datastore lookup. Returns the matching record (exact plate
// match preferred, otherwise the first row), or null if not found.
async function searchDataset(ds: DatasetSource, cleanedNumber: string): Promise<any | null> {
  const apiUrl = `${GOV_API_URL}?resource_id=${ds.resourceId}&q=${encodeURIComponent(cleanedNumber)}&limit=5`;
  const response = await fetch(apiUrl, { method: 'GET', headers: { Accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${ds.label}`);
  }

  const data = await response.json();
  const records: any[] = data?.result?.records ?? [];
  if (records.length === 0) return null;

  const exact = records.find((r) => String(r.mispar_rechev || '').replace(/[-\s]/g, '') === cleanedNumber);
  return exact ?? null;
}

// Map (dataset, license_type) → one of the six car_type enum values
// the form's CAR_TYPES dropdown understands.
//   car         — خصوصي (private)
//   cargo       — شحن (light commercial van)
//   small       — اوتوبس زعير (minibus / motorcycle fallback)
//   taxi        — تاكسي
//   tjeradown4  — تجاري أقل من 4 طن
//   tjeraup4    — تجاري أكثر من 4 طن (heavy trucks)
function mapCarType(kind: DatasetKind, licenseType: string | null, record: any): string {
  const text = (licenseType || '').toLowerCase();

  switch (kind) {
    case 'public_transport': {
      // sug_rechev_nm: "מונית" → taxi, "אוטובוס" / "מיניבוס" → small
      if (text.includes('מונית') || text.includes('taxi')) return 'taxi';
      if (text.includes('מיניבוס') || text.includes('זעיר')) return 'small';
      if (text.includes('אוטובוס') || text.includes('bus')) return 'small';
      return 'taxi';
    }
    case 'heavy_truck': {
      // Despite the dataset's name ("over 3.5T"), it actually holds
      // BOTH heavy trucks AND vehicles missing a model code, so weights
      // span the whole range. Decide off mishkal_kolel:
      //   > 4000 kg  → tjeraup4
      //   3500–4000 → tjeradown4
      //   < 3500    → cargo (light commercial)
      const weight = parseInt(record?.mishkal_kolel ?? '', 10);
      if (Number.isFinite(weight)) {
        if (weight > 4000) return 'tjeraup4';
        if (weight >= 3500) return 'tjeradown4';
        return 'cargo';
      }
      // No weight on the record — assume the dataset's nominal "heavy"
      // bucket and default to tjeraup4.
      return 'tjeraup4';
    }
    case 'motorcycle':
      // No dropdown option for motorcycles; minibus bucket is the
      // closest visual fit and the user can switch it manually.
      return 'small';
    case 'private_commercial':
    default: {
      // Private+commercial dataset: split on the sug_degem text.
      // "מסחרי" / "פרטי" tags drive the split.
      if (text.includes('מסחר')) {
        // Light-commercial. Use the total weight (mishkal_kolel)
        // when present to pick the < 4T bucket.
        const weight = parseInt(record?.mishkal_kolel ?? '', 10);
        if (Number.isFinite(weight)) {
          if (weight > 4000) return 'tjeraup4';
          if (weight >= 3500) return 'tjeradown4';
        }
        return 'cargo';
      }
      return 'car';
    }
  }
}
