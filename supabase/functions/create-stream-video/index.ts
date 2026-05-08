import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Generate the TUS authorization signature required by Bunny Stream:
// SHA256(libraryId + apiKey + expiration + videoGuid)
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: profile } = await supabase
      .from('profiles').select('status, branch_id').eq('id', user.id).single();
    if (!profile || profile.status !== 'active') {
      return new Response(JSON.stringify({ error: 'User not active' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: agentUser } = await supabase
      .from('agent_users').select('agent_id').eq('user_id', user.id).single();
    if (!agentUser?.agent_id) {
      return new Response(JSON.stringify({ error: 'User not linked to any agent' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LIBRARY_ID = Deno.env.get('BUNNY_STREAM_LIBRARY_ID');
    const API_KEY = Deno.env.get('BUNNY_STREAM_API_KEY');
    if (!LIBRARY_ID || !API_KEY) {
      return new Response(JSON.stringify({ error: 'Bunny Stream not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const title = (typeof body.title === 'string' ? body.title : 'video').slice(0, 200);
    const fileSize = Number(body.file_size) || 0;
    const entityType = body.entity_type as string | null;
    const entityId = body.entity_id as string | null;
    const mimeType = (typeof body.mime_type === 'string' ? body.mime_type : 'video/mp4');

    const MAX = 1024 * 1024 * 1024; // 1 GB
    if (fileSize <= 0 || fileSize > MAX) {
      return new Response(JSON.stringify({ error: 'Invalid file size (max 1GB)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 1: create video object in Bunny Stream
    const createResp = await fetch(
      `https://video.bunnycdn.com/library/${LIBRARY_ID}/videos`,
      {
        method: 'POST',
        headers: {
          'AccessKey': API_KEY,
          'Content-Type': 'application/json',
          'accept': 'application/json',
        },
        body: JSON.stringify({ title }),
      },
    );
    if (!createResp.ok) {
      const t = await createResp.text();
      console.error('Bunny create video failed', createResp.status, t);
      return new Response(JSON.stringify({ error: 'Failed to create video' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const created = await createResp.json();
    const videoGuid: string = created.guid;

    // Step 2: build TUS signature, valid for 24h
    const expirationTime = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const signature = await sha256Hex(
      `${LIBRARY_ID}${API_KEY}${expirationTime}${videoGuid}`,
    );

    // Step 3: insert pending media_files row
    const cdnBase = `https://iframe.mediadelivery.net/embed/${LIBRARY_ID}/${videoGuid}`;
    const { data: mediaFile, error: dbError } = await supabase
      .from('media_files')
      .insert({
        original_name: title,
        mime_type: mimeType,
        size: fileSize,
        cdn_url: cdnBase,
        storage_path: null,
        stream_video_guid: videoGuid,
        stream_library_id: LIBRARY_ID,
        entity_type: entityType,
        entity_id: entityId,
        agent_id: agentUser.agent_id,
        branch_id: profile.branch_id,
        uploaded_by: user.id,
      })
      .select()
      .single();

    if (dbError) {
      console.error('DB insert failed', dbError);
      return new Response(JSON.stringify({ error: 'Failed to save record' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        media_file_id: mediaFile.id,
        video_guid: videoGuid,
        library_id: LIBRARY_ID,
        authorization_signature: signature,
        authorization_expire: expirationTime,
        endpoint: 'https://video.bunnycdn.com/tusupload',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('create-stream-video error', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});