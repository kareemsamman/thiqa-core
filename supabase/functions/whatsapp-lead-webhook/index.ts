import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface LeadPayload {
  phone: string;
  customer_name?: string;
  car_number?: string;
  car_manufacturer?: string;
  car_model?: string;
  car_year?: string;
  car_color?: string;
  insurance_types?: string[];
  driver_over_24?: boolean;
  has_accidents?: boolean;
  total_price?: number;
  notes?: string;
  source?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Only accept POST requests
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Method not allowed" }),
        {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse request body
    const body: LeadPayload = await req.json();

    console.log("Received lead webhook:", JSON.stringify(body));

    // Validate required fields
    if (!body.phone) {
      return new Response(
        JSON.stringify({ success: false, error: "Phone number is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create Supabase client with service role for INSERT (bypasses RLS)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Prepare lead data
    const leadData = {
      phone: body.phone,
      customer_name: body.customer_name || null,
      car_number: body.car_number || null,
      car_manufacturer: body.car_manufacturer || null,
      car_model: body.car_model || null,
      car_year: body.car_year || null,
      car_color: body.car_color || null,
      insurance_types: body.insurance_types || null,
      driver_over_24: body.driver_over_24 ?? true,
      has_accidents: body.has_accidents ?? false,
      total_price: body.total_price || null,
      notes: body.notes || null,
      source: body.source || "whatsapp",
      status: "new",
    };

    // Insert lead into database
    const { data, error } = await supabase
      .from("leads")
      .insert(leadData)
      .select("id")
      .single();

    if (error) {
      console.error("Error inserting lead:", error);
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Lead created successfully:", data.id);

    return new Response(
      JSON.stringify({ success: true, lead_id: data.id }),
      {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
