import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EditedField {
  id: string;
  page: number;
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

interface SaveEditsRequest {
  accident_report_id: string;
  fields: EditedField[];
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

    const { accident_report_id, fields }: SaveEditsRequest = await req.json();

    if (!accident_report_id) {
      throw new Error("accident_report_id is required");
    }

    if (!fields || !Array.isArray(fields)) {
      throw new Error("fields array is required");
    }

    console.log(`Saving ${fields.length} edited fields for report: ${accident_report_id}`);

    // Build the edited_fields_json structure
    const editedFieldsJson = {
      fields: fields,
      lastSavedAt: new Date().toISOString(),
    };

    // Update the accident report with edited fields
    const { error: updateError } = await supabase
      .from("accident_reports")
      .update({ edited_fields_json: editedFieldsJson })
      .eq("id", accident_report_id);

    if (updateError) {
      console.error("Failed to update edited_fields_json:", updateError);
      throw new Error(`Failed to save edits: ${updateError.message}`);
    }

    console.log("Saved edited_fields_json to database");

    // Now regenerate the HTML file with the saved edits
    // Fetch the full report data to regenerate HTML
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

    // Check if company has a template
    if (!report.company_id) {
      return new Response(
        JSON.stringify({ success: true, message: "Edits saved (no template)" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: template } = await supabase
      .from("company_accident_templates")
      .select("template_pdf_url, mapping_json, is_active")
      .eq("company_id", report.company_id)
      .eq("is_active", true)
      .single();

    if (!template?.template_pdf_url || !template?.mapping_json) {
      return new Response(
        JSON.stringify({ success: true, message: "Edits saved (no template)" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch third parties
    const { data: thirdParties } = await supabase
      .from("accident_third_parties")
      .select("*")
      .eq("accident_report_id", accident_report_id)
      .order("sort_order");

    // Generate the updated HTML
    const htmlContent = generateHtmlOverlayReportWithEdits(
      template.template_pdf_url,
      template.mapping_json,
      report,
      thirdParties || [],
      editedFieldsJson,
      supabaseUrl,
      supabaseAnonKey
    );

    // Upload to Bunny Storage - always use fixed path for stable URL
    if (bunnyStorageKey) {
      // Use fixed filename for stable URL
      const storagePath = `accident-reports/${accident_report_id}/report.html`;
      const cdnUrl = `${bunnyCdnUrl}/${storagePath}`;
      const uploadUrl = `https://storage.bunnycdn.com/${bunnyStorageZone}/${storagePath}`;
      
      console.log("Uploading updated HTML to:", uploadUrl);

      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "AccessKey": bunnyStorageKey,
          "Content-Type": "text/html; charset=utf-8",
        },
        body: htmlContent,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error("Bunny upload failed:", errorText);
        // Don't throw - edits are saved in DB, just log warning
        console.warn("Could not update CDN file, but database was updated");
      } else {
        console.log("Successfully updated HTML on CDN");
        
        // Purge CDN cache to show updated content immediately
        // Note: Purge API requires Account API Key, not Storage Key
        if (bunnyAccountKey) {
          try {
            const purgeUrl = `https://api.bunny.net/purge?url=${encodeURIComponent(cdnUrl)}`;
            const purgeResponse = await fetch(purgeUrl, {
              method: "POST",
              headers: {
                "AccessKey": bunnyAccountKey,
              },
            });
            if (purgeResponse.ok) {
              console.log("CDN cache purged successfully for:", cdnUrl);
            } else {
              console.warn("CDN purge failed:", await purgeResponse.text());
            }
          } catch (purgeError) {
            console.warn("CDN purge error (non-fatal):", purgeError);
          }
        } else {
          console.warn("BUNNY_ACCOUNT_API_KEY not set - cache purge skipped");
        }
      }

      // Update the generated_pdf_url to the stable URL if it was different
      if (report.generated_pdf_url !== cdnUrl) {
        await supabase
          .from("accident_reports")
          .update({ generated_pdf_url: cdnUrl })
          .eq("id", accident_report_id);
        console.log("Updated generated_pdf_url to stable URL:", cdnUrl);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Edits saved successfully",
        fields_count: fields.length 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error saving accident edits:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// IMPORTANT: must match the scale used in generate-accident-pdf
const MAPPER_RENDER_SCALE = 1.5;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface EditedFieldsJson {
  fields: EditedField[];
  lastSavedAt: string;
}

function generateHtmlOverlayReportWithEdits(
  templatePdfUrl: string,
  _originalMapping: any,
  report: any,
  _thirdParties: any[],
  editedFieldsJson: EditedFieldsJson,
  supabaseUrl: string,
  supabaseAnonKey: string
): string {
  // Use the edited fields directly - they already contain positions and text
  const fieldsByPage: Record<number, Array<{ id: string; config: { x: number; y: number; size: number }; value: string }>> = {};
  
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

  // Escape field data for embedding in JS
  const fieldDataJson = JSON.stringify(fieldsByPage).replace(/'/g, "\\'").replace(/\n/g, "\\n");

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
    
    .toolbar button:disabled {
      opacity: 0.7;
      cursor: not-allowed;
      transform: none;
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
    
    const CRM_BASE_URL = 'https://getthiqa.com';
    
    function backToReport() {
      window.location.href = CRM_BASE_URL + '/accidents/' + REPORT_ID;
    }
    
    async function renderPdf() {
      try {
        const pdf = await pdfjsLib.getDocument(TEMPLATE_URL).promise;
        totalPages = pdf.numPages;
        
        const pageWrapper = document.getElementById('pageWrapper');
        const pageSelect = document.getElementById('pageSelect');
        
        const A4_WIDTH_MM = 210;
        const A4_HEIGHT_MM = 297;
        const MM_TO_PX = 96 / 25.4;
        const A4_WIDTH_PX = A4_WIDTH_MM * MM_TO_PX;
        
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          
          const printScale = A4_WIDTH_PX / viewport.width;
          
          const container = document.createElement('div');
          container.className = 'page-container';
          container.setAttribute('data-page', pageNum - 1);
          container.style.width = viewport.width + 'px';
          container.style.height = viewport.height + 'px';
          container.style.setProperty('--print-scale', printScale.toFixed(4));
          
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          container.appendChild(canvas);
          
          const overlayContainer = document.createElement('div');
          overlayContainer.className = 'overlay-container';
          overlayContainer.id = 'overlay-container-' + (pageNum - 1);
          overlayContainer.style.width = viewport.width + 'px';
          overlayContainer.style.height = viewport.height + 'px';
          container.appendChild(overlayContainer);
          
          const indicator = document.createElement('div');
          indicator.className = 'page-indicator';
          indicator.textContent = 'صفحة ' + pageNum + ' / ' + totalPages;
          container.appendChild(indicator);
          
          pageWrapper.appendChild(container);
          pageContainers.push(container);
          
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport: viewport }).promise;
          
          const pageIndex = pageNum - 1;
          const pageFields = FIELD_DATA[pageIndex] || [];
          pageFields.forEach(field => {
            const overlay = createOverlay(field);
            overlayContainer.appendChild(overlay);
          });
          
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
      
      const fontSize = Math.max(config.size || 14, 14);
      
      const el = document.createElement('div');
      el.className = 'text-overlay';
      el.setAttribute('data-field', field.id);
      el.style.left = config.x + 'px';
      el.style.top = config.y + 'px';
      el.style.fontSize = fontSize + 'px';
      el.textContent = value;
      
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
    
    renderPdf();
  <\/script>
</body>
</html>`;
}
