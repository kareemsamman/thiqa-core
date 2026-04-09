import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { connect } from "https://deno.land/x/redis@v0.31.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ChatMessage {
  type: "ai" | "human";
  data: {
    content: string;
    additional_kwargs?: Record<string, unknown>;
    response_metadata?: Record<string, unknown>;
  };
}

// Invalid names to filter out
const INVALID_NAME_PARTS = ["بك في", "Thiqa Insurance", "أنا بوت", "بوت", "تأمين", "Insurance"];

// Parse lead info from chat messages
function parseLeadInfoFromMessages(messages: ChatMessage[]): {
  customer_name: string | null;
  car_manufacturer: string | null;
  car_model: string | null;
  car_year: string | null;
  car_number: string | null;
  insurance_types: string[];
  driver_over_24: boolean | null;
  has_accidents: boolean | null;
  requires_callback: boolean;
  total_price: number | null;
} {
  const result = {
    customer_name: null as string | null,
    car_manufacturer: null as string | null,
    car_model: null as string | null,
    car_year: null as string | null,
    car_number: null as string | null,
    insurance_types: [] as string[],
    driver_over_24: null as boolean | null,
    has_accidents: null as boolean | null,
    requires_callback: false,
    total_price: null as number | null,
  };

  const confirmedInsuranceTypes = new Set<string>();

  for (const msg of messages) {
    const content = msg.data?.content || "";

    // Check for callback request
    if (msg.type === "ai" && content.includes("تم تسجيل طلبك")) {
      result.requires_callback = true;
    }

    // Try to extract info from bot responses
    if (msg.type === "ai") {
      // Extract customer name from greeting (filter out invalid names)
      if (!result.customer_name) {
        // Pattern: "أهلاً [name]!" - specific to avoid false matches
        const greetingMatch = content.match(/أهلاً\s+([^\s،,!؟\n]{2,20})[،,!]/);
        if (greetingMatch) {
          const name = greetingMatch[1].trim();
          const isValid = !INVALID_NAME_PARTS.some(invalid => name.includes(invalid));
          if (isValid && name.length >= 2 && name.length <= 20) {
            result.customer_name = name;
          }
        }
      }

      // Extract car info: "سيارتك مازدا 3 موديل 2010"
      const carMatch = content.match(/سيارتك\s+(\S+)\s+(\S+)\s+موديل\s+(\d{4})/);
      if (carMatch) {
        result.car_manufacturer = carMatch[1];
        result.car_model = carMatch[2];
        result.car_year = carMatch[3];
      }

      // IMPROVED: Only extract price and insurance from SUMMARY messages
      const isSummaryMessage = content.includes("تمام!") || content.includes("المجموع:");
      
      if (isSummaryMessage) {
        // Extract total price: "المجموع: 1,250₪"
        const totalMatch = content.match(/المجموع[:：]?\s*([\d,]+)\s*₪?/);
        if (totalMatch) {
          result.total_price = parseInt(totalMatch[1].replace(/,/g, ''));
        }

        // Extract insurance types ONLY from confirmed price list
        if (content.match(/طرف ثالث[:：]\s*\d+/)) {
          confirmedInsuranceTypes.add("طرف ثالث");
        }
        if (content.match(/إلزامي[:：]\s*\d+/)) {
          confirmedInsuranceTypes.add("إلزامي");
        }
        if (content.match(/شامل[:：]\s*\d+/)) {
          confirmedInsuranceTypes.add("شامل");
        }
        if (content.match(/خدمات طريق[:：]\s*\d+/)) {
          confirmedInsuranceTypes.add("خدمات طريق");
        }
        if (content.match(/رسوم حوادث[:：]\s*\d+/)) {
          confirmedInsuranceTypes.add("رسوم حوادث");
        }
      }
    }

    // Extract car number from human messages
    if (msg.type === "human") {
      const carNumMatch = content.match(/^\s*(\d{7,8})\s*$/);
      if (carNumMatch) {
        result.car_number = carNumMatch[1];
      }
      
      // Driver age
      if (content.includes("لا") || content === "לא" || content.includes("فوق 24")) {
        result.driver_over_24 = true;
      } else if (content.includes("نعم") && content.includes("تحت 24")) {
        result.driver_over_24 = false;
      }
      
      // Accidents
      if (content.includes("صحيح") || content.includes("لا يوجد")) {
        result.has_accidents = false;
      }
    }
  }

  result.insurance_types = Array.from(confirmedInsuranceTypes);

  return result;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const REDIS_HOST = Deno.env.get("REDIS_HOST");
    const REDIS_PORT = Deno.env.get("REDIS_PORT");
    const REDIS_PASSWORD = Deno.env.get("REDIS_PASSWORD");

    if (!REDIS_HOST || !REDIS_PORT || !REDIS_PASSWORD) {
      throw new Error("Missing Redis configuration");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Connecting to Redis...");

    // Connect to Redis
    const redis = await connect({
      hostname: REDIS_HOST,
      port: parseInt(REDIS_PORT),
      password: REDIS_PASSWORD,
    });

    // Scan for all keys matching the WhatsApp phone pattern
    const keys: string[] = [];
    let cursor = 0;
    
    do {
      const result = await redis.scan(cursor, { pattern: "*@c.us", count: 100 });
      cursor = typeof result[0] === "string" ? parseInt(result[0]) : result[0];
      const foundKeys = result[1];
      
      for (const key of foundKeys) {
        // Only include LIST keys (chat history), not STRING keys (latest_batch)
        const keyType = await redis.type(key);
        if (keyType === "list") {
          keys.push(key);
        }
      }
    } while (cursor !== 0);

    console.log(`Found ${keys.length} chat keys in Redis`);

    if (keys.length === 0) {
      await redis.close();
      return new Response(
        JSON.stringify({ success: true, discovered: 0, created: 0, keys: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get existing leads by phone to avoid duplicates
    const phones = keys.map((k) => k.replace("@c.us", ""));
    const { data: existingLeads } = await supabase
      .from("leads")
      .select("phone")
      .in("phone", phones);

    const existingPhones = new Set(existingLeads?.map((l) => l.phone) || []);
    
    console.log(`${existingPhones.size} leads already exist`);

    let created = 0;
    const newLeads: Array<{phone: string; lead_id: string}> = [];

    for (const key of keys) {
      const phone = key.replace("@c.us", "");
      
      // Skip if lead already exists
      if (existingPhones.has(phone)) {
        continue;
      }

      console.log(`Processing new lead: ${phone}`);

      // Get messages from Redis to parse lead info
      const messages = await redis.lrange(key, 0, -1);
      const parsedMessages: ChatMessage[] = [];
      
      for (const msgStr of messages) {
        try {
          const msg: ChatMessage = JSON.parse(msgStr);
          parsedMessages.push(msg);
        } catch {
          // Skip unparseable messages
        }
      }

      // Parse lead info from messages
      const leadInfo = parseLeadInfoFromMessages(parsedMessages);

      // Create the lead
      const { data, error } = await supabase
        .from("leads")
        .insert({
          phone,
          customer_name: leadInfo.customer_name,
          car_number: leadInfo.car_number,
          car_manufacturer: leadInfo.car_manufacturer,
          car_model: leadInfo.car_model,
          car_year: leadInfo.car_year,
          insurance_types: leadInfo.insurance_types.length > 0 ? leadInfo.insurance_types : null,
          driver_over_24: leadInfo.driver_over_24,
          has_accidents: leadInfo.has_accidents,
          requires_callback: leadInfo.requires_callback,
          source: "whatsapp",
          status: "new",
        })
        .select("id")
        .single();

      if (error) {
        console.error(`Error creating lead for ${phone}:`, error);
        continue;
      }

      created++;
      newLeads.push({ phone, lead_id: data.id });

      // Also sync the messages for this lead
      const leadMessages = parsedMessages.map((msg) => ({
        lead_id: data.id,
        phone: key,
        message_type: msg.type,
        content: msg.data?.content || "",
        metadata: {
          additional_kwargs: msg.data?.additional_kwargs || {},
          response_metadata: msg.data?.response_metadata || {},
        },
      }));

      if (leadMessages.length > 0) {
        const { error: msgError } = await supabase
          .from("lead_messages")
          .insert(leadMessages);
        
        if (msgError) {
          console.error(`Error syncing messages for ${phone}:`, msgError);
        }
      }
    }

    await redis.close();

    console.log(`Discovery complete: ${created} new leads created`);

    return new Response(
      JSON.stringify({
        success: true,
        discovered: keys.length,
        existing: existingPhones.size,
        created,
        newLeads,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Discovery error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
