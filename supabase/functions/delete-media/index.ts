import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
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
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
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
      return new Response(JSON.stringify({ error: 'User not active' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user is admin
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    const isAdmin = !!roleData;

    // Get file IDs from request body
    const { fileIds } = await req.json();

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return new Response(JSON.stringify({ error: 'No file IDs provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get files to delete (check ownership if not admin)
    let query = supabase
      .from('media_files')
      .select('id, storage_path, uploaded_by')
      .in('id', fileIds)
      .is('deleted_at', null);

    if (!isAdmin) {
      query = query.eq('uploaded_by', user.id);
    }

    const { data: files, error: fetchError } = await query;

    if (fetchError) {
      console.error('Fetch error:', fetchError);
      return new Response(JSON.stringify({ error: 'Failed to fetch files' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!files || files.length === 0) {
      return new Response(JSON.stringify({ error: 'No files found or unauthorized' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Delete from Bunny Storage first
    const BUNNY_API_KEY = Deno.env.get('BUNNY_API_KEY');
    const BUNNY_STORAGE_ZONE = Deno.env.get('BUNNY_STORAGE_ZONE');

    if (BUNNY_API_KEY && BUNNY_STORAGE_ZONE) {
      for (const file of files) {
        try {
          const deleteUrl = `https://storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${file.storage_path}`;
          console.log(`Deleting from Bunny: ${deleteUrl}`);
          const bunnyResponse = await fetch(deleteUrl, {
            method: 'DELETE',
            headers: { 'AccessKey': BUNNY_API_KEY },
          });
          if (!bunnyResponse.ok) {
            console.warn(`Failed to delete from Bunny: ${file.storage_path}`, await bunnyResponse.text());
          }
        } catch (e) {
          console.warn(`Error deleting from Bunny: ${file.storage_path}`, e);
        }
      }
    }

    // Soft delete files in database
    const { error: updateError } = await supabase
      .from('media_files')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', files.map(f => f.id));

    if (updateError) {
      console.error('Update error:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to delete files' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Deleted ${files.length} files from Bunny and marked as deleted in DB`);

    return new Response(JSON.stringify({ 
      success: true, 
      deletedCount: files.length 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Delete error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
