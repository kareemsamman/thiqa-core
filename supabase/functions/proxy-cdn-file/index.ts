import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const ALLOWED_PREFIX = Deno.env.get('BUNNY_CDN_URL') ? `${Deno.env.get('BUNNY_CDN_URL')}/` : "https://kareem.b-cdn.net/";

function corsHeaders(origin: string | null) {
  const allowOrigin = origin ?? "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  } as Record<string, string>;
}

serve(async (req) => {
  const origin = req.headers.get("Origin");
  const baseHeaders = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: baseHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: baseHeaders });
  }

  let url: unknown;
  try {
    const body = await req.json();
    url = body?.url;
  } catch {
    // ignore
  }

  if (typeof url !== "string" || !url) {
    return new Response("Missing url", { status: 400, headers: baseHeaders });
  }

  if (!url.startsWith(ALLOWED_PREFIX)) {
    return new Response("Forbidden", { status: 403, headers: baseHeaders });
  }

  const upstream = await fetch(url);
  if (!upstream.ok) {
    return new Response(`Upstream error: ${upstream.status}`, {
      status: 502,
      headers: baseHeaders,
    });
  }

  const contentType = upstream.headers.get("content-type") || "application/pdf";
  const headers = new Headers(baseHeaders);
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "private, max-age=300");

  return new Response(upstream.body, { status: 200, headers });
});
