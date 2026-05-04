import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ENHANCE_PROMPT =
  "Clean up and modernize this insurance agency logo while preserving the original design intent, colors, and any text exactly as they appear. Improve crispness, contrast, and edge quality. Output a square image with a transparent or clean white background. Do not add new elements, do not change the text, do not add watermarks.";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) throw new Error("AI service not configured");

    const supabase = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: agentUser } = await supabase
      .from("agent_users")
      .select("agent_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!agentUser?.agent_id) {
      return new Response(JSON.stringify({ error: "No agent" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { imageUrl, imageBase64, mimeType } = await req.json();
    if (!imageUrl && !imageBase64) {
      return new Response(JSON.stringify({ error: "Missing image" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let inputBase64: string;
    let inputMime = mimeType || "image/png";
    if (imageBase64) {
      inputBase64 = imageBase64;
    } else {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error("Failed to fetch source image");
      const headerMime = imgRes.headers.get("content-type");
      if (headerMime) inputMime = headerMime.split(";")[0].trim();
      const buf = new Uint8Array(await imgRes.arrayBuffer());
      inputBase64 = bytesToBase64(buf);
    }

    const aiResponse = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image-preview",
          modalities: ["image", "text"],
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: ENHANCE_PROMPT },
                {
                  type: "image_url",
                  image_url: { url: `data:${inputMime};base64,${inputBase64}` },
                },
              ],
            },
          ],
        }),
      },
    );

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("[enhance-logo] AI Gateway error:", aiResponse.status, errText);
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "تم تجاوز حد الطلبات. يرجى المحاولة بعد قليل." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "يرجى تجديد رصيد الذكاء الاصطناعي." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ error: "حدث خطأ في خدمة الذكاء الاصطناعي." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiData = await aiResponse.json();
    const message = aiData.choices?.[0]?.message;
    const images: any[] = message?.images || [];
    const dataUrl = images[0]?.image_url?.url as string | undefined;

    if (!dataUrl) {
      console.error("[enhance-logo] No image in response:", JSON.stringify(aiData).slice(0, 800));
      return new Response(
        JSON.stringify({ error: "لم يتمكن النموذج من إنشاء صورة. حاول مرة أخرى." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ imageDataUrl: dataUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[enhance-logo] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "حدث خطأ غير متوقع" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
