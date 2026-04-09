import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RIVHIT_API_URL = "https://api.rivhit.co.il/online/RivhitOnlineAPI.svc/Document.New";

interface InvoiceRow {
  clientName: string;
  phone: string;
  idNumber: string;
  insuranceType: string;
  fullAmount: number;
  profit: number;
}

interface SendToRivhitRequest {
  rows: InvoiceRow[];
  document_type?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rivhitToken = Deno.env.get("RIVHIT_API_TOKEN");
    if (!rivhitToken) {
      return new Response(JSON.stringify({ error: "RIVHIT_API_TOKEN not configured" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: SendToRivhitRequest = await req.json();
    const { rows, document_type = 1 } = body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return new Response(JSON.stringify({ error: "No rows provided" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[send-to-rivhit] Processing ${rows.length} rows, doc_type=${document_type}`);

    const results: Array<{ index: number; success: boolean; error?: string; doc_number?: number }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      
      // Skip rows with no profit
      if (!row.profit || row.profit <= 0) {
        results.push({ index: i, success: true, error: "Skipped - no profit" });
        continue;
      }

      const payload = {
        api_token: rivhitToken,
        document_type: document_type,
        customer_id: 0,
        last_name: row.clientName || "-",
        id_number: parseInt(row.idNumber) || 0,
        phone: row.phone || "",
        create_customer: true,
        find_by_id: true,
        validate_id: false,
        send_mail: false,
        price_include_vat: false,
        items: [
          {
            description: row.insuranceType || "عمولة تأمين",
            price_nis: row.profit,
            quantity: 1,
          },
        ],
      };

      try {
        const response = await fetch(RIVHIT_API_URL, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const rawText = await response.text();
        console.log(`[send-to-rivhit] Row ${i} raw response (first 300):`, rawText.substring(0, 300));

        let result: any;
        try {
          result = JSON.parse(rawText);
        } catch {
          console.error(`[send-to-rivhit] Row ${i}: non-JSON response`);
          results.push({ index: i, success: false, error: `Non-JSON response: ${rawText.substring(0, 100)}` });
          continue;
        }

        console.log(`[send-to-rivhit] Row ${i}: error_code=${result.error_code}, data=`, JSON.stringify(result.data), `debug_message=${result.debug_message}`);

        if (result.error_code === 0 && result.data) {
          results.push({
            index: i,
            success: true,
            doc_number: result.data.document_number,
            doc_link: result.data.document_link,
          });
        } else {
          results.push({
            index: i,
            success: false,
            error: result.client_message || result.debug_message || `Error code: ${result.error_code}`,
          });
        }
      } catch (fetchError: unknown) {
        const msg = fetchError instanceof Error ? fetchError.message : "Network error";
        console.error(`[send-to-rivhit] Row ${i} fetch error:`, msg);
        results.push({ index: i, success: false, error: msg });
      }

      // Small delay to avoid rate limiting
      if (i < rows.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    console.log(`[send-to-rivhit] Done: ${successCount} success, ${failCount} failed`);

    return new Response(
      JSON.stringify({ success: true, results, successCount, failCount }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("[send-to-rivhit] Fatal:", error);
    const msg = error instanceof Error ? error.message : "Internal server error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
