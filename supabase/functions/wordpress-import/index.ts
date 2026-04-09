import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Branch ID for بيت حنينا
const BEIT_HANINA_BRANCH_ID = '146727e4-170a-4f65-b3f8-679a9beb3016';

// Date conversion: d-m-Y to YYYY-MM-DD
function convertDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const match = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
}

// Policy type parent mapping
function mapPolicyTypeParent(wpType: string | null | undefined): string | null {
  if (!wpType) return null;
  const mapping: Record<string, string> = {
    'ELZAMI': 'ELZAMI',
    'THIRD_FULL': 'THIRD_FULL',
    'ROAD_SERVICE': 'ROAD_SERVICE',
    'ACCIDENT_FEE_EXEMPTION': 'ACCIDENT_FEE_EXEMPTION',
    'HEALTH': 'HEALTH',
    'LIFE': 'LIFE',
    'PROPERTY': 'PROPERTY',
    'TRAVEL': 'TRAVEL',
    'BUSINESS': 'BUSINESS',
    'OTHER': 'OTHER',
  };
  return mapping[wpType.toUpperCase()] || null;
}

// Policy type child mapping
function mapPolicyTypeChild(wpType: string | null | undefined): string | null {
  if (!wpType) return null;
  const mapping: Record<string, string> = {
    'THIRD': 'THIRD',
    'FULL': 'FULL',
  };
  return mapping[wpType.toUpperCase()] || null;
}

// Car type mapping from Arabic to enum
function mapCarType(wpType: string | null | undefined): string {
  if (!wpType) return 'car';
  const mapping: Record<string, string> = {
    'car': 'car',
    'cargo': 'cargo',
    'small': 'small',
    'taxi': 'taxi',
    'tjeradown4': 'tjeradown4',
    'tjeraup4': 'tjeraup4',
    'سيارة': 'car',
    'شاحنة': 'cargo',
    'صغيرة': 'small',
    'تكسي': 'taxi',
    'تجارية تحت 4 طن': 'tjeradown4',
    'تجارية فوق 4 طن': 'tjeraup4',
  };
  return mapping[wpType.toLowerCase()] || 'car';
}

// Payment type mapping - also accepts check_number to determine if it's a cheque
function mapPaymentType(wpType: string | null | undefined, notes?: string | null, checkNumber?: string | null): string {
  // If there's a check_number but no explicit type, it's a cheque
  if (checkNumber && checkNumber.trim() && (!wpType || wpType.trim() === '')) {
    return 'cheque';
  }
  
  if (notes) {
    const match = notes.match(/Payment Way:\s*(\w+)/i);
    if (match) {
      const extracted = match[1].toLowerCase();
      if (['visa', 'فيزا'].includes(extracted)) return 'visa';
      if (['cheque', 'check', 'شيك', 'shekat', 'شيكات'].includes(extracted)) return 'cheque';
      if (['transfer', 'حوالة', 'bank_transfer'].includes(extracted)) return 'transfer';
      if (['cash', 'كاش'].includes(extracted)) return 'cash';
    }
  }
  
  if (!wpType || wpType.trim() === '') {
    // Default to cash if no type and no check_number
    return 'cash';
  }
  
  const typeStr = wpType.toLowerCase().trim();
  const mapping: Record<string, string> = {
    'cash': 'cash',
    'كاش': 'cash',
    'cheque': 'cheque',
    'check': 'cheque',
    'شيك': 'cheque',
    'shekat': 'cheque',
    'شيكات': 'cheque',
    'visa': 'visa',
    'فيزا': 'visa',
    'transfer': 'transfer',
    'حوالة': 'transfer',
    'bank_transfer': 'transfer',
  };
  return mapping[typeStr] || 'cash';
}

// Upload file from URL to Bunny CDN
async function uploadToBunnyCDN(
  fileUrl: string, 
  BUNNY_API_KEY: string, 
  BUNNY_STORAGE_ZONE: string
): Promise<{ cdnUrl: string; storagePath: string; mimeType: string; size: number } | null> {
  try {
    console.log(`Downloading file from: ${fileUrl}`);
    
    const response = await fetch(fileUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WordPress-Import/1.0)' }
    });
    
    if (!response.ok) {
      console.warn(`Failed to download: ${fileUrl} - ${response.status}`);
      return null;
    }
    
    const fileBuffer = await response.arrayBuffer();
    const size = fileBuffer.byteLength;
    
    const urlLower = fileUrl.toLowerCase();
    let mimeType = 'application/octet-stream';
    if (urlLower.endsWith('.pdf')) mimeType = 'application/pdf';
    else if (urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg')) mimeType = 'image/jpeg';
    else if (urlLower.endsWith('.png')) mimeType = 'image/png';
    else if (urlLower.endsWith('.webp')) mimeType = 'image/webp';
    else if (urlLower.endsWith('.gif')) mimeType = 'image/gif';
    
    const urlParts = fileUrl.split('/');
    let originalName = urlParts[urlParts.length - 1] || 'file';
    originalName = decodeURIComponent(originalName.split('?')[0]);
    
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const timestamp = Date.now();
    const randomId = crypto.randomUUID().slice(0, 8);
    const ext = originalName.split('.').pop()?.toLowerCase() || 'bin';
    const storagePath = `wp-import/${year}/${month}/${timestamp}_${randomId}.${ext}`;
    
    const bunnyUploadUrl = `https://storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${storagePath}`;
    
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
      console.error(`Bunny upload failed for ${fileUrl}:`, errorText);
      return null;
    }
    
    const cdnBaseUrl = Deno.env.get('BUNNY_CDN_URL') || 'https://kareem.b-cdn.net';
    const cdnUrl = `${cdnBaseUrl}/${storagePath}`;
    console.log(`Uploaded to CDN: ${cdnUrl}`);
    
    return { cdnUrl, storagePath, mimeType, size };
  } catch (error) {
    console.error(`Error uploading ${fileUrl}:`, error);
    return null;
  }
}

// Parallel upload with concurrency limit
async function uploadMediaParallel(
  mediaItems: any[],
  supabase: any,
  mappings: any,
  BUNNY_API_KEY: string,
  BUNNY_STORAGE_ZONE: string,
  progressId: string,
  concurrency: number = 10
): Promise<{ inserted: number; failed: number; errors: string[] }> {
  const results = { inserted: 0, failed: 0, errors: [] as string[] };
  
  for (let i = 0; i < mediaItems.length; i += concurrency) {
    const batch = mediaItems.slice(i, i + concurrency);
    
    const promises = batch.map(async (media) => {
      try {
        const policyId = media.policy_legacy_wp_id ? mappings.policies?.[media.policy_legacy_wp_id] : null;
        if (!policyId || !media.url) {
          return { success: false, error: 'Missing policy or URL' };
        }

        // Check if already exists
        const { data: existingMedia } = await supabase
          .from('media_files')
          .select('id')
          .eq('entity_id', policyId)
          .eq('entity_type', 'policy')
          .ilike('original_name', `%${media.url.split('/').pop()}%`)
          .maybeSingle();

        if (existingMedia) {
          return { success: true, skipped: true };
        }

        const originalName = decodeURIComponent(media.url.split('/').pop() || 'file');
        let cdnUrl = media.url;
        let storagePath = media.url;
        let mimeType = media.url.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
        let size = 0;

        // Upload to Bunny CDN
        const uploadResult = await uploadToBunnyCDN(media.url, BUNNY_API_KEY, BUNNY_STORAGE_ZONE);
        if (uploadResult) {
          cdnUrl = uploadResult.cdnUrl;
          storagePath = uploadResult.storagePath;
          mimeType = uploadResult.mimeType;
          size = uploadResult.size;
        }

        const { error } = await supabase
          .from('media_files')
          .insert({
            cdn_url: cdnUrl,
            storage_path: storagePath,
            original_name: originalName,
            mime_type: mimeType,
            size: size,
            entity_type: 'policy',
            entity_id: policyId,
            branch_id: BEIT_HANINA_BRANCH_ID,
          });

        if (error) {
          return { success: false, error: `${originalName}: ${error.message}` };
        }
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });

    const batchResults = await Promise.all(promises);
    
    for (const result of batchResults) {
      if (result.success) {
        if (!result.skipped) results.inserted++;
      } else {
        results.failed++;
        if (result.error) results.errors.push(result.error);
      }
    }

    // Update progress
    const processed = Math.min(i + concurrency, mediaItems.length);
    const avgTimePerItem = 2.5; // seconds
    const remainingItems = mediaItems.length - processed;
    const estimatedSecondsRemaining = (remainingItems / concurrency) * avgTimePerItem;
    const estimatedFinish = new Date(Date.now() + estimatedSecondsRemaining * 1000);

    await supabase
      .from('import_progress')
      .update({
        processed_items: processed,
        failed_items: results.failed,
        estimated_finish_at: estimatedFinish.toISOString(),
        error_log: results.errors.slice(-50), // Keep last 50 errors
      })
      .eq('id', progressId);
  }

  return results;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const BUNNY_API_KEY = Deno.env.get('BUNNY_API_KEY');
    const BUNNY_STORAGE_ZONE = Deno.env.get('BUNNY_STORAGE_ZONE');

    const { action, data, entityType, batch, progressId } = await req.json();

    // Action: Preserve pricing rules before company deletion
    if (action === 'preservePricingRules') {
      console.log('Preserving pricing rules with company names...');
      
      // Get all pricing rules with company names
      const { data: rules, error } = await supabase
        .from('pricing_rules')
        .select(`
          *,
          insurance_companies!inner(name, name_ar)
        `);

      if (error) throw error;

      // Map rules by company name (lowercase for matching)
      const preservedRules: Record<string, any[]> = {};
      for (const rule of rules || []) {
        const companyName = (rule.insurance_companies?.name || '').toLowerCase();
        const companyNameAr = (rule.insurance_companies?.name_ar || '').toLowerCase();
        
        if (companyName) {
          if (!preservedRules[companyName]) preservedRules[companyName] = [];
          preservedRules[companyName].push({
            ...rule,
            insurance_companies: undefined,
            company_id: undefined,
            id: undefined,
          });
        }
        if (companyNameAr && companyNameAr !== companyName) {
          if (!preservedRules[companyNameAr]) preservedRules[companyNameAr] = [];
          preservedRules[companyNameAr].push({
            ...rule,
            insurance_companies: undefined,
            company_id: undefined,
            id: undefined,
          });
        }
      }

      console.log(`Preserved ${rules?.length || 0} pricing rules from ${Object.keys(preservedRules).length} companies`);

      return new Response(JSON.stringify({ success: true, preservedRules, count: rules?.length || 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: Delete all insurance companies (but preserve rules separately)
    if (action === 'deleteCompanies') {
      console.log('🏢 Deleting all insurance companies (resetCompanies)...');

      const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

      const clearTable = async (table: string) => {
        const { error } = await supabase.from(table).delete().neq('id', ZERO_UUID);
        if (error) {
          console.error(`❌ deleteCompanies: failed clearing ${table}: ${error.message}`);
          throw error;
        }
        console.log(`✅ deleteCompanies: cleared ${table}`);
      };

      // Company-scoped configuration tables (must be removed before deleting companies)
      await clearTable('pricing_rules');
      await clearTable('company_road_service_prices');
      await clearTable('company_accident_fee_prices');
      await clearTable('company_accident_templates');

      // If policies still exist (e.g., clear step disabled), detach company references.
      const { error: policiesUpdateError } = await supabase
        .from('policies')
        .update({ company_id: null })
        .neq('id', ZERO_UUID);
      if (policiesUpdateError) {
        console.error(`❌ deleteCompanies: failed to null company_id in policies: ${policiesUpdateError.message}`);
        throw policiesUpdateError;
      }

      // Also detach from accident reports if present
      const { error: accidentReportsUpdateError } = await supabase
        .from('accident_reports')
        .update({ company_id: null })
        .neq('id', ZERO_UUID);
      if (accidentReportsUpdateError) {
        console.error(`❌ deleteCompanies: failed to null company_id in accident_reports: ${accidentReportsUpdateError.message}`);
        throw accidentReportsUpdateError;
      }

      // Finally delete companies
      const { error: companiesError } = await supabase
        .from('insurance_companies')
        .delete()
        .neq('id', ZERO_UUID);

      if (companiesError) {
        console.error(`❌ deleteCompanies: failed deleting insurance_companies: ${companiesError.message}`);
        throw companiesError;
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'All insurance companies deleted (pricing rules cleared for restore)',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // Action: Restore pricing rules to new companies
    if (action === 'restorePricingRules') {
      const { preservedRules } = data;
      console.log('Restoring pricing rules to new companies...');

      // Get all new companies
      const { data: companies } = await supabase.from('insurance_companies').select('id, name, name_ar');
      
      const companyMap: Record<string, string> = {};
      for (const c of companies || []) {
        if (c.name) companyMap[c.name.toLowerCase()] = c.id;
        if (c.name_ar) companyMap[c.name_ar.toLowerCase()] = c.id;
      }

      let restored = 0;
      let notFound = 0;

      for (const [companyName, rules] of Object.entries(preservedRules || {})) {
        const companyId = companyMap[companyName.toLowerCase()];
        if (companyId && Array.isArray(rules)) {
          for (const rule of rules) {
            const { error } = await supabase.from('pricing_rules').insert({
              ...rule,
              company_id: companyId,
            });
            if (!error) restored++;
          }
        } else {
          notFound++;
        }
      }

      console.log(`Restored ${restored} pricing rules, ${notFound} companies not found`);

      return new Response(JSON.stringify({ success: true, restored, notFound }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: Clear all data (except companies, pricing rules, users, branches)
    if (action === 'clear') {
      console.log('🧹 CLEARING ALL DATA - Starting...');

      // Prefer the database-side cleanup routine (fast + FK-safe)
      const { error: rpcError } = await supabase.rpc('clear_data_for_import');
      if (rpcError) {
        console.error(`❌ clear_data_for_import failed: ${rpcError.message}`);
        throw rpcError;
      }

      console.log('✅ clear_data_for_import finished');

      // Extra safety: remove any lingering import progress rows (prevents unwanted resume mode)
      const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
      const { error: progressError } = await supabase
        .from('import_progress')
        .delete()
        .neq('id', ZERO_UUID);

      if (progressError) {
        console.warn(`⚠️ Failed clearing import_progress: ${progressError.message}`);
      } else {
        console.log('✅ Deleted from import_progress');
      }

      console.log('🧹 CLEAR COMPLETE - All transactional data cleared');
      return new Response(
        JSON.stringify({
          success: true,
          message: 'All data cleared',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // Action: Update policies and payments only (no clearing, no clients/cars/companies changes)
    if (action === 'updatePoliciesOnly') {
      const incomingPolicies = (data?.policies || []) as any[];
      const requestedOffset = typeof data?.offset === 'number' ? data.offset : 0;
      const totalPolicies = typeof data?.total === 'number' ? data.total : incomingPolicies.length;
      const isChunk = data?.isChunk === true;

      // Keep each invocation small enough to always return a response (avoid timeouts)
      const MAX_POLICIES_PER_RUN = 400;

      const offset = Math.max(0, requestedOffset);
      let policiesToProcess = incomingPolicies;

      // If the client sent the full array, slice by offset.
      // If the client already sent a chunk, process it as-is.
      if (!isChunk) {
        policiesToProcess = incomingPolicies.slice(offset, offset + MAX_POLICIES_PER_RUN);
      } else if (policiesToProcess.length > MAX_POLICIES_PER_RUN) {
        policiesToProcess = policiesToProcess.slice(0, MAX_POLICIES_PER_RUN);
      }

      const rangeStart = policiesToProcess.length > 0 ? offset + 1 : offset;
      const rangeEnd = offset + policiesToProcess.length;

      console.log(
        `📝 UPDATE POLICIES ONLY - Processing ${policiesToProcess.length} policies (${rangeStart}-${rangeEnd} of ${totalPolicies})...`,
      );

      const stats = {
        policiesUpdated: 0,
        policiesSkipped: 0,
        paymentsDeleted: 0,
        paymentsInserted: 0,
        chequesFixed: 0,
        errors: [] as string[],
      };

      // 1) Fetch all policy ids in ONE query (avoid N+1)
      const legacyIds = (policiesToProcess || [])
        .map((p) => p?.legacy_wp_id)
        .filter((v) => v !== null && v !== undefined);

      if (legacyIds.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            stats,
            progress: {
              offset,
              nextOffset: offset,
              total: totalPolicies,
              hasMore: offset < totalPolicies,
              processedThisRun: 0,
            },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const { data: existingPolicies, error: policiesError } = await supabase
        .from('policies')
        .select('id, legacy_wp_id, insurance_price')
        .in('legacy_wp_id', legacyIds)
        .is('deleted_at', null);

      if (policiesError) {
        throw policiesError;
      }

      const policyMap = new Map<any, { id: string; insurancePrice: number }>();
      for (const p of existingPolicies || []) {
        policyMap.set(p.legacy_wp_id, {
          id: p.id,
          insurancePrice: p.insurance_price || 0,
        });
      }

      const policyIdsToClear = Array.from(policyMap.values()).map((p) => p.id);

      // 2) Delete all payments in ONE query
      if (policyIdsToClear.length > 0) {
        const { count: deletedCount, error: deleteError } = await supabase
          .from('policy_payments')
          .delete({ count: 'exact' })
          .in('policy_id', policyIdsToClear);

        if (deleteError) {
          stats.errors.push(`Failed to delete payments (chunk ${rangeStart}-${rangeEnd}): ${deleteError.message}`);
        } else {
          stats.paymentsDeleted += deletedCount || 0;
        }
      }

      // 3) Build all new payment rows in memory (fast), then bulk insert
      const rowsToInsert: any[] = [];

      for (const policy of policiesToProcess) {
        try {
          const meta = policyMap.get(policy?.legacy_wp_id);
          if (!meta) {
            stats.policiesSkipped++;
            continue;
          }

          let runningTotal = 0;

          for (const payment of policy.payments || []) {
            const paymentDate = convertDate(payment.date);
            if (!paymentDate) continue;

            let amount = parseFloat(payment.amount) || 0;
            if (amount <= 0) continue;

            // Cap at insurance_price (do not exceed)
            const remainingCapacity = meta.insurancePrice - runningTotal;
            if (remainingCapacity <= 0) continue;
            if (amount > remainingCapacity) amount = remainingCapacity;

            const checkNum = payment.check_number || payment.cheque_number || '';
            const rawType = (payment.payment_type || '').toLowerCase().trim();

            let paymentType: string;
            if (checkNum && checkNum.trim()) {
              paymentType = 'cheque';
              stats.chequesFixed++;
            } else if (['shekat', 'شيكات', 'شيك', 'cheque', 'check'].includes(rawType)) {
              paymentType = 'cheque';
              stats.chequesFixed++;
            } else {
              paymentType = mapPaymentType(payment.payment_type, policy.notes, checkNum);
            }

            rowsToInsert.push({
              policy_id: meta.id,
              payment_type: paymentType,
              amount: amount,
              payment_date: paymentDate,
              cheque_number: checkNum || null,
              cheque_image_url: payment.check_image_url || payment.cheque_image_url || null,
              refused: payment.refused_status === 'refused',
              branch_id: BEIT_HANINA_BRANCH_ID,
            });

            if (payment.refused_status !== 'refused') {
              runningTotal += amount;
            }
          }

          stats.policiesUpdated++;
        } catch (e: any) {
          stats.errors.push(`Policy ${policy?.legacy_wp_id}: ${e.message}`);
        }
      }

      const INSERT_BATCH_SIZE = 500;
      for (let i = 0; i < rowsToInsert.length; i += INSERT_BATCH_SIZE) {
        const batchRows = rowsToInsert.slice(i, i + INSERT_BATCH_SIZE);
        const { error: insertError } = await supabase.from('policy_payments').insert(batchRows);
        if (insertError) {
          stats.errors.push(`Insert batch failed (${rangeStart}-${rangeEnd}): ${insertError.message}`);
          continue;
        }
        stats.paymentsInserted += batchRows.length;
      }

      const nextOffset = offset + policiesToProcess.length;
      const hasMore = nextOffset < totalPolicies;

      console.log(
        `📝 UPDATE POLICIES ONLY - Chunk done: ${stats.policiesUpdated} updated, ${stats.paymentsInserted} payments, ${stats.chequesFixed} cheques fixed. nextOffset=${nextOffset}/${totalPolicies}`,
      );

      return new Response(
        JSON.stringify({
          success: true,
          stats,
          progress: {
            offset,
            nextOffset,
            total: totalPolicies,
            hasMore,
            processedThisRun: policiesToProcess.length,
          },
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // Action: Create import progress record
    if (action === 'createProgress') {
      const { importType, totalItems, metadata } = data;
      
      const { data: progress, error } = await supabase
        .from('import_progress')
        .insert({
          import_type: importType,
          total_items: totalItems,
          status: 'running',
          started_at: new Date().toISOString(),
          metadata: metadata || {},
        })
        .select('id')
        .single();

      if (error) throw error;

      return new Response(JSON.stringify({ success: true, progressId: progress.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: Get import progress
    if (action === 'getProgress') {
      const { data: progress, error } = await supabase
        .from('import_progress')
        .select('*')
        .eq('id', progressId)
        .single();

      if (error) throw error;

      return new Response(JSON.stringify({ success: true, progress }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: Update progress status
    if (action === 'updateProgressStatus') {
      const { status } = data;
      
      await supabase
        .from('import_progress')
        .update({ status })
        .eq('id', progressId);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: Get existing mappings
    if (action === 'getMappings') {
      const [companiesRes, brokersRes, clientsRes, carsRes, policiesRes] = await Promise.all([
        supabase.from('insurance_companies').select('id, name'),
        supabase.from('brokers').select('id, name'),
        supabase.from('clients').select('id, id_number').is('deleted_at', null),
        supabase.from('cars').select('id, car_number').is('deleted_at', null),
        supabase.from('policies').select('id, legacy_wp_id').is('deleted_at', null),
      ]);

      const mappings = {
        companies: Object.fromEntries((companiesRes.data || []).map(c => [c.name.toLowerCase(), c.id])),
        brokers: Object.fromEntries((brokersRes.data || []).map(b => [b.name.toLowerCase(), b.id])),
        clients: Object.fromEntries((clientsRes.data || []).map(c => [c.id_number, c.id])),
        cars: Object.fromEntries((carsRes.data || []).map(c => [c.car_number, c.id])),
        policies: Object.fromEntries((policiesRes.data || []).filter(p => p.legacy_wp_id).map(p => [p.legacy_wp_id, p.id])),
      };

      return new Response(JSON.stringify({ success: true, mappings }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: Import media with parallel upload
    if (action === 'importMediaParallel') {
      const { mediaItems, mappings } = data;
      
      if (!BUNNY_API_KEY || !BUNNY_STORAGE_ZONE) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Bunny CDN not configured' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const results = await uploadMediaParallel(
        mediaItems,
        supabase,
        mappings,
        BUNNY_API_KEY,
        BUNNY_STORAGE_ZONE,
        progressId,
        10 // 10 concurrent uploads
      );

      // Mark complete
      await supabase
        .from('import_progress')
        .update({
          status: 'completed',
          processed_items: mediaItems.length,
          failed_items: results.failed,
        })
        .eq('id', progressId);

      return new Response(JSON.stringify({ success: true, ...results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: Import a batch of a specific entity type
    if (action === 'importBatch') {
      const stats = { inserted: 0, updated: 0, errors: [] as string[] };
      const newMappings: Record<string, string> = {};
      const mappings = data.mappings || {};

      if (entityType === 'companies') {
        console.log(`Importing ${batch?.length || 0} companies...`);
        for (const company of batch || []) {
          try {
            console.log(`Processing company: ${company.name}`);
            const { data: existing } = await supabase
              .from('insurance_companies')
              .select('id')
              .ilike('name', company.name)
              .maybeSingle();

            const companyData = {
              name: company.name,
              name_ar: company.name,
              active: true,
              category_parent: company.category_parent ? [company.category_parent] : null,
            };

            if (existing) {
              await supabase.from('insurance_companies').update(companyData).eq('id', existing.id);
              newMappings[company.name.toLowerCase()] = existing.id;
              stats.updated++;
              console.log(`Updated company: ${company.name} -> ${existing.id}`);
            } else {
              const { data: inserted, error } = await supabase
                .from('insurance_companies')
                .insert(companyData)
                .select('id')
                .single();
              if (inserted) {
                newMappings[company.name.toLowerCase()] = inserted.id;
                stats.inserted++;
                console.log(`Inserted company: ${company.name} -> ${inserted.id}`);
              } else if (error) {
                console.error(`Error inserting company ${company.name}: ${error.message}`);
                stats.errors.push(`Company ${company.name}: ${error.message}`);
              }
            }
          } catch (e: any) {
            console.error(`Exception processing company ${company.name}: ${e.message}`);
            stats.errors.push(`Company ${company.name}: ${e.message}`);
          }
        }
        console.log(`Companies import done: ${stats.inserted} inserted, ${stats.updated} updated, ${stats.errors.length} errors`);
      }

      if (entityType === 'brokers') {
        for (const broker of batch || []) {
          try {
            const { data: existing } = await supabase
              .from('brokers')
              .select('id')
              .ilike('name', broker.name)
              .maybeSingle();

            const brokerData = {
              name: broker.name,
              phone: broker.phone || null,
              image_url: broker.image_url || null,
              notes: broker.notes || null,
            };

            if (existing) {
              await supabase.from('brokers').update(brokerData).eq('id', existing.id);
              newMappings[broker.name.toLowerCase()] = existing.id;
              stats.updated++;
            } else {
              const { data: inserted, error } = await supabase
                .from('brokers')
                .insert(brokerData)
                .select('id')
                .single();
              if (inserted) {
                newMappings[broker.name.toLowerCase()] = inserted.id;
                stats.inserted++;
              } else if (error) {
                stats.errors.push(`Broker ${broker.name}: ${error.message}`);
              }
            }
          } catch (e: any) {
            stats.errors.push(`Broker ${broker.name}: ${e.message}`);
          }
        }
      }

      if (entityType === 'clients') {
        for (const client of batch || []) {
          try {
            if (!client.id_number) {
              stats.errors.push(`Client missing id_number: ${client.full_name}`);
              continue;
            }

            const { data: existing } = await supabase
              .from('clients')
              .select('id')
              .eq('id_number', client.id_number)
              .is('deleted_at', null)
              .maybeSingle();

            const brokerId = client.broker_name ? mappings.brokers?.[client.broker_name.toLowerCase()] : null;

            // Check for duplicate file_number if provided
            let fileNumber = client.file_number || null;
            if (fileNumber) {
              const { data: existingFileNum } = await supabase
                .from('clients')
                .select('id')
                .eq('file_number', fileNumber)
                .neq('id_number', client.id_number) // Not the same client
                .is('deleted_at', null)
                .maybeSingle();
              
              if (existingFileNum) {
                // Duplicate file_number, set to null (will be auto-generated or fixed later)
                fileNumber = null;
                console.warn(`Duplicate file_number ${client.file_number} for client ${client.id_number}, setting to null`);
              }
            }

            const clientData = {
              full_name: client.full_name || 'غير معروف',
              id_number: client.id_number,
              phone_number: client.phone_number || null,
              file_number: fileNumber,
              date_joined: convertDate(client.date_joined),
              image_url: client.image_url || null,
              signature_url: client.signature_url || null,
              notes: client.notes || null,
              less_than_24: client.less_than_24 === true,
              broker_id: brokerId,
              branch_id: BEIT_HANINA_BRANCH_ID, // Always assign to بيت حنينا
            };

            if (existing) {
              await supabase.from('clients').update(clientData).eq('id', existing.id);
              newMappings[client.id_number] = existing.id;
              stats.updated++;
            } else {
              const { data: inserted, error } = await supabase
                .from('clients')
                .insert(clientData)
                .select('id')
                .single();
              if (inserted) {
                newMappings[client.id_number] = inserted.id;
                stats.inserted++;
              } else if (error) {
                stats.errors.push(`Client ${client.id_number}: ${error.message}`);
              }
            }
          } catch (e: any) {
            stats.errors.push(`Client ${client.id_number}: ${e.message}`);
          }
        }
      }

      if (entityType === 'cars') {
        for (const car of batch || []) {
          try {
            const clientId = car.client_id_number ? mappings.clients?.[car.client_id_number] : null;
            if (!clientId) {
              stats.errors.push(`Car ${car.car_number}: Client not found: ${car.client_id_number}`);
              continue;
            }

            const { data: existing } = await supabase
              .from('cars')
              .select('id')
              .eq('car_number', car.car_number)
              .is('deleted_at', null)
              .maybeSingle();

            const carData = {
              car_number: car.car_number,
              client_id: clientId,
              manufacturer_name: car.manufacturer_name || null,
              model: car.model || null,
              model_number: car.model_number || null,
              year: car.year ? parseInt(car.year) : null,
              color: car.color || null,
              car_value: car.car_value ? parseFloat(car.car_value) : null,
              car_type: mapCarType(car.car_type),
              license_type: car.license_type || null,
              last_license: convertDate(car.last_license),
              license_expiry: convertDate(car.license_finish),
              branch_id: BEIT_HANINA_BRANCH_ID, // Always assign to بيت حنينا
            };

            if (existing) {
              await supabase.from('cars').update(carData).eq('id', existing.id);
              newMappings[car.car_number] = existing.id;
              stats.updated++;
            } else {
              const { data: inserted, error } = await supabase
                .from('cars')
                .insert(carData)
                .select('id')
                .single();
              if (inserted) {
                newMappings[car.car_number] = inserted.id;
                stats.inserted++;
              } else if (error) {
                stats.errors.push(`Car ${car.car_number}: ${error.message}`);
              }
            }
          } catch (e: any) {
            stats.errors.push(`Car ${car.car_number}: ${e.message}`);
          }
        }
      }

      if (entityType === 'policies') {
        for (const policy of batch || []) {
          try {
            const clientIdNumber = policy.client_id_number;
            if (!clientIdNumber) {
              stats.errors.push(`Policy ${policy.legacy_wp_id}: No client id_number`);
              continue;
            }

            const clientId = mappings.clients?.[clientIdNumber];
            if (!clientId) {
              stats.errors.push(`Policy ${policy.legacy_wp_id}: Client not found: ${clientIdNumber}`);
              continue;
            }

            const carId = policy.car_number ? mappings.cars?.[policy.car_number] : null;
            const companyId = policy.company_name ? mappings.companies?.[policy.company_name.toLowerCase()] : null;
            const brokerId = policy.broker_name ? mappings.brokers?.[policy.broker_name.toLowerCase()] : null;

            const policyTypeParent = mapPolicyTypeParent(policy.policy_type_parent);
            if (!policyTypeParent) {
              stats.errors.push(`Policy ${policy.legacy_wp_id}: Invalid policy type: ${policy.policy_type_parent}`);
              continue;
            }

            const { data: existing } = await supabase
              .from('policies')
              .select('id')
              .eq('legacy_wp_id', policy.legacy_wp_id)
              .is('deleted_at', null)
              .maybeSingle();

            let notes = policy.notes || null;
            if (notes) {
              notes = notes.replace(/Payment Way:\s*\w+/gi, '').trim() || null;
            }

            const policyData = {
              legacy_wp_id: policy.legacy_wp_id,
              policy_number: policy.policy_number_hint || null,
              client_id: clientId,
              car_id: carId,
              company_id: companyId,
              broker_id: brokerId,
              policy_type_parent: policyTypeParent,
              policy_type_child: mapPolicyTypeChild(policy.policy_type_child),
              start_date: convertDate(policy.start_date) || new Date().toISOString().split('T')[0],
              end_date: convertDate(policy.end_date) || new Date().toISOString().split('T')[0],
              insurance_price: parseFloat(policy.insurance_price) || 0,
              profit: parseFloat(policy.profit) || 0,
              payed_for_company: parseFloat(policy.payed_for_company) || 0,
              is_under_24: policy.is_under_24 === true,
              cancelled: policy.cancelled === true,
              transferred: policy.transferred === true,
              transferred_car_number: policy.transferred_car_number || null,
              notes: notes,
              calc_status: policy.calc_status || 'done',
              branch_id: BEIT_HANINA_BRANCH_ID, // Always assign to بيت حنينا
            };

            if (existing) {
              await supabase.from('policies').update(policyData).eq('id', existing.id);
              newMappings[policy.legacy_wp_id] = existing.id;
              stats.updated++;
            } else {
              const { data: inserted, error } = await supabase
                .from('policies')
                .insert(policyData)
                .select('id')
                .single();
              if (inserted) {
                newMappings[policy.legacy_wp_id] = inserted.id;
                stats.inserted++;
              } else if (error) {
                stats.errors.push(`Policy ${policy.legacy_wp_id}: ${error.message}`);
              }
            }
          } catch (e: any) {
            stats.errors.push(`Policy ${policy.legacy_wp_id}: ${e.message}`);
          }
        }
      }

      if (entityType === 'payments') {
        // Group payments by policy to handle capping
        const paymentsByPolicy = new Map<string, any[]>();
        for (const payment of batch || []) {
          const policyLegacyId = payment.policy_legacy_wp_id;
          if (!policyLegacyId) continue;
          if (!paymentsByPolicy.has(policyLegacyId)) {
            paymentsByPolicy.set(policyLegacyId, []);
          }
          paymentsByPolicy.get(policyLegacyId)!.push(payment);
        }

        for (const [policyLegacyId, payments] of paymentsByPolicy) {
          const policyId = mappings.policies?.[policyLegacyId];
          if (!policyId) continue;

          // Get policy insurance_price to cap payments
          const { data: policyData } = await supabase
            .from('policies')
            .select('insurance_price')
            .eq('id', policyId)
            .single();
          
          const insurancePrice = policyData?.insurance_price || 0;
          let runningTotal = 0;

          // Get existing payments total
          const { data: existingPaymentsData } = await supabase
            .from('policy_payments')
            .select('amount, refused')
            .eq('policy_id', policyId);
          
          for (const ep of existingPaymentsData || []) {
            if (!ep.refused) {
              runningTotal += parseFloat(ep.amount) || 0;
            }
          }

          for (const payment of payments) {
            try {
              const paymentDate = convertDate(payment.date);
              if (!paymentDate) continue;

              let amount = parseFloat(payment.amount) || 0;
              if (amount <= 0) continue;

              // Cap amount to not exceed insurance_price
              const remainingCapacity = insurancePrice - runningTotal;
              if (remainingCapacity <= 0) {
                console.log(`Skipping payment for policy ${policyLegacyId}: already at or over insurance_price`);
                continue;
              }
              if (amount > remainingCapacity) {
                console.log(`Capping payment from ${amount} to ${remainingCapacity} for policy ${policyLegacyId}`);
                amount = remainingCapacity;
              }

              const { data: existingPayment } = await supabase
                .from('policy_payments')
                .select('id')
                .eq('policy_id', policyId)
                .eq('payment_date', paymentDate)
                .eq('amount', amount)
                .maybeSingle();

              // Pass check_number to mapPaymentType for proper detection
              const paymentType = mapPaymentType(payment.payment_type, payment.policy_notes, payment.check_number) as any;

              if (!existingPayment) {
                const { error } = await supabase
                  .from('policy_payments')
                  .insert({
                    policy_id: policyId,
                    payment_type: paymentType,
                    amount: amount,
                    payment_date: paymentDate,
                    cheque_number: payment.check_number || null,
                    cheque_image_url: payment.check_image_url || null,
                    refused: payment.refused_status === 'refused',
                    branch_id: BEIT_HANINA_BRANCH_ID,
                  });
                if (error) {
                  stats.errors.push(`Payment: ${error.message}`);
                } else {
                  stats.inserted++;
                  if (payment.refused_status !== 'refused') {
                    runningTotal += amount;
                  }
                }
              } else {
                await supabase
                  .from('policy_payments')
                  .update({
                    payment_type: paymentType,
                    cheque_number: payment.check_number || null,
                    cheque_image_url: payment.check_image_url || null,
                    refused: payment.refused_status === 'refused',
                  })
                  .eq('id', existingPayment.id);
                stats.updated++;
              }
            } catch (e: any) {
              stats.errors.push(`Payment: ${e.message}`);
            }
          }
        }
      }

      if (entityType === 'media') {
        if (!BUNNY_API_KEY || !BUNNY_STORAGE_ZONE) {
          console.warn('Bunny CDN not configured, storing original URLs');
        }

        for (const media of batch || []) {
          try {
            const policyId = media.policy_legacy_wp_id ? mappings.policies?.[media.policy_legacy_wp_id] : null;
            if (!policyId || !media.url) continue;

            const { data: existingMedia } = await supabase
              .from('media_files')
              .select('id')
              .eq('entity_id', policyId)
              .in('entity_type', ['policy', 'policy_crm'])
              .ilike('original_name', `%${media.url.split('/').pop()}%`)
              .maybeSingle();

            if (existingMedia) {
              stats.updated++;
              continue;
            }

            let cdnUrl = media.url;
            let storagePath = media.url;
            let mimeType = media.url.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
            let size = 0;
            const originalName = decodeURIComponent(media.url.split('/').pop() || 'file');

            if (BUNNY_API_KEY && BUNNY_STORAGE_ZONE) {
              const uploadResult = await uploadToBunnyCDN(media.url, BUNNY_API_KEY, BUNNY_STORAGE_ZONE);
              if (uploadResult) {
                cdnUrl = uploadResult.cdnUrl;
                storagePath = uploadResult.storagePath;
                mimeType = uploadResult.mimeType;
                size = uploadResult.size;
              }
            }

            const { error } = await supabase
              .from('media_files')
              .insert({
                cdn_url: cdnUrl,
                storage_path: storagePath,
                original_name: originalName,
                mime_type: mimeType,
                size: size,
                entity_type: 'policy_crm',
                entity_id: policyId,
                branch_id: BEIT_HANINA_BRANCH_ID, // Always assign to بيت حنينا
              });
            if (error) {
              stats.errors.push(`Media ${originalName}: ${error.message}`);
            } else {
              stats.inserted++;
            }
          } catch (e: any) {
            stats.errors.push(`Media: ${e.message}`);
          }
        }
      }

      if (entityType === 'invoices') {
        if (!BUNNY_API_KEY || !BUNNY_STORAGE_ZONE) {
          console.warn('Bunny CDN not configured for invoice PDFs');
        }

        for (const invoice of batch || []) {
          try {
            const policyId = invoice.policy_legacy_wp_id ? mappings.policies?.[invoice.policy_legacy_wp_id] : null;
            if (!policyId || !invoice.pdf) continue;

            const pdfUrl = invoice.pdf;
            const originalName = decodeURIComponent(pdfUrl.split('/').pop() || 'invoice.pdf');

            const { data: existingMedia } = await supabase
              .from('media_files')
              .select('id')
              .eq('entity_id', policyId)
              .eq('entity_type', 'invoice')
              .ilike('original_name', `%${originalName}%`)
              .maybeSingle();

            if (existingMedia) {
              stats.updated++;
              continue;
            }

            let cdnUrl = pdfUrl;
            let storagePath = pdfUrl;
            let size = 0;

            if (BUNNY_API_KEY && BUNNY_STORAGE_ZONE) {
              const uploadResult = await uploadToBunnyCDN(pdfUrl, BUNNY_API_KEY, BUNNY_STORAGE_ZONE);
              if (uploadResult) {
                cdnUrl = uploadResult.cdnUrl;
                storagePath = uploadResult.storagePath;
                size = uploadResult.size;
              }
            }

            const { error } = await supabase
              .from('media_files')
              .insert({
                cdn_url: cdnUrl,
                storage_path: storagePath,
                original_name: originalName,
                mime_type: 'application/pdf',
                size: size,
                entity_type: 'invoice',
                entity_id: policyId,
                branch_id: BEIT_HANINA_BRANCH_ID, // Always assign to بيت حنينا
              });
            
            if (error) {
              stats.errors.push(`Invoice PDF ${originalName}: ${error.message}`);
            } else {
              stats.inserted++;
            }
          } catch (e: any) {
            stats.errors.push(`Invoice: ${e.message}`);
          }
        }
      }

      if (entityType === 'outsideCheques') {
        for (const cheque of batch || []) {
          try {
            const { data: existing } = await supabase
              .from('outside_cheques')
              .select('id')
              .eq('name', cheque.name)
              .eq('amount', parseFloat(cheque.amount) || 0)
              .maybeSingle();

            const chequeData = {
              name: cheque.name || 'غير معروف',
              amount: parseFloat(cheque.amount) || 0,
              cheque_number: cheque.cheque_number || null,
              cheque_date: convertDate(cheque.cheque_date),
              cheque_image_url: cheque.cheque_image_url || null,
              notes: cheque.notes || null,
              refused: cheque.refused === true,
              used: cheque.used === true,
              branch_id: BEIT_HANINA_BRANCH_ID, // Always assign to بيت حنينا
            };

            if (existing) {
              await supabase.from('outside_cheques').update(chequeData).eq('id', existing.id);
              stats.updated++;
            } else {
              const { error } = await supabase.from('outside_cheques').insert(chequeData);
              if (error) {
                stats.errors.push(`Cheque ${cheque.name}: ${error.message}`);
              } else {
                stats.inserted++;
              }
            }
          } catch (e: any) {
            stats.errors.push(`Cheque: ${e.message}`);
          }
        }
      }

      return new Response(JSON.stringify({ success: true, stats, newMappings }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  // Action: Bulk assign company_id to unlinked policies (no JSON needed)
  if (action === 'bulkAssignCompany') {
    const { companyId, policyTypeFilter } = data || {};
    
    if (!companyId) {
      return new Response(JSON.stringify({ success: false, error: 'companyId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log(`Bulk assigning company ${companyId} to unlinked policies...`);
    
    // Get count of policies without company_id
    let query = supabase
      .from('policies')
      .select('id', { count: 'exact' })
      .is('company_id', null)
      .is('deleted_at', null);
    
    if (policyTypeFilter) {
      query = query.eq('policy_type_parent', policyTypeFilter);
    }
    
    const { data: policies, count } = await query;
    
    if (!policies || policies.length === 0) {
      return new Response(JSON.stringify({ success: true, linked: 0, total: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Batch update all at once
    const policyIds = policies.map(p => p.id);
    let linked = 0;
    
    // Update in batches of 500
    for (let i = 0; i < policyIds.length; i += 500) {
      const batch = policyIds.slice(i, i + 500);
      const { error } = await supabase
        .from('policies')
        .update({ company_id: companyId })
        .in('id', batch);
      
      if (!error) {
        linked += batch.length;
      } else {
        console.error(`Batch update failed:`, error);
      }
    }
    
    console.log(`Bulk assigned ${linked} policies to company ${companyId}`);
    
    return new Response(JSON.stringify({ 
      success: true, 
      linked,
      total: count || 0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Action: Get unlinked policies stats
  if (action === 'getUnlinkedPoliciesStats') {
    const { data: stats, error } = await supabase
      .from('policies')
      .select('policy_type_parent')
      .is('company_id', null)
      .is('deleted_at', null);
    
    if (error) throw error;
    
    // Group by policy_type_parent
    const grouped: Record<string, number> = {};
    for (const p of stats || []) {
      grouped[p.policy_type_parent] = (grouped[p.policy_type_parent] || 0) + 1;
    }
    
    return new Response(JSON.stringify({ 
      success: true, 
      total: stats?.length || 0,
      byType: grouped,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Action: Link policies without company_id to companies using JSON company_name data
  if (action === 'linkPoliciesToCompanies') {
    const { policyCompanyMap } = data || {};
    console.log('Linking policies to companies using JSON data...');
    
    // Get all policies without company_id
    const { data: orphanPolicies, error: fetchError } = await supabase
      .from('policies')
      .select('id, legacy_wp_id')
      .is('company_id', null)
      .is('deleted_at', null);
    
    if (fetchError) throw fetchError;
    console.log(`Found ${orphanPolicies?.length || 0} policies without company`);
    
    // Get all companies for matching
    const { data: companies } = await supabase
      .from('insurance_companies')
      .select('id, name, name_ar');
    
    // Build company map with both name and name_ar for flexible matching
    const companyMap: Record<string, string> = {};
    for (const c of companies || []) {
      if (c.name) {
        companyMap[c.name.toLowerCase().trim()] = c.id;
      }
      if (c.name_ar) {
        companyMap[c.name_ar.toLowerCase().trim()] = c.id;
      }
    }
    console.log(`Company map has ${Object.keys(companyMap).length} entries`);
    
    let linked = 0;
    const notFoundSet = new Set<string>();
    
    for (const policy of orphanPolicies || []) {
      // Get company_name from the provided policyCompanyMap (legacy_wp_id -> company_name)
      const companyName = policyCompanyMap?.[policy.legacy_wp_id];
      
      if (companyName) {
        const normalizedName = companyName.toLowerCase().trim();
        const companyId = companyMap[normalizedName];
        
        if (companyId) {
          const { error: updateError } = await supabase
            .from('policies')
            .update({ company_id: companyId })
            .eq('id', policy.id);
          
          if (!updateError) {
            linked++;
          } else {
            console.error(`Failed to update policy ${policy.id}:`, updateError);
          }
        } else {
          notFoundSet.add(companyName);
        }
      }
    }
    
    console.log(`Linked ${linked} policies, ${notFoundSet.size} company names not found`);
    console.log('Not found companies:', Array.from(notFoundSet).slice(0, 10));
    
    return new Response(JSON.stringify({ 
      success: true, 
      found: orphanPolicies?.length || 0,
      linked,
      notFound: Array.from(notFoundSet).slice(0, 100),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

    // Action: Import media with parallel upload, persistent cursor, batched
    if (action === 'importMediaBatchParallel') {
      const { mediaItems, mappings, offset, batchSize = 100, concurrency = 10 } = data;
      
      if (!BUNNY_API_KEY || !BUNNY_STORAGE_ZONE) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Bunny CDN not configured' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`Starting parallel media upload: offset=${offset}, batchSize=${batchSize}, concurrency=${concurrency}`);
      const results = { inserted: 0, failed: 0, errors: [] as string[] };
      
      // Process in concurrent groups
      for (let i = 0; i < mediaItems.length; i += concurrency) {
        const concurrentBatch = mediaItems.slice(i, i + concurrency);
        
        const promises = concurrentBatch.map(async (media: any, idx: number) => {
          const globalIdx = offset + i + idx;
          try {
            const policyId = media.policy_legacy_wp_id ? mappings.policies?.[media.policy_legacy_wp_id] : null;
            if (!policyId) {
              return { success: false, error: `[${globalIdx}] Missing policy mapping for legacy_wp_id: ${media.policy_legacy_wp_id}` };
            }
            if (!media.url) {
              return { success: false, error: `[${globalIdx}] Missing URL` };
            }

            const originalName = decodeURIComponent(media.url.split('/').pop() || 'file');
            
            // Check if already exists
            const { data: existingMedia } = await supabase
              .from('media_files')
              .select('id')
              .eq('entity_id', policyId)
              .eq('entity_type', 'policy')
              .ilike('original_name', `%${originalName.substring(0, 50)}%`)
              .maybeSingle();

            if (existingMedia) {
              return { success: true, skipped: true };
            }

            // Upload to Bunny CDN
            const uploadResult = await uploadToBunnyCDN(media.url, BUNNY_API_KEY, BUNNY_STORAGE_ZONE);
            
            if (!uploadResult) {
              return { success: false, error: `[${globalIdx}] CDN upload failed: ${originalName}` };
            }

            const { error: insertError } = await supabase
              .from('media_files')
              .insert({
                cdn_url: uploadResult.cdnUrl,
                storage_path: uploadResult.storagePath,
                original_name: originalName,
                mime_type: uploadResult.mimeType,
                size: uploadResult.size,
                entity_type: 'policy',
                entity_id: policyId,
                branch_id: BEIT_HANINA_BRANCH_ID,
              });

            if (insertError) {
              return { success: false, error: `[${globalIdx}] DB insert failed: ${insertError.message}` };
            }
            return { success: true };
          } catch (e: any) {
            return { success: false, error: `[${globalIdx}] Exception: ${e.message}` };
          }
        });

        const batchResults = await Promise.all(promises);
        
        for (const result of batchResults) {
          if (result.success) {
            if (!result.skipped) results.inserted++;
          } else {
            results.failed++;
            if (result.error) results.errors.push(result.error);
          }
        }
      }

      console.log(`Batch complete: inserted=${results.inserted}, failed=${results.failed}`);

      return new Response(JSON.stringify({ 
        success: true, 
        inserted: results.inserted,
        failed: results.failed,
        errors: results.errors.slice(0, 50), // Limit errors to prevent huge response
        processedCount: mediaItems.length,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Import error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
