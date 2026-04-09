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

// Parse lead info from chat messages
interface ParsedLeadInfo {
  customer_name: string | null;
  car_manufacturer: string | null;
  car_model: string | null;
  car_year: string | null;
  car_number: string | null;
  insurance_types: string[];
  driver_over_24: boolean | null;
  has_accidents: boolean | null;
  total_price: number | null;
}

// Invalid names to filter out
const INVALID_NAME_PARTS = ["بك في", "Thiqa Insurance", "أنا بوت", "بوت", "تأمين", "Insurance"];

function parseLeadInfoFromMessages(messages: Array<{
  message_type: string;
  content: string;
}>): ParsedLeadInfo {
  const result: ParsedLeadInfo = {
    customer_name: null,
    car_manufacturer: null,
    car_model: null,
    car_year: null,
    car_number: null,
    insurance_types: [],
    driver_over_24: null,
    has_accidents: null,
    total_price: null,
  };

  const confirmedInsuranceTypes = new Set<string>();

  for (const msg of messages) {
    const content = msg.content || "";

    if (msg.message_type === "ai") {
      // Extract customer name from greeting (but filter out invalid names)
      if (!result.customer_name) {
        // Pattern: "أهلاً [name]!" - more specific to avoid false matches
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
      // Look for messages that contain "تمام!" or "المجموع:" - these are final quotes
      const isSummaryMessage = content.includes("تمام!") || content.includes("المجموع:");
      
      if (isSummaryMessage) {
        // Extract total price from summary: "المجموع: 1,250₪" or "المجموع: 1250"
        const totalMatch = content.match(/المجموع[:：]?\s*([\d,]+)\s*₪?/);
        if (totalMatch) {
          result.total_price = parseInt(totalMatch[1].replace(/,/g, ''));
        }

        // Extract insurance types ONLY from confirmed price list
        // Pattern: "طرف ثالث: 900₪" means they chose third party
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

    if (msg.message_type === "human") {
      // Extract car number (7-8 digits only)
      const carNumMatch = content.match(/^\s*(\d{7,8})\s*$/);
      if (carNumMatch) {
        result.car_number = carNumMatch[1];
      }
      
      // Driver age
      if (content.includes("لا") || content.includes("فوق 24")) {
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

    const { phone, lead_id } = await req.json();

    if (!phone || !lead_id) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing phone or lead_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Syncing chat for phone: ${phone}, lead_id: ${lead_id}`);

    // Connect to Redis using the correct connect function
    const redis = await connect({
      hostname: REDIS_HOST,
      port: parseInt(REDIS_PORT),
      password: REDIS_PASSWORD,
    });

    // The key format based on the screenshot: {phone}@c.us
    const redisKey = phone.includes("@c.us") ? phone : `${phone}@c.us`;
    
    console.log(`Fetching from Redis key: ${redisKey}`);

    // Get all messages from the list
    const messages = await redis.lrange(redisKey, 0, -1);
    
    console.log(`Found ${messages.length} messages in Redis`);

    if (messages.length === 0) {
      await redis.close();
      return new Response(
        JSON.stringify({ success: true, messages: [], synced: 0, requiresCallback: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse messages and prepare for insert
    const parsedMessages: Array<{
      lead_id: string;
      phone: string;
      message_type: string;
      content: string;
      metadata: Record<string, unknown>;
    }> = [];

    let requiresCallback = false;

    for (const msgStr of messages) {
      try {
        const msg: ChatMessage = JSON.parse(msgStr);
        
        const content = msg.data?.content || "";
        
        // Check if bot says "تم تسجيل طلبك"
        if (msg.type === "ai" && content.includes("تم تسجيل طلبك")) {
          requiresCallback = true;
        }

        parsedMessages.push({
          lead_id,
          phone: redisKey,
          message_type: msg.type,
          content,
          metadata: {
            additional_kwargs: msg.data?.additional_kwargs || {},
            response_metadata: msg.data?.response_metadata || {},
          },
        });
      } catch (parseError) {
        console.error("Error parsing message:", parseError);
      }
    }

    // Delete existing messages for this lead (full resync)
    await supabase
      .from("lead_messages")
      .delete()
      .eq("lead_id", lead_id);

    // Insert all messages
    if (parsedMessages.length > 0) {
      const { error: insertError } = await supabase
        .from("lead_messages")
        .insert(parsedMessages);

      if (insertError) {
        console.error("Error inserting messages:", insertError);
        throw insertError;
      }
    }

    // Parse lead info from synced messages
    const parsedInfo = parseLeadInfoFromMessages(parsedMessages);

    // Update lead with sync time, callback status, and extracted info
    const updateData: Record<string, unknown> = {
      last_sync_at: new Date().toISOString(),
    };

    if (requiresCallback) {
      updateData.requires_callback = true;
    }

    // Only update fields if we found new data
    if (parsedInfo.customer_name) {
      updateData.customer_name = parsedInfo.customer_name;
    }
    if (parsedInfo.car_manufacturer) {
      updateData.car_manufacturer = parsedInfo.car_manufacturer;
    }
    if (parsedInfo.car_model) {
      updateData.car_model = parsedInfo.car_model;
    }
    if (parsedInfo.car_year) {
      updateData.car_year = parsedInfo.car_year;
    }
    if (parsedInfo.car_number) {
      updateData.car_number = parsedInfo.car_number;
    }
    if (parsedInfo.total_price) {
      updateData.total_price = parsedInfo.total_price;
    }
    if (parsedInfo.insurance_types.length > 0) {
      updateData.insurance_types = parsedInfo.insurance_types;
    }
    if (parsedInfo.driver_over_24 !== null) {
      updateData.driver_over_24 = parsedInfo.driver_over_24;
    }
    if (parsedInfo.has_accidents !== null) {
      updateData.has_accidents = parsedInfo.has_accidents;
    }

    await supabase
      .from("leads")
      .update(updateData)
      .eq("id", lead_id);

    console.log(`Updated lead with parsed info:`, updateData);

    await redis.close();

    console.log(`Successfully synced ${parsedMessages.length} messages, requiresCallback: ${requiresCallback}`);

    return new Response(
      JSON.stringify({
        success: true,
        synced: parsedMessages.length,
        requiresCallback,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Sync error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
