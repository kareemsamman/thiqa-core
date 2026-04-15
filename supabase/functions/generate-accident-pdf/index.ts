import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { getAgentBranding, type AgentBranding } from "../_shared/agent-branding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// IMPORTANT: must match the scale used when rendering the PDF inside the Accident Template Mapper UI
// (see src/pages/AccidentTemplateMapper.tsx -> page.getViewport({ scale: 1.5 }))
const MAPPER_RENDER_SCALE = 1.5;

interface FieldMapping {
  page: number;
  x: number;
  y: number;
  size: number;
  type: "text" | "checkbox" | "freetext";
  freeTextValue?: string;
}

interface MappingJson {
  [fieldId: string]: FieldMapping;
}

interface AccidentReport {
  id: string;
  policy_id: string;
  accident_date: string;
  accident_time: string | null;
  accident_location: string | null;
  accident_description: string | null;
  driver_name: string | null;
  driver_id_number: string | null;
  driver_phone: string | null;
  driver_license_number: string | null;
  driver_address: string | null;
  driver_age: number | null;
  driver_occupation: string | null;
  license_issue_place: string | null;
  license_expiry_date: string | null;
  first_license_date: string | null;
 driver_license_grade: string | null;
 driver_license_issue_date: string | null;
  police_reported: boolean;
  police_station: string | null;
  police_report_number: string | null;
  owner_address: string | null;
 owner_name: string | null;
 owner_phone: string | null;
  vehicle_license_expiry: string | null;
 vehicle_chassis_number: string | null;
 vehicle_speed_at_accident: string | null;
  passengers_count: number | null;
  vehicle_usage_purpose: string | null;
  own_car_damages: string | null;
  was_anyone_injured: boolean | null;
  injuries_description: string | null;
  witnesses_info: string | null;
  passengers_info: string | null;
  responsible_party: string | null;
  additional_details: string | null;
 employee_notes: string | null;
 employee_signature_date: string | null;
 customer_signature_url: string | null;
 customer_signed_at: string | null;
  company_id: string | null;
  branch_id: string | null;
  clients: {
    full_name: string;
    id_number: string;
    phone_number: string | null;
  };
  cars: {
    car_number: string;
    manufacturer_name: string | null;
    model: string | null;
    year: number | null;
    color: string | null;
  } | null;
  policies: {
    policy_number: string | null;
    policy_type_child: string | null;
    start_date: string;
    end_date: string;
  };
  insurance_companies: {
    name: string;
    name_ar: string | null;
  } | null;
}

interface ThirdParty {
  full_name: string;
  id_number: string | null;
  phone: string | null;
  address: string | null;
  vehicle_number: string | null;
  vehicle_manufacturer: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  vehicle_type: string | null;
  insurance_company: string | null;
  insurance_policy_number: string | null;
  damage_description: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const bunnyStorageKey = Deno.env.get("BUNNY_API_KEY");
    const bunnyAccountKey = Deno.env.get("BUNNY_ACCOUNT_API_KEY"); // For CDN purge
    const bunnyStorageZone = Deno.env.get("BUNNY_STORAGE_ZONE") || "kareem";
    const bunnyCdnUrl = Deno.env.get('BUNNY_CDN_URL') || "https://kareem.b-cdn.net";

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { accident_report_id } = await req.json();

    if (!accident_report_id) {
      throw new Error("accident_report_id is required");
    }

    console.log("Generating PDF for accident report:", accident_report_id);

    // Fetch accident report with related data
    const { data: report, error: reportError } = await supabase
      .from("accident_reports")
      .select(`
        *,
        clients!inner(full_name, id_number, phone_number),
        cars(car_number, manufacturer_name, model, year, color),
        policies!inner(policy_number, policy_type_child, start_date, end_date),
        insurance_companies(name, name_ar)
      `)
      .eq("id", accident_report_id)
      .single();

    if (reportError || !report) {
      throw new Error(`Failed to fetch accident report: ${reportError?.message}`);
    }

    // Fetch third parties
    const { data: thirdParties } = await supabase
      .from("accident_third_parties")
      .select("*")
      .eq("accident_report_id", accident_report_id)
      .order("sort_order");

    // Fetch attached files (images, PDFs)
    const { data: attachedFiles } = await supabase
      .from("accident_report_files")
      .select("file_url, file_name, file_type")
      .eq("accident_report_id", accident_report_id)
      .order("created_at");

    console.log("Attached files found:", attachedFiles?.length || 0);

    // Load the agent's own branding (logo + company name) so the
    // printed report wears the agent's identity instead of falling
    // back to the insurance company or a generic default.
    const branding = await getAgentBranding(supabase, (report as any).agent_id || null);

    // Build field values
    const fieldValues = buildFieldValues(report as AccidentReport, thirdParties || []);

    // Check if company has a template
    let htmlContent: string;
    let usedTemplate = false;

    if (report.company_id) {
      const { data: template } = await supabase
        .from("company_accident_templates")
        .select("template_pdf_url, mapping_json, is_active")
        .eq("company_id", report.company_id)
        .eq("is_active", true)
        .single();

      if (template?.template_pdf_url && template?.mapping_json) {
        console.log("Found company template, generating HTML overlay report");
        
        try {
          // Check if there are saved edits to use instead of original mapping
          const editedFields = report.edited_fields_json;
          
          // Generate HTML with PDF background and text overlays
          htmlContent = generateHtmlOverlayReport(
            template.template_pdf_url,
            template.mapping_json as MappingJson,
            fieldValues,
            report as AccidentReport,
            thirdParties || [],
            editedFields,
            supabaseUrl,
            supabaseAnonKey,
            attachedFiles || []
          );
          usedTemplate = true;
          console.log("Successfully generated HTML overlay report", editedFields ? "(with saved edits)" : "(fresh)");
        } catch (templateError) {
          console.error("Error using template, falling back to standard HTML:", templateError);
          htmlContent = generateHtmlReport(report as AccidentReport, thirdParties || [], branding);
        }
      } else {
        htmlContent = generateHtmlReport(report as AccidentReport, thirdParties || [], branding);
      }
    } else {
      htmlContent = generateHtmlReport(report as AccidentReport, thirdParties || [], branding);
    }

    // Generate filename - FIXED NAME for stable URL (no timestamp)
    const filename = `accident-reports/${report.id}/report.html`;
    const contentType = "text/html; charset=utf-8";

    // Upload to Bunny Storage
    let pdfUrl = "";
    if (bunnyStorageKey) {
      const uploadUrl = `https://storage.bunnycdn.com/${bunnyStorageZone}/${filename}`;
      
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "AccessKey": bunnyStorageKey,
          "Content-Type": contentType,
        },
        body: htmlContent,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error("Bunny upload failed:", errorText);
        throw new Error("Failed to upload report to storage");
      }

      pdfUrl = `${bunnyCdnUrl}/${filename}`;
      console.log("Generated report URL:", pdfUrl);

      // Purge CDN cache to show updated content immediately
      // Note: Purge API requires Account API Key, not Storage Key
      if (bunnyAccountKey) {
        try {
          const purgeUrl = `https://api.bunny.net/purge?url=${encodeURIComponent(pdfUrl)}`;
          const purgeResponse = await fetch(purgeUrl, {
            method: "POST",
            headers: {
              "AccessKey": bunnyAccountKey,
            },
          });
          if (purgeResponse.ok) {
            console.log("CDN cache purged successfully for:", pdfUrl);
          } else {
            console.warn("CDN purge failed:", await purgeResponse.text());
          }
        } catch (purgeError) {
          console.warn("CDN purge error (non-fatal):", purgeError);
        }
      } else {
        console.warn("BUNNY_ACCOUNT_API_KEY not set - cache purge skipped");
      }
    } else {
      console.warn("No BUNNY_API_KEY configured");
      throw new Error("Storage not configured");
    }

    // Update accident report with PDF URL
    const { error: updateError } = await supabase
      .from("accident_reports")
      .update({ generated_pdf_url: pdfUrl })
      .eq("id", accident_report_id);

    if (updateError) {
      console.error("Failed to update report with PDF URL:", updateError);
    }

    // Save to media_files
    await supabase.from("media_files").insert({
      original_name: `accident-report-${report.id}.html`,
      mime_type: "text/html",
      size: new TextEncoder().encode(htmlContent).length,
      cdn_url: pdfUrl,
      storage_path: filename,
      entity_type: "accident_report",
      entity_id: accident_report_id,
      branch_id: report.branch_id,
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        pdf_url: pdfUrl,
        used_template: usedTemplate,
        message: usedTemplate ? "HTML overlay report generated from template" : "HTML report generated" 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error generating accident PDF:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function buildFieldValues(report: AccidentReport, thirdParties: ThirdParty[]): Record<string, string> {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString("en-GB");
  };

  const policyTypeLabel = report.policies.policy_type_child === "THIRD" ? "طرف ثالث" : "شامل";
  const companyName = report.insurance_companies?.name_ar || report.insurance_companies?.name || "";

  const values: Record<string, string> = {
    // Policy & Insurance
    policy_number: report.policies.policy_number || "",
    policy_type: policyTypeLabel,
    policy_start_date: formatDate(report.policies.start_date),
    policy_end_date: formatDate(report.policies.end_date),
    company_name: companyName,
    
    // Owner (Client) Info
    owner_name: report.clients.full_name || "",
    owner_id_number: report.clients.id_number || "",
    owner_phone: report.clients.phone_number || "",
    owner_address: report.owner_address || "",
    
    // Vehicle Info
    car_number: report.cars?.car_number || "",
    car_chassis: "", // Not in current schema
    car_manufacturer: report.cars?.manufacturer_name || "",
    car_model: report.cars?.model || "",
    car_year: report.cars?.year?.toString() || "",
    car_color: report.cars?.color || "",
    car_usage: report.vehicle_usage_purpose || "",
    vehicle_license_expiry: formatDate(report.vehicle_license_expiry),
    
    // Accident Details
    accident_date: formatDate(report.accident_date),
    accident_time: report.accident_time || "",
    accident_location: report.accident_location || "",
    accident_description: report.accident_description || "",
    vehicle_usage_purpose: report.vehicle_usage_purpose || "",
    passengers_count: report.passengers_count?.toString() || "",
    responsible_party: report.responsible_party || "",
    
    // Driver Info
    driver_name: report.driver_name || "",
    driver_address: report.driver_address || "",
    driver_id_number: report.driver_id_number || "",
    driver_phone: report.driver_phone || "",
    driver_age: report.driver_age?.toString() || "",
    driver_occupation: report.driver_occupation || "",
    driver_license_number: report.driver_license_number || "",
    license_issue_place: report.license_issue_place || "",
    license_expiry_date: formatDate(report.license_expiry_date),
    first_license_date: formatDate(report.first_license_date),
    
    // Damages
    own_car_damages: report.own_car_damages || "",
    was_anyone_injured: report.was_anyone_injured ? "نعم" : "لا",
    injuries_description: report.injuries_description || "",
    
    // Police
    police_reported: report.police_reported ? "نعم" : "لا",
    police_station: report.police_station || "",
    police_report_number: report.police_report_number || "",
    
    // Witnesses & Passengers
    witnesses_info: report.witnesses_info || "",
    passengers_info: report.passengers_info || "",
    additional_details: report.additional_details || "",
    
    // Report metadata
    report_date: formatDate(new Date().toISOString()),
  };
   
   // New fields - Owner override
   values.owner_name_override = report.owner_name || "";
   values.owner_phone_override = report.owner_phone || "";
   
   // New fields - Driver extended
   values.driver_license_grade = report.driver_license_grade || "";
   values.driver_license_issue_date = formatDate(report.driver_license_issue_date);
   
   // New fields - Vehicle extended  
   values.vehicle_chassis_number = report.vehicle_chassis_number || "";
   values.vehicle_speed_at_accident = report.vehicle_speed_at_accident || "";
   
   // New fields - Employee notes
   values.employee_notes = report.employee_notes || "";
   values.employee_signature_date = formatDate(report.employee_signature_date);
   
   // Customer signature - pass URL directly for image rendering
   values.customer_signature = report.customer_signature_url || "";
  
  // Add third party info
  if (thirdParties.length > 0) {
    const tp1 = thirdParties[0];
    values.third_party_1_name = tp1.full_name || "";
    values.third_party_1_id = tp1.id_number || "";
    values.third_party_1_phone = tp1.phone || "";
    values.third_party_1_car_number = tp1.vehicle_number || "";
    values.third_party_1_car_type = `${tp1.vehicle_manufacturer || ""} ${tp1.vehicle_model || ""} ${tp1.vehicle_year || ""}`.trim();
    values.third_party_1_insurance = tp1.insurance_company || "";
    values.third_party_1_policy = tp1.insurance_policy_number || "";
    values.third_party_1_damages = tp1.damage_description || "";
  }
  
  if (thirdParties.length > 1) {
    const tp2 = thirdParties[1];
    values.third_party_2_name = tp2.full_name || "";
    values.third_party_2_id = tp2.id_number || "";
    values.third_party_2_phone = tp2.phone || "";
    values.third_party_2_car_number = tp2.vehicle_number || "";
    values.third_party_2_car_type = `${tp2.vehicle_manufacturer || ""} ${tp2.vehicle_model || ""} ${tp2.vehicle_year || ""}`.trim();
    values.third_party_2_insurance = tp2.insurance_company || "";
  }
  
  return values;
}

// Generate HTML that displays the PDF template as a background with text overlays
// CRITICAL: Uses exact pixel coordinates from the mapper at MAPPER_RENDER_SCALE (1.5)
function generateHtmlOverlayReport(
  templatePdfUrl: string,
  mapping: MappingJson,
  fieldValues: Record<string, string>,
  report: AccidentReport,
  thirdParties: ThirdParty[],
  editedFieldsJson: any | null,
  supabaseUrl: string,
  supabaseAnonKey: string,
  attachedFiles: Array<{ file_url: string; file_name: string | null; file_type: string | null }> = []
): string {
  // Build field data - use edited fields if available, otherwise use mapping
  let fieldsByPage: Record<number, Array<{ id: string; config: { x: number; y: number; size: number }; value: string }>> = {};
  
  if (editedFieldsJson?.fields && Array.isArray(editedFieldsJson.fields)) {
    // Use saved edited fields
    console.log("Using saved edited fields:", editedFieldsJson.fields.length);
    for (const field of editedFieldsJson.fields) {
      const pageIndex = field.page || 0;
      if (!fieldsByPage[pageIndex]) {
        fieldsByPage[pageIndex] = [];
      }
      
      fieldsByPage[pageIndex].push({
        id: field.id,
        config: {
          x: field.x,
          y: field.y,
          size: field.fontSize,
        },
        value: field.text,
      });
    }
  } else {
    // Use original mapping
    for (const [fieldId, config] of Object.entries(mapping)) {
      const pageIndex = config.page || 0;
      if (!fieldsByPage[pageIndex]) {
        fieldsByPage[pageIndex] = [];
      }
      
      let value = "";
      if (config.type === "freetext") {
        value = config.freeTextValue || "";
      } else {
        value = fieldValues[fieldId] || "";
      }
      
      if (value) {
        fieldsByPage[pageIndex].push({ 
          id: fieldId, 
          config: {
            x: config.x,
            y: config.y,
            size: config.size,
          }, 
          value 
        });
      }
    }
  }

  // Escape field data for embedding in JS
  const fieldDataJson = JSON.stringify(fieldsByPage).replace(/'/g, "\\'").replace(/\n/g, "\\n");
  
  // Prepare attachments data
  const imageFiles = attachedFiles.filter(f => f.file_type?.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/i.test(f.file_url));
  const pdfFiles = attachedFiles.filter(f => f.file_type?.includes('pdf') || f.file_url.toLowerCase().endsWith('.pdf'));
  const attachmentsJson = JSON.stringify({ images: imageFiles, pdfs: pdfFiles }).replace(/'/g, "\\'").replace(/\n/g, "\\n");

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>بلاغ حادث - ${escapeHtml(report.clients.full_name)}</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"><\/script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: 'Tajawal', sans-serif;
      background: #e5e7eb;
      direction: rtl;
    }
    
    .toolbar {
      position: fixed;
      top: 20px;
      left: 20px;
      z-index: 1000;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    
    .toolbar button, .toolbar select {
      background: #2563eb;
      color: white;
      border: none;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 15px;
      font-family: 'Tajawal', sans-serif;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: all 0.2s;
    }
    
    .toolbar select {
      display: none;
      padding: 12px 14px;
    }
    
    body.edit-mode .toolbar select {
      display: block;
    }
    
    .toolbar button:hover {
      background: #1d4ed8;
      transform: translateY(-1px);
    }
    
    .toolbar button.active {
      background: #059669;
    }
    
    .toolbar button.add-btn {
      background: #059669;
      display: none;
    }
    
    body.edit-mode .toolbar button.add-btn {
      display: flex;
    }
    
    .toolbar button.add-btn:hover {
      background: #047857;
    }
    
    .toolbar button.back-btn {
      background: #6b7280;
    }
    
    .toolbar button.back-btn:hover {
      background: #4b5563;
    }
    
    /* PRINT: Keep original pixel dimensions - no scaling */
    @media print {
      @page {
        size: A4 portrait;
        margin: 0;
      }
      
      .toolbar { display: none !important; }
      
      body { 
        background: white !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      
      .page-wrapper {
        padding: 0 !important;
        gap: 0 !important;
      }
      
      .page-container { 
        page-break-after: always;
        page-break-inside: avoid;
        margin: 0 !important;
        box-shadow: none !important;
        overflow: hidden;
        /* Scale to fit A4 width while maintaining aspect ratio */
        transform: scale(var(--print-scale, 1));
        transform-origin: top left;
      }
      
      .page-container:last-child { 
        page-break-after: auto;
      }
      
      .text-overlay {
        border: none !important;
        background: transparent !important;
      }
      
      .delete-btn {
        display: none !important;
      }
      
      .page-indicator {
        display: none !important;
      }
    }
    
    .loading {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 30px 50px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      text-align: center;
      z-index: 999;
    }
    
    .loading.hidden { display: none; }
    
    .page-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 30px;
      gap: 30px;
    }
    
    .page-container {
      position: relative;
      background: white;
      box-shadow: 0 8px 30px rgba(0,0,0,0.12);
      overflow: visible;
    }
    
    .page-container canvas {
      display: block;
    }
    
    .overlay-container {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
    }
    
    body.edit-mode .overlay-container {
      pointer-events: auto;
    }
    
    .text-overlay {
      position: absolute;
      color: #000;
      font-family: 'Tajawal', sans-serif;
      font-weight: 700;
      white-space: nowrap;
      direction: rtl;
      text-align: right;
      cursor: default;
      padding: 3px 8px;
      border-radius: 3px;
      min-width: 20px;
      transition: all 0.15s;
      pointer-events: auto;
    }
    
    /* Edit mode styles */
    body.edit-mode .text-overlay {
      cursor: move;
      border: 2px dashed #2563eb;
      background: rgba(255, 255, 255, 0.95);
    }
    
    body.edit-mode .text-overlay:hover {
      background: rgba(37, 99, 235, 0.15);
      border-color: #1d4ed8;
    }
    
    body.edit-mode .text-overlay.dragging {
      opacity: 0.8;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    
    body.edit-mode .text-overlay[contenteditable="true"] {
      border: 2px solid #059669;
      background: rgba(255, 255, 255, 0.98);
      cursor: text;
      outline: none;
    }
    
    /* Delete button on each field */
    .delete-btn {
      display: none;
      position: absolute;
      top: -12px;
      left: -12px;
      width: 24px;
      height: 24px;
      background: #ef4444;
      color: white;
      border: none;
      border-radius: 50%;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      z-index: 10;
      align-items: center;
      justify-content: center;
    }
    
    body.edit-mode .text-overlay:hover .delete-btn {
      display: flex;
    }
    
    .delete-btn:hover {
      background: #dc2626;
      transform: scale(1.1);
    }
    
    .page-indicator {
      position: absolute;
      bottom: -35px;
      left: 50%;
      transform: translateX(-50%);
      background: #374151;
      color: white;
      padding: 6px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
    }
    
    /* Attachments section styles */
    .attachments-section {
      page-break-before: always;
      background: white;
      padding: 30px;
      margin-top: 30px;
      border-radius: 12px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.12);
      max-width: 892px;
    }
    
    .attachments-section h2 {
      font-size: 20px;
      color: #2563eb;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #e5e7eb;
    }
    
    .attachment-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    
    .attachment-item {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
      background: #f9fafb;
    }
    
    .attachment-item img {
      width: 100%;
      height: 200px;
      object-fit: cover;
      cursor: pointer;
      transition: transform 0.2s;
    }
    
    .attachment-item img:hover {
      transform: scale(1.02);
    }
    
    .attachment-item .file-name {
      padding: 10px;
      font-size: 12px;
      color: #6b7280;
      text-align: center;
      border-top: 1px solid #e5e7eb;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .pdf-links {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    
    .pdf-link {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      background: #fef3c7;
      border-radius: 8px;
      text-decoration: none;
      color: #92400e;
      font-weight: 500;
      transition: background 0.2s;
    }
    
    .pdf-link:hover {
      background: #fde68a;
    }
    
    .pdf-link svg {
      flex-shrink: 0;
    }
    
    /* Full page image for print */
    .attachment-page {
      page-break-before: always;
      page-break-after: always;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: white;
      padding: 20px;
    }
    
    .attachment-page img {
      max-width: 100%;
      max-height: 90vh;
      object-fit: contain;
    }
    
    .attachment-page .caption {
      margin-top: 15px;
      font-size: 14px;
      color: #6b7280;
    }
    
    @media print {
      .attachments-section {
        box-shadow: none;
        padding: 15mm;
      }
      
      .attachment-grid {
        display: none;
      }
      
      .pdf-links {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button onclick="backToReport()" class="back-btn">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
      العودة للبلاغ
    </button>
    <button onclick="window.print()">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z"/>
      </svg>
      طباعة
    </button>
    <button id="editBtn" onclick="toggleEditMode()">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      تعديل
    </button>
    <select id="pageSelect" title="اختر الصفحة"></select>
    <button class="add-btn" onclick="addNewTextField()">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M12 5v14M5 12h14"/>
      </svg>
      إضافة نص
    </button>
  </div>
  
  <div class="loading" id="loading">
    <p>جاري تحميل التقرير...</p>
  </div>

  <div class="page-wrapper" id="pageWrapper"></div>

  <script>
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    
    const ATTACHMENTS_DATA = JSON.parse('${attachmentsJson}');
    
    const TEMPLATE_URL = '${templatePdfUrl}';
    const RENDER_SCALE = ${MAPPER_RENDER_SCALE};
    const FIELD_DATA = JSON.parse('${fieldDataJson}');
    const SUPABASE_URL = '${supabaseUrl}';
    const SUPABASE_ANON_KEY = '${supabaseAnonKey}';
    const REPORT_ID = '${report.id}';
    
    let isEditMode = false;
    let draggedElement = null;
    let dragOffset = { x: 0, y: 0 };
    let newFieldCounter = 0;
    let totalPages = 0;
    let pageContainers = [];
    
    const CRM_BASE_URL = 'https://3846f912-c591-4c1e-b01f-723e45f1efc1.lovableproject.com';
    
    function backToReport() {
      window.location.href = CRM_BASE_URL + '/accidents/' + REPORT_ID;
    }
    
    async function renderPdf() {
      try {
        const pdf = await pdfjsLib.getDocument(TEMPLATE_URL).promise;
        totalPages = pdf.numPages;
        
        const pageWrapper = document.getElementById('pageWrapper');
        const pageSelect = document.getElementById('pageSelect');
        
        // A4 dimensions in pixels at 96 DPI
        const A4_WIDTH_MM = 210;
        const A4_HEIGHT_MM = 297;
        const MM_TO_PX = 96 / 25.4; // ~3.78 px per mm
        const A4_WIDTH_PX = A4_WIDTH_MM * MM_TO_PX;
        
        // Create all page containers dynamically
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          
          // Calculate print scale to fit A4
          const printScale = A4_WIDTH_PX / viewport.width;
          
          // Create page container
          const container = document.createElement('div');
          container.className = 'page-container';
          container.setAttribute('data-page', pageNum - 1);
          container.style.width = viewport.width + 'px';
          container.style.height = viewport.height + 'px';
          container.style.setProperty('--print-scale', printScale.toFixed(4));
          
          // Create canvas for PDF background
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          container.appendChild(canvas);
          
          // Create overlay container with same dimensions
          const overlayContainer = document.createElement('div');
          overlayContainer.className = 'overlay-container';
          overlayContainer.id = 'overlay-container-' + (pageNum - 1);
          overlayContainer.style.width = viewport.width + 'px';
          overlayContainer.style.height = viewport.height + 'px';
          container.appendChild(overlayContainer);
          
          // Add page indicator
          const indicator = document.createElement('div');
          indicator.className = 'page-indicator';
          indicator.textContent = 'صفحة ' + pageNum + ' / ' + totalPages;
          container.appendChild(indicator);
          
          pageWrapper.appendChild(container);
          pageContainers.push(container);
          
          // Render PDF page to canvas
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport: viewport }).promise;
          
          // Add field overlays for this page
          const pageIndex = pageNum - 1;
          const pageFields = FIELD_DATA[pageIndex] || [];
          pageFields.forEach(field => {
            const overlay = createOverlay(field);
            overlayContainer.appendChild(overlay);
          });
          
          // Add to page selector
          const option = document.createElement('option');
          option.value = pageIndex;
          option.textContent = 'صفحة ' + pageNum;
          pageSelect.appendChild(option);
        }
        
        document.getElementById('loading').classList.add('hidden');
        
      } catch (error) {
        console.error('Error rendering PDF:', error);
        document.getElementById('loading').innerHTML = '<p style="color: red;">فشل في تحميل القالب</p>';
      }
    }
    
    function createOverlay(field) {
      const config = field.config;
      const value = field.value;
      
      // Smaller font - minimum 14px, add 2 to saved size
      const fontSize = Math.max((config.size || 12) + 2, 14);
      
      const el = document.createElement('div');
      el.className = 'text-overlay';
      el.setAttribute('data-field', field.id);
      el.style.left = config.x + 'px';
      el.style.top = config.y + 'px';
      el.style.fontSize = fontSize + 'px';
      
      // Check if this is the customer_signature field with a URL
      if (field.id === 'customer_signature' && value && value.startsWith('http')) {
        // Render as image
        const img = document.createElement('img');
        img.src = value;
        img.style.maxHeight = (fontSize * 4) + 'px';
        img.style.maxWidth = '200px';
        img.style.objectFit = 'contain';
        img.alt = 'توقيع العميل';
        el.appendChild(img);
        el.style.padding = '2px';
        el.style.background = 'transparent';
      } else {
        el.textContent = value;
      }
      
      addDeleteButton(el);
      return el;
    }
    
    function addDeleteButton(el) {
      if (el.querySelector('.delete-btn')) return;
      const btn = document.createElement('button');
      btn.className = 'delete-btn';
      btn.innerHTML = '×';
      btn.title = 'حذف';
      btn.onclick = function(e) {
        e.stopPropagation();
        if (confirm('هل تريد حذف هذا الحقل؟')) {
          el.remove();
        }
      };
      el.appendChild(btn);
    }
    
    function collectAllFields() {
      const fields = [];
      document.querySelectorAll('.overlay-container').forEach((container, pageIndex) => {
        container.querySelectorAll('.text-overlay').forEach(el => {
          // Get text without the delete button
          let text = '';
          el.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
              text += node.textContent;
            }
          });
          
          fields.push({
            id: el.getAttribute('data-field'),
            page: pageIndex,
            x: parseInt(el.style.left) || 0,
            y: parseInt(el.style.top) || 0,
            text: text.trim(),
            fontSize: parseInt(el.style.fontSize) || 18
          });
        });
      });
      return fields;
    }
    
    async function toggleEditMode() {
      const btn = document.getElementById('editBtn');
      
      if (isEditMode) {
        // Exiting edit mode - SAVE changes
        const fields = collectAllFields();
        btn.disabled = true;
        btn.innerHTML = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> جاري الحفظ...';
        
        try {
          const response = await fetch(SUPABASE_URL + '/functions/v1/save-accident-edits', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
              accident_report_id: REPORT_ID,
              fields: fields
            })
          });
          
          const result = await response.json();
          
          if (!response.ok) {
            throw new Error(result.error || 'Failed to save');
          }
          
          // Show success briefly
          btn.innerHTML = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg> تم الحفظ ✓';
          setTimeout(() => {
            btn.innerHTML = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> تعديل';
          }, 1500);
          
        } catch (error) {
          console.error('Save error:', error);
          alert('فشل في الحفظ: ' + error.message);
          btn.innerHTML = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg> حفظ';
          btn.disabled = false;
          return; // Don't exit edit mode if save failed
        }
        
        btn.disabled = false;
      }
      
      isEditMode = !isEditMode;
      document.body.classList.toggle('edit-mode', isEditMode);
      btn.classList.toggle('active', isEditMode);
      
      if (isEditMode) {
        btn.innerHTML = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg> حفظ';
      }
      
      document.querySelectorAll('.text-overlay').forEach(el => {
        if (isEditMode) {
          el.addEventListener('dblclick', enableTextEdit);
          el.addEventListener('mousedown', startDrag);
        } else {
          el.removeEventListener('dblclick', enableTextEdit);
          el.removeEventListener('mousedown', startDrag);
          el.setAttribute('contenteditable', 'false');
        }
      });
    }
    
    function enableTextEdit(e) {
      if (!isEditMode) return;
      e.stopPropagation();
      const el = e.target.closest('.text-overlay');
      if (!el) return;
      el.setAttribute('contenteditable', 'true');
      el.focus();
      
      const textNode = el.childNodes[0];
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        const range = document.createRange();
        range.selectNode(textNode);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    
    function startDrag(e) {
      if (!isEditMode) return;
      if (e.target.classList.contains('delete-btn')) return;
      if (e.target.getAttribute('contenteditable') === 'true') return;
      
      draggedElement = e.target.closest('.text-overlay');
      if (!draggedElement) return;
      
      const rect = draggedElement.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;
      
      draggedElement.classList.add('dragging');
      
      document.addEventListener('mousemove', onDrag);
      document.addEventListener('mouseup', endDrag);
      e.preventDefault();
    }
    
    function onDrag(e) {
      if (!draggedElement) return;
      
      const container = draggedElement.closest('.overlay-container');
      const containerRect = container.getBoundingClientRect();
      
      let newX = e.clientX - containerRect.left - dragOffset.x;
      let newY = e.clientY - containerRect.top - dragOffset.y;
      
      newX = Math.max(0, Math.min(newX, containerRect.width - draggedElement.offsetWidth));
      newY = Math.max(0, Math.min(newY, containerRect.height - draggedElement.offsetHeight));
      
      draggedElement.style.left = newX + 'px';
      draggedElement.style.top = newY + 'px';
    }
    
    function endDrag() {
      if (draggedElement) {
        draggedElement.classList.remove('dragging');
        draggedElement = null;
      }
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup', endDrag);
    }
    
    function addNewTextField() {
      const pageIndex = parseInt(document.getElementById('pageSelect').value) || 0;
      const container = document.getElementById('overlay-container-' + pageIndex);
      if (!container) {
        alert('الصفحة غير موجودة');
        return;
      }
      
      newFieldCounter++;
      
      const newField = document.createElement('div');
      newField.className = 'text-overlay';
      newField.setAttribute('data-field', 'custom-' + newFieldCounter);
      newField.style.cssText = 'left: 100px; top: 100px; font-size: 18px;';
      newField.textContent = 'نص جديد';
      
      addDeleteButton(newField);
      
      newField.addEventListener('dblclick', enableTextEdit);
      newField.addEventListener('mousedown', startDrag);
      
      container.appendChild(newField);
      
      container.closest('.page-container').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    document.addEventListener('click', (e) => {
      if (isEditMode && !e.target.closest('.text-overlay')) {
        document.querySelectorAll('.text-overlay[contenteditable="true"]').forEach(el => {
          el.setAttribute('contenteditable', 'false');
        });
      }
    });
    
    // Function to render attachments section
    function renderAttachments() {
      const pageWrapper = document.getElementById('pageWrapper');
      
      const hasImages = ATTACHMENTS_DATA.images && ATTACHMENTS_DATA.images.length > 0;
      const hasPdfs = ATTACHMENTS_DATA.pdfs && ATTACHMENTS_DATA.pdfs.length > 0;
      
      if (!hasImages && !hasPdfs) return;
      
      // Create attachments section for screen view
      const section = document.createElement('div');
      section.className = 'attachments-section';
      section.innerHTML = '<h2>📎 المرفقات</h2>';
      
      // Images grid
      if (hasImages) {
        const grid = document.createElement('div');
        grid.className = 'attachment-grid';
        
        ATTACHMENTS_DATA.images.forEach((file, index) => {
          const item = document.createElement('div');
          item.className = 'attachment-item';
          
          const img = document.createElement('img');
          img.src = file.file_url;
          img.alt = file.file_name || 'صورة مرفقة';
          img.onclick = () => window.open(file.file_url, '_blank');
          
          const name = document.createElement('div');
          name.className = 'file-name';
          name.textContent = file.file_name || ('صورة ' + (index + 1));
          
          item.appendChild(img);
          item.appendChild(name);
          grid.appendChild(item);
        });
        
        section.appendChild(grid);
      }
      
      // PDF links
      if (hasPdfs) {
        const linksContainer = document.createElement('div');
        linksContainer.className = 'pdf-links';
        
        ATTACHMENTS_DATA.pdfs.forEach((file, index) => {
          const link = document.createElement('a');
          link.className = 'pdf-link';
          link.href = file.file_url;
          link.target = '_blank';
          link.innerHTML = '<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>' + 
            (file.file_name || ('ملف PDF ' + (index + 1)));
          linksContainer.appendChild(link);
        });
        
        section.appendChild(linksContainer);
      }
      
      pageWrapper.appendChild(section);
      
      // Create full-page images for print
      if (hasImages) {
        ATTACHMENTS_DATA.images.forEach((file, index) => {
          const page = document.createElement('div');
          page.className = 'attachment-page';
          
          const img = document.createElement('img');
          img.src = file.file_url;
          img.alt = file.file_name || 'صورة مرفقة';
          
          const caption = document.createElement('div');
          caption.className = 'caption';
          caption.textContent = file.file_name || ('مرفق ' + (index + 1));
          
          page.appendChild(img);
          page.appendChild(caption);
          pageWrapper.appendChild(page);
        });
      }
    }
    
    renderPdf().then(() => {
      renderAttachments();
    });
  <\/script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function generateHtmlReport(
  report: AccidentReport,
  thirdParties: ThirdParty[],
  branding: AgentBranding,
): string {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("en-GB");
  };

  const policyTypeLabel = report.policies.policy_type_child === "THIRD" ? "طرف ثالث" : "شامل";
  // Insurance company on the policy (Ahli, Shamal, etc.) — still
  // shown further down in the policy section, NOT as the printed
  // report's brand.
  const insurerName = report.insurance_companies?.name_ar || report.insurance_companies?.name || "-";
  // Brand block — agent's own logo + name. If the agent has no
  // site_settings row yet, branding falls back to the generic
  // "وكالة التأمين" default from agent-branding.ts.
  const brandLogoHtml = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.companyName)}" style="max-height:60px;max-width:220px;object-fit:contain;display:block;margin:0 auto 8px auto;" />`
    : "";

  let thirdPartiesHtml = "";
  if (thirdParties.length > 0) {
    thirdPartiesHtml = `
    <div class="section">
      <h2 class="section-title">بيانات الأطراف الأخرى</h2>
      ${thirdParties.map((tp, i) => `
        <div class="third-party-card">
          <h4>الطرف الثالث ${i + 1}: ${escapeHtml(tp.full_name)}</h4>
          <div class="info-grid">
            <div class="info-item"><label>رقم الهوية</label><span>${escapeHtml(tp.id_number || "-")}</span></div>
            <div class="info-item"><label>الهاتف</label><span>${escapeHtml(tp.phone || "-")}</span></div>
            <div class="info-item"><label>رقم السيارة</label><span>${escapeHtml(tp.vehicle_number || "-")}</span></div>
            <div class="info-item"><label>نوع السيارة</label><span>${escapeHtml(tp.vehicle_manufacturer || "")} ${escapeHtml(tp.vehicle_model || "")} ${tp.vehicle_year || ""}</span></div>
            <div class="info-item"><label>شركة التأمين</label><span>${escapeHtml(tp.insurance_company || "-")}</span></div>
            <div class="info-item"><label>رقم الوثيقة</label><span>${escapeHtml(tp.insurance_policy_number || "-")}</span></div>
            <div class="info-item full-width"><label>وصف الأضرار</label><span>${escapeHtml(tp.damage_description || "-")}</span></div>
          </div>
        </div>
      `).join("")}
    </div>`;
  }

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>بلاغ حادث - ${escapeHtml(report.clients.full_name)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Tajawal', sans-serif; font-size: 13px; line-height: 1.5; color: #1a1a1a; background: #fff; padding: 15mm; }
    .header { text-align: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #2563eb; }
    .header h1 { font-size: 22px; color: #2563eb; margin-bottom: 8px; }
    .header .company-name { font-size: 16px; font-weight: 600; color: #333; }
    .header .owner-name { font-size: 13px; color: #555; margin-top: 2px; }
    .header .tax-number { font-size: 12px; color: #555; margin-top: 2px; direction: ltr; unicode-bidi: isolate; }
    .header p { color: #666; font-size: 12px; }
    .section { margin-bottom: 20px; }
    .section-title { font-size: 15px; font-weight: 700; color: #2563eb; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
    .info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
    .info-item { display: flex; flex-direction: column; gap: 2px; }
    .info-item label { font-size: 11px; color: #666; font-weight: 500; }
    .info-item span { font-size: 13px; color: #1a1a1a; font-weight: 600; }
    .info-item.full-width { grid-column: 1 / -1; }
    .third-party-card { background: #f9fafb; padding: 12px; border-radius: 8px; margin-bottom: 12px; }
    .third-party-card h4 { font-size: 14px; color: #374151; margin-bottom: 10px; }
    .description-box { background: #f3f4f6; padding: 12px; border-radius: 8px; margin-top: 8px; }
    .description-box p { font-size: 13px; color: #374151; white-space: pre-wrap; }
    .print-button { position: fixed; top: 20px; left: 20px; background: #2563eb; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-family: 'Tajawal', sans-serif; font-size: 14px; }
    .print-button:hover { background: #1d4ed8; }
    @media print {
      .print-button { display: none; }
      body { padding: 10mm; }
    }
    .signature-area { margin-top: 40px; display: flex; justify-content: space-between; }
    .signature-box { text-align: center; width: 200px; }
    .signature-line { border-top: 1px solid #333; margin-top: 50px; padding-top: 5px; font-size: 12px; }
  </style>
</head>
<body>
  <button class="print-button" onclick="window.print()">طباعة</button>
  
  <div class="header">
    ${brandLogoHtml}
    <h1>بلاغ حادث طرق</h1>
    <div class="company-name">${escapeHtml(branding.companyName)}</div>
    ${branding.ownerName && branding.ownerName.trim() !== branding.companyName.trim() ? `<div class="owner-name">${escapeHtml(branding.ownerName)}</div>` : ''}
    ${branding.taxNumber ? `<div class="tax-number">رقم المشغل: ${escapeHtml(branding.taxNumber)}</div>` : ''}
    <p>تاريخ التقرير: ${formatDate(new Date().toISOString())}</p>
  </div>

  <div class="section">
    <h2 class="section-title">بيانات الوثيقة</h2>
    <div class="info-grid">
      <div class="info-item"><label>رقم الوثيقة</label><span>${escapeHtml(report.policies.policy_number || "-")}</span></div>
      <div class="info-item"><label>شركة التأمين</label><span>${escapeHtml(insurerName)}</span></div>
      <div class="info-item"><label>نوع التأمين</label><span>${policyTypeLabel}</span></div>
      <div class="info-item"><label>تاريخ البداية</label><span>${formatDate(report.policies.start_date)}</span></div>
      <div class="info-item"><label>تاريخ النهاية</label><span>${formatDate(report.policies.end_date)}</span></div>
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">بيانات صاحب السيارة</h2>
    <div class="info-grid">
      <div class="info-item"><label>الاسم الكامل</label><span>${escapeHtml(report.clients.full_name)}</span></div>
      <div class="info-item"><label>رقم الهوية</label><span>${escapeHtml(report.clients.id_number)}</span></div>
      <div class="info-item"><label>رقم الهاتف</label><span>${escapeHtml(report.clients.phone_number || "-")}</span></div>
      <div class="info-item"><label>العنوان</label><span>${escapeHtml(report.owner_address || "-")}</span></div>
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">بيانات المركبة</h2>
    <div class="info-grid">
      <div class="info-item"><label>رقم المركبة</label><span>${escapeHtml(report.cars?.car_number || "-")}</span></div>
      <div class="info-item"><label>الصنع</label><span>${escapeHtml(report.cars?.manufacturer_name || "-")}</span></div>
      <div class="info-item"><label>الموديل</label><span>${escapeHtml(report.cars?.model || "-")}</span></div>
      <div class="info-item"><label>سنة الصنع</label><span>${report.cars?.year || "-"}</span></div>
      <div class="info-item"><label>اللون</label><span>${escapeHtml(report.cars?.color || "-")}</span></div>
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">تفاصيل الحادث</h2>
    <div class="info-grid">
      <div class="info-item"><label>تاريخ الحادث</label><span>${formatDate(report.accident_date)}</span></div>
      <div class="info-item"><label>ساعة الحادث</label><span>${escapeHtml(report.accident_time || "-")}</span></div>
      <div class="info-item"><label>مكان الحادث</label><span>${escapeHtml(report.accident_location || "-")}</span></div>
      <div class="info-item"><label>عدد الركاب</label><span>${report.passengers_count || "-"}</span></div>
    </div>
    <div class="description-box">
      <label style="font-size: 11px; color: #666; display: block; margin-bottom: 4px;">وصف الحادث</label>
      <p>${escapeHtml(report.accident_description || "-")}</p>
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">بيانات السائق وقت الحادث</h2>
    <div class="info-grid">
      <div class="info-item"><label>اسم السائق</label><span>${escapeHtml(report.driver_name || "-")}</span></div>
      <div class="info-item"><label>رقم الهوية</label><span>${escapeHtml(report.driver_id_number || "-")}</span></div>
      <div class="info-item"><label>رقم الهاتف</label><span>${escapeHtml(report.driver_phone || "-")}</span></div>
      <div class="info-item"><label>العمر</label><span>${report.driver_age || "-"}</span></div>
      <div class="info-item"><label>المهنة</label><span>${escapeHtml(report.driver_occupation || "-")}</span></div>
      <div class="info-item"><label>رقم الرخصة</label><span>${escapeHtml(report.driver_license_number || "-")}</span></div>
      <div class="info-item"><label>تاريخ انتهاء الرخصة</label><span>${formatDate(report.license_expiry_date)}</span></div>
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">الأضرار</h2>
    <div class="description-box">
      <label style="font-size: 11px; color: #666; display: block; margin-bottom: 4px;">أضرار سيارتك</label>
      <p>${escapeHtml(report.own_car_damages || "-")}</p>
    </div>
    <div class="info-grid" style="margin-top: 10px;">
      <div class="info-item"><label>هل أصيب أحد</label><span>${report.was_anyone_injured ? "نعم" : "لا"}</span></div>
    </div>
    ${report.injuries_description ? `<div class="description-box"><label style="font-size: 11px; color: #666; display: block; margin-bottom: 4px;">تفاصيل الإصابات</label><p>${escapeHtml(report.injuries_description)}</p></div>` : ""}
  </div>

  ${thirdPartiesHtml}

  <div class="section">
    <h2 class="section-title">الشرطة</h2>
    <div class="info-grid">
      <div class="info-item"><label>هل حققت الشرطة</label><span>${report.police_reported ? "نعم" : "لا"}</span></div>
      ${report.police_reported ? `
        <div class="info-item"><label>مخفر الشرطة</label><span>${escapeHtml(report.police_station || "-")}</span></div>
        <div class="info-item"><label>رقم المحضر</label><span>${escapeHtml(report.police_report_number || "-")}</span></div>
      ` : ""}
    </div>
  </div>

  <div class="signature-area">
    <div class="signature-box">
      <div class="signature-line">توقيع صاحب السيارة</div>
    </div>
    <div class="signature-box">
      <div class="signature-line">توقيع الوكيل</div>
    </div>
  </div>
</body>
</html>`;
}
