import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AGENT_ID = "6a2e7957-1444-4cb2-a6f8-abc104003fa0";
const BRANCH_ID = "94e2643f-5ff2-4acb-b31d-35f90a87071d"; // بيت صفافا

// Hebrew company name → Arabic name (used for both name and name_ar on insert)
const COMPANY_MAP: Record<string, string> = {
  "אראדי": "الأراضي المقدسة", // already exists
  "וטניה": "وطنية",
  "משרק": "المشرق",
  "טרסט": "الثقة",
  "אהליה": "الأهلية",
  "ברקה": "البركة",
  "עאלמיה": "العالمية",
};

// Service code (Hebrew) → Arabic name for road_services
const SERVICE_MAP: Record<string, string> = {
  "ג": "جرار",
  "ש": "زجاج",
  "רח": "سيارة بديلة",
};

// Israeli vehicle datasets (mirrors fetch-vehicle/index.ts)
const GOV_API_URL = "https://data.gov.il/api/3/action/datastore_search";
const VEHICLE_RESOURCES = [
  "053cea08-09bc-40ec-8f7a-156f0677aff3", // private + light commercial
  "cd3acc5c-03c3-4c89-9c54-d40f93c0d790", // heavy truck
  "cf29862d-ca25-4691-84f6-1be60dcb4a1e", // public transport
  "bf9df4e2-d90d-4c0a-a400-19e15af8e95f", // motorcycle
];

interface CarInfo {
  manufacturer_name: string | null;
  model: string | null;
  model_number: string | null;
  year: number | null;
  color: string | null;
  car_type: string;
  found: boolean;
}

async function fetchVehicle(plate: string): Promise<CarInfo> {
  const cleaned = plate.replace(/[-\s]/g, "").trim();
  for (const rid of VEHICLE_RESOURCES) {
    try {
      const url = `${GOV_API_URL}?resource_id=${rid}&q=${encodeURIComponent(cleaned)}&limit=5`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const data = await res.json();
      const records: any[] = data?.result?.records ?? [];
      const exact = records.find(
        (r) => String(r.mispar_rechev || "").replace(/[-\s]/g, "") === cleaned,
      );
      if (exact) {
        return {
          manufacturer_name: exact.tozeret_nm || null,
          model: exact.kinuy_mishari || null,
          model_number: exact.degem_nm || null,
          year: exact.shnat_yitzur ? parseInt(exact.shnat_yitzur) : null,
          color: exact.tzeva_rechev || null,
          car_type: "car",
          found: true,
        };
      }
    } catch (_e) {
      // continue
    }
  }
  return {
    manufacturer_name: null,
    model: null,
    model_number: null,
    year: null,
    color: null,
    car_type: "car",
    found: false,
  };
}

function parseDate(s: string): string | null {
  // Format: "17    10   2024" → "2024-10-17"
  if (!s) return null;
  const parts = s.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  const dn = parseInt(d, 10);
  const mn = parseInt(m, 10);
  const yn = parseInt(y, 10);
  if (!Number.isFinite(dn) || !Number.isFinite(mn) || !Number.isFinite(yn)) return null;
  if (mn < 1 || mn > 12 || dn < 1 || dn > 31) return null;
  return `${yn}-${String(mn).padStart(2, "0")}-${String(dn).padStart(2, "0")}`;
}

function parsePayment(col14: string): { paid: number | null; status: "full" | "partial" | "none" | "unknown" } {
  const s = (col14 || "").trim();
  if (!s) return { paid: 0, status: "none" };
  // normalise typos: שוךם / ךא → שולם / לא
  const norm = s.replace(/ךם/g, "לם").replace(/^ךא/, "לא");
  if (/^לא\s*שולם/.test(norm)) return { paid: 0, status: "none" };
  // "שולם" alone (with optional trailing space) → full
  if (/^שולם\s*$/.test(norm)) return { paid: null, status: "full" };
  // "שולם NNN" → partial
  const m = norm.match(/שולם[\s]*?(\d+)/);
  if (m) return { paid: parseInt(m[1], 10), status: "partial" };
  return { paid: 0, status: "unknown" };
}

function parseServices(col19: string): { codes: string[]; unknown: string[] } {
  const s = (col19 || "").trim();
  if (!s || s === "אין") return { codes: [], unknown: [] };
  // strip non-Hebrew letters except / (keep ג, ש, רח, פנ, מר, etc.)
  const tokens = s.split(/[\/\s]+/).filter(Boolean);
  const codes: string[] = [];
  const unknown: string[] = [];
  for (const t of tokens) {
    if (t === "ג" || t === "ש" || t === "רח") {
      if (!codes.includes(t)) codes.push(t);
    } else {
      // unknown token - track if it's actually Hebrew/meaningful (not k/t/dates/garbage)
      if (/[\u0590-\u05FF]/.test(t) && t.length <= 4) unknown.push(t);
    }
  }
  return { codes, unknown };
}

function policyChild(col6: string): "THIRD" | "FULL" | null {
  const s = (col6 || "").trim();
  if (s === "צד ג") return "THIRD";
  if (s === "מקיף") return "FULL";
  if (s === "מקיף (צד ג )" || s === "מקיף (צד ג)") return "FULL";
  if (s === "חובה") return null; // ELZAMI - skipped per user instruction
  return null;
}

interface RowInput {
  rowIndex: number;
  first_name: string;
  last_name: string;
  id_number: string;
  policy_number: string;
  car_number: string;
  phone: string;
  policy_type_he: string; // col 6
  insurance_price: string; // col 7
  client_paid: string; // col 8 (ignored per latest user instruction)
  profit: string; // col 9 (ignored)
  ten_percent: string; // col 10 (ignored)
  company_he: string; // col 11
  start_date: string; // col 12
  end_date: string; // col 13
  payment: string; // col 14
  payment_method: string; // col 15 (mixed → all 'cash' per instruction)
  service: string; // col 19
  // cols 20/21 (ELZAMI) ignored
}

interface RowResult {
  rowIndex: number;
  status: "inserted" | "skipped" | "manual";
  reason?: string;
  client_id?: string;
  car_id?: string;
  policy_id?: string;
  road_service_policies?: number;
  car_enriched?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // One-off import token. Function will be DELETED after the import completes.
    const ONE_OFF_TOKEN = "thq4xtz-import-2026-05-04-z9k3j7q1";
    const provided = req.headers.get("x-import-token") || "";
    const authHeader = req.headers.get("Authorization") || "";
    let authorized = provided === ONE_OFF_TOKEN;
    const admin = createClient(supabaseUrl, serviceKey);
    if (!authorized && authHeader) {
      const callerClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user: caller } } = await callerClient.auth.getUser();
      if (caller) {
        const { data: isSA } = await admin.rpc("is_super_admin", { _user_id: caller.id });
        if (isSA) authorized = true;
      }
    }
    if (!authorized) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { rows, dry_run } = body as { rows: RowInput[]; dry_run?: boolean };
    if (!Array.isArray(rows) || rows.length === 0) {
      return json({ error: "rows required" }, 400);
    }

    // Pre-load company map (Hebrew → company id) — create missing ones
    const { data: existingCompanies } = await admin
      .from("insurance_companies")
      .select("id, name, name_ar")
      .eq("agent_id", AGENT_ID);

    // Build lookup: try to match by Arabic name OR Hebrew→Arabic name
    const companyByHe: Map<string, string> = new Map();
    for (const [he, ar] of Object.entries(COMPANY_MAP)) {
      const found = (existingCompanies || []).find(
        (c) => c.name === ar || c.name_ar === ar,
      );
      if (found) companyByHe.set(he, found.id);
    }
    // Insert missing
    for (const [he, ar] of Object.entries(COMPANY_MAP)) {
      if (companyByHe.has(he)) continue;
      if (dry_run) {
        companyByHe.set(he, `<would-create:${ar}>`);
        continue;
      }
      const { data: ins, error } = await admin
        .from("insurance_companies")
        .insert({
          agent_id: AGENT_ID,
          name: ar,
          name_ar: ar,
          active: true,
          category_parent: ["THIRD_FULL"],
        })
        .select("id")
        .single();
      if (error) return json({ error: `Failed to create company ${ar}: ${error.message}` }, 500);
      companyByHe.set(he, ins.id);
    }

    // Pre-load road services (Hebrew code → service id) — create missing
    const { data: existingSvcs } = await admin
      .from("road_services")
      .select("id, name, name_ar")
      .eq("agent_id", AGENT_ID);
    const svcByCode: Map<string, string> = new Map();
    for (const [code, ar] of Object.entries(SERVICE_MAP)) {
      const found = (existingSvcs || []).find(
        (s) => s.name === ar || s.name_ar === ar,
      );
      if (found) svcByCode.set(code, found.id);
    }
    for (const [code, ar] of Object.entries(SERVICE_MAP)) {
      if (svcByCode.has(code)) continue;
      if (dry_run) {
        svcByCode.set(code, `<would-create:${ar}>`);
        continue;
      }
      const { data: ins, error } = await admin
        .from("road_services")
        .insert({
          agent_id: AGENT_ID,
          name: ar,
          name_ar: ar,
          active: true,
          allowed_car_types: ["car"],
        })
        .select("id")
        .single();
      if (error) return json({ error: `Failed to create service ${ar}: ${error.message}` }, 500);
      svcByCode.set(code, ins.id);
    }

    const results: RowResult[] = [];
    console.log("[import] running v2 with BRANCH_ID + file_number");

    // Compute next file_number (format F####)
    const { data: fnRows } = await admin
      .from("clients")
      .select("file_number")
      .eq("agent_id", AGENT_ID)
      .like("file_number", "F%");
    let nextFileNum = 1;
    for (const row of fnRows || []) {
      const m = String(row.file_number || "").match(/^F(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n + 1 > nextFileNum) nextFileNum = n + 1;
      }
    }
    const makeFileNumber = () => `F${String(nextFileNum++).padStart(4, "0")}`;

    for (const row of rows) {
      const r: RowResult = { rowIndex: row.rowIndex, status: "skipped" };

      // Validate basics
      const id_number = (row.id_number || "").trim();
      const car_number = (row.car_number || "").trim();
      const full_name = `${(row.first_name || "").trim()} ${(row.last_name || "").trim()}`.trim();
      if (!id_number || !car_number || !full_name) {
        r.reason = "missing id_number/car_number/name";
        r.status = "manual";
        results.push(r);
        continue;
      }

      const child = policyChild(row.policy_type_he);
      if (!child) {
        r.reason = `unsupported policy type '${row.policy_type_he}' (ELZAMI/חובה skipped per instruction)`;
        r.status = "manual";
        results.push(r);
        continue;
      }

      const company_he = (row.company_he || "").trim();
      if (!company_he) {
        r.reason = "empty insurance company";
        r.status = "manual";
        results.push(r);
        continue;
      }
      const company_id = companyByHe.get(company_he);
      if (!company_id) {
        r.reason = `unknown company '${company_he}'`;
        r.status = "manual";
        results.push(r);
        continue;
      }

      const start_date = parseDate(row.start_date);
      const end_date = parseDate(row.end_date);
      if (!start_date || !end_date) {
        r.reason = `invalid dates start='${row.start_date}' end='${row.end_date}'`;
        r.status = "manual";
        results.push(r);
        continue;
      }

      const insurance_price = parseFloat((row.insurance_price || "0").toString().replace(/,/g, "")) || 0;
      if (insurance_price <= 0) {
        r.reason = `invalid insurance_price '${row.insurance_price}'`;
        r.status = "manual";
        results.push(r);
        continue;
      }

      // 1) Find or create client
      let client_id: string;
      const { data: existingClient } = await admin
        .from("clients")
        .select("id")
        .eq("agent_id", AGENT_ID)
        .eq("id_number", id_number)
        .maybeSingle();

      if (existingClient) {
        client_id = existingClient.id;
      } else {
        const fileNumber = dry_run ? `<F${String(nextFileNum++).padStart(4, "0")}>` : makeFileNumber();
        if (dry_run) {
          client_id = `<would-create-client:${id_number}>`;
        } else {
          const { data: ins, error } = await admin
            .from("clients")
            .insert({
              agent_id: AGENT_ID,
              branch_id: BRANCH_ID,
              file_number: fileNumber,
              full_name,
              id_number,
              phone_number: (row.phone || "").trim() || null,
            })
            .select("id")
            .single();
          if (error) {
            r.reason = `client insert failed: ${error.message}`;
            r.status = "manual";
            results.push(r);
            continue;
          }
          client_id = ins.id;
        }
      }
      r.client_id = client_id;

      // 2) Find or create car (under this client). Lookup by (agent_id, car_number)
      let car_id: string;
      let car_enriched = false;
      const { data: existingCar } = await admin
        .from("cars")
        .select("id")
        .eq("agent_id", AGENT_ID)
        .eq("car_number", car_number)
        .maybeSingle();

      if (existingCar) {
        car_id = existingCar.id;
      } else {
        const info = await fetchVehicle(car_number);
        car_enriched = info.found;
        if (dry_run) {
          car_id = `<would-create-car:${car_number}${info.found ? " enriched" : " no-data"}>`;
        } else {
          const { data: ins, error } = await admin
            .from("cars")
            .insert({
              agent_id: AGENT_ID,
              branch_id: BRANCH_ID,
              client_id,
              car_number,
              manufacturer_name: info.manufacturer_name,
              model: info.model,
              model_number: info.model_number,
              year: info.year,
              color: info.color,
              car_type: info.car_type,
            })
            .select("id")
            .single();
          if (error) {
            r.reason = `car insert failed: ${error.message}`;
            r.status = "manual";
            results.push(r);
            continue;
          }
          car_id = ins.id;
        }
      }
      r.car_id = car_id;
      r.car_enriched = car_enriched;

      // 3) Insert main car policy (THIRD_FULL)
      const policy_number = (row.policy_number || "").trim() || null;
      const payment = parsePayment(row.payment);
      const services = parseServices(row.service);

      let policy_id: string;
      if (dry_run) {
        policy_id = `<would-create-policy:${policy_number || "?"}>`;
      } else {
        const { data: ins, error } = await admin
          .from("policies")
          .insert({
            agent_id: AGENT_ID,
            branch_id: BRANCH_ID,
            client_id,
            car_id,
            company_id,
            policy_type_parent: "THIRD_FULL",
            policy_type_child: child,
            start_date,
            end_date,
            issue_date: start_date,
            insurance_price,
            policy_number,
            cancelled: false,
            transferred: false,
          })
          .select("id")
          .single();
        if (error) {
          r.reason = `policy insert failed: ${error.message}`;
          r.status = "manual";
          results.push(r);
          continue;
        }
        policy_id = ins.id;
      }
      r.policy_id = policy_id;

      // 4) Insert payment if "שולם" or "שולם NNN"
      if (payment.status === "full" || payment.status === "partial") {
        const amount = payment.status === "full" ? insurance_price : (payment.paid || 0);
        if (amount > 0 && !dry_run) {
          const { error } = await admin.from("policy_payments").insert({
            agent_id: AGENT_ID,
            branch_id: BRANCH_ID,
            policy_id,
            payment_type: "cash",
            amount,
            payment_date: start_date,
            source: "user",
            provider: "manual",
            notes: "imported from old records",
          });
          if (error) {
            r.reason = (r.reason ? r.reason + "; " : "") + `payment insert failed: ${error.message}`;
          }
        }
      }

      // 5) Insert road service add-on policies (price 0) — one per code
      let svcCount = 0;
      for (const code of services.codes) {
        const svc_id = svcByCode.get(code);
        if (!svc_id) continue;
        if (dry_run) {
          svcCount++;
          continue;
        }
        const { error } = await admin.from("policies").insert({
          agent_id: AGENT_ID,
          branch_id: BRANCH_ID,
          client_id,
          car_id,
          company_id,
          policy_type_parent: "ROAD_SERVICE",
          start_date,
          end_date,
          issue_date: start_date,
          insurance_price: 0,
          road_service_id: svc_id,
          cancelled: false,
          transferred: false,
        });
        if (!error) svcCount++;
      }
      r.road_service_policies = svcCount;

      r.status = "inserted";
      if (services.unknown.length) {
        r.reason = `unknown service tokens: ${services.unknown.join(",")}`;
      }
      results.push(r);
    }

    return json({ success: true, dry_run: !!dry_run, results });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}