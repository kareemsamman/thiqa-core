import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Allowed MIME types with their magic bytes and valid extensions
const ALLOWED_FILE_TYPES: Record<string, { magicBytes: number[][], extensions: string[] }> = {
  'image/jpeg': { 
    magicBytes: [[0xFF, 0xD8, 0xFF]], 
    extensions: ['jpg', 'jpeg'] 
  },
  'image/png': { 
    magicBytes: [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]], 
    extensions: ['png'] 
  },
  'image/webp': { 
    magicBytes: [[0x52, 0x49, 0x46, 0x46]], // RIFF header (WebP starts with RIFF)
    extensions: ['webp'] 
  },
  'image/gif': { 
    magicBytes: [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]], // GIF87a, GIF89a
    extensions: ['gif'] 
  },
  'application/pdf': { 
    magicBytes: [[0x25, 0x50, 0x44, 0x46]], // %PDF
    extensions: ['pdf'] 
  },
  'application/msword': { 
    magicBytes: [[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]], // OLE compound file
    extensions: ['doc'] 
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { 
    magicBytes: [[0x50, 0x4B, 0x03, 0x04]], // PK (ZIP-based)
    extensions: ['docx'] 
  },
  'video/mp4': { 
    magicBytes: [[0x00, 0x00, 0x00], [0x66, 0x74, 0x79, 0x70]], // ftyp signature (offset varies)
    extensions: ['mp4'] 
  },
  'video/webm': { 
    magicBytes: [[0x1A, 0x45, 0xDF, 0xA3]], // EBML header
    extensions: ['webm'] 
  },
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const RATE_LIMIT_UPLOADS_PER_HOUR = 100;
const MAX_BYTES_PER_HOUR = 500 * 1024 * 1024; // 500MB total per hour

// Verify file content matches declared MIME type using magic bytes
function verifyMagicBytes(buffer: Uint8Array, mimeType: string): boolean {
  const typeConfig = ALLOWED_FILE_TYPES[mimeType];
  if (!typeConfig) return false;
  
  for (const magicSequence of typeConfig.magicBytes) {
    let matches = true;
    // Special case for MP4 - check for 'ftyp' at offset 4
    if (mimeType === 'video/mp4') {
      const ftypCheck = buffer.length > 8 && 
        buffer[4] === 0x66 && buffer[5] === 0x74 && 
        buffer[6] === 0x79 && buffer[7] === 0x70;
      if (ftypCheck) return true;
      continue;
    }
    
    for (let i = 0; i < magicSequence.length; i++) {
      if (buffer[i] !== magicSequence[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

// Verify file extension matches declared MIME type
function verifyExtension(filename: string, mimeType: string): boolean {
  const typeConfig = ALLOWED_FILE_TYPES[mimeType];
  if (!typeConfig) return false;
  
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return typeConfig.extensions.includes(ext);
}

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

    // Check if user is active and get their branch
    const { data: profile } = await supabase
      .from('profiles')
      .select('status, branch_id')
      .eq('id', user.id)
      .single();

    if (!profile || profile.status !== 'active') {
      return new Response(JSON.stringify({ error: 'User not active' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userBranchId = profile.branch_id;

    // Get the user's agent_id for folder isolation
    const { data: agentUser } = await supabase
      .from('agent_users')
      .select('agent_id')
      .eq('user_id', user.id)
      .single();

    const agentId = agentUser?.agent_id;
    if (!agentId) {
      return new Response(JSON.stringify({ error: 'User not linked to any agent' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Rate limiting - check uploads in last hour
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { data: recentUploads, count: uploadCount } = await supabase
      .from('media_files')
      .select('size', { count: 'exact' })
      .eq('uploaded_by', user.id)
      .gte('created_at', oneHourAgo);

    if (uploadCount !== null && uploadCount >= RATE_LIMIT_UPLOADS_PER_HOUR) {
      console.warn(`Rate limit exceeded for user ${user.id}: ${uploadCount} uploads in last hour`);
      return new Response(JSON.stringify({ error: 'Upload limit exceeded. Please try again later.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Size-based rate limiting - check total bytes uploaded in last hour
    const totalBytesUploaded = recentUploads?.reduce((sum, file) => sum + (file.size || 0), 0) || 0;
    if (totalBytesUploaded >= MAX_BYTES_PER_HOUR) {
      console.warn(`Storage quota exceeded for user ${user.id}: ${totalBytesUploaded} bytes in last hour`);
      return new Response(JSON.stringify({ error: 'Storage quota exceeded. Please try again later.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get Bunny credentials
    const BUNNY_API_KEY = Deno.env.get('BUNNY_API_KEY');
    const rawStorageZone = Deno.env.get('BUNNY_STORAGE_ZONE') || '';

    // Normalize storage zone: strip protocol, domain, and slashes
    let BUNNY_STORAGE_ZONE = rawStorageZone
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '');
    // If it looks like "storage.bunnycdn.com/zonename", extract just the zone
    if (BUNNY_STORAGE_ZONE.startsWith('storage.bunnycdn.com')) {
      const parts = BUNNY_STORAGE_ZONE.split('/').filter(Boolean);
      BUNNY_STORAGE_ZONE = parts[1] || '';
    }
    // If still looks like a full domain, try to infer from CDN URL
    if (!BUNNY_STORAGE_ZONE || BUNNY_STORAGE_ZONE === 'storage.bunnycdn.com') {
      const cdnUrl = Deno.env.get('BUNNY_CDN_URL') || '';
      BUNNY_STORAGE_ZONE = cdnUrl.replace(/^https?:\/\//i, '').split('.')[0] || '';
    }

    console.log(`[upload-media] Resolved storage zone: "${BUNNY_STORAGE_ZONE}"`);

    if (!BUNNY_API_KEY || !BUNNY_STORAGE_ZONE) {
      console.error('Missing Bunny configuration');
      return new Response(JSON.stringify({ error: 'Storage not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse form data
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const entityType = formData.get('entity_type') as string | null;
    const entityId = formData.get('entity_id') as string | null;

    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate file type from header
    if (!ALLOWED_FILE_TYPES[file.type]) {
      console.warn(`Rejected file type: ${file.type}`);
      return new Response(JSON.stringify({ error: 'File type not allowed' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate file extension matches MIME type
    if (!verifyExtension(file.name, file.type)) {
      console.warn(`Extension mismatch: ${file.name} claimed as ${file.type}`);
      return new Response(JSON.stringify({ error: 'File extension does not match file type' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return new Response(JSON.stringify({ error: 'File too large (max 50MB)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Read file content for magic byte verification
    const fileBuffer = await file.arrayBuffer();
    const fileBytes = new Uint8Array(fileBuffer);

    // Verify magic bytes match declared MIME type
    if (!verifyMagicBytes(fileBytes, file.type)) {
      console.warn(`Magic byte mismatch for ${file.name} (claimed ${file.type})`);
      return new Response(JSON.stringify({ error: 'File content does not match declared type' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Generate organized path: agents/{agent_id}/YYYY/MM/filename.ext
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const timestamp = Date.now();
    const randomId = crypto.randomUUID().slice(0, 8);
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
    const sanitizedName = file.name
      .replace(/\.[^/.]+$/, '') // Remove extension
      .replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]/g, '_') // Keep Arabic chars too
      .slice(0, 40);
    const storagePath = `agents/${agentId}/${year}/${month}/${timestamp}_${randomId}_${sanitizedName}.${ext}`;

    // Upload to Bunny Storage
    const bunnyUploadUrl = `https://storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${storagePath}`;

    console.log(`Uploading to Bunny: ${bunnyUploadUrl}`);

    const uploadResponse = await fetch(bunnyUploadUrl, {
      method: 'PUT',
      headers: {
        'AccessKey': BUNNY_API_KEY,
        'Content-Type': 'application/octet-stream',
      },
      body: fileBuffer,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('Bunny upload failed:', errorText);
      return new Response(JSON.stringify({ error: 'Upload failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Construct CDN URL from env
    const cdnBaseUrl = Deno.env.get('BUNNY_CDN_URL') || 'https://cdn.thiqacrm.com';
    const cdnUrl = `${cdnBaseUrl}/${storagePath}`;

    // Save to database with user's branch_id
    const { data: mediaFile, error: dbError } = await supabase
      .from('media_files')
      .insert({
        original_name: file.name,
        mime_type: file.type,
        size: file.size,
        cdn_url: cdnUrl,
        storage_path: storagePath,
        entity_type: entityType,
        entity_id: entityId,
        uploaded_by: user.id,
        branch_id: userBranchId,
        agent_id: agentId,
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      return new Response(JSON.stringify({ error: 'Failed to save file metadata' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`File uploaded successfully: ${cdnUrl}`);

    return new Response(JSON.stringify({ 
      success: true, 
      file: mediaFile 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Upload error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
