 import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
 import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
 
 const corsHeaders = {
   "Access-Control-Allow-Origin": "*",
   "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
 };
 
 interface SendAccidentSignatureRequest {
   accident_report_id: string;
   phone_number_override?: string; // Optional: use this instead of client's phone
 }
 
 function generateToken(length = 32): string {
   const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
   let result = "";
   const randomValues = new Uint8Array(length);
   crypto.getRandomValues(randomValues);
   for (let i = 0; i < length; i++) {
     result += chars[randomValues[i] % chars.length];
   }
   return result;
 }
 
 function formatDate(dateStr: string): string {
   if (!dateStr) return '';
   const date = new Date(dateStr);
   return date.toLocaleDateString('ar-EG', { 
     year: 'numeric', 
     month: 'long', 
     day: 'numeric',
   });
 }
 
 serve(async (req) => {
   if (req.method === "OPTIONS") {
     return new Response(null, { headers: corsHeaders });
   }
 
   const startTime = Date.now();
 
   try {
     const authHeader = req.headers.get("Authorization");
     if (!authHeader) {
       return new Response(
         JSON.stringify({ error: "Missing authorization header" }),
         { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
     const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
     const bunnyApiKey = Deno.env.get('BUNNY_API_KEY');
     const bunnyStorageZone = Deno.env.get('BUNNY_STORAGE_ZONE');
     const bunnyCdnUrl = Deno.env.get('BUNNY_CDN_URL') || 'https://kareem.b-cdn.net';
 
     const supabase = createClient(supabaseUrl, supabaseServiceKey);
 
     // Verify user
     const token = authHeader.replace("Bearer ", "");
     const { data: { user }, error: authError } = await supabase.auth.getUser(token);
     
     if (authError || !user) {
       return new Response(
         JSON.stringify({ error: "Invalid authentication" }),
         { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     const { accident_report_id, phone_number_override }: SendAccidentSignatureRequest = await req.json();
 
     if (!accident_report_id) {
       return new Response(
         JSON.stringify({ error: "accident_report_id is required" }),
         { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     console.log(`[send-accident-signature-sms] Processing accident report: ${accident_report_id}`);
 
     // Get accident report with client and policy details
     const { data: report, error: reportError } = await supabase
       .from("accident_reports")
       .select(`
         *,
         clients!inner(id, full_name, phone_number, id_number),
         cars(car_number, manufacturer_name, model, year),
         policies!inner(policy_number, start_date, end_date),
         insurance_companies(name, name_ar)
       `)
       .eq("id", accident_report_id)
       .single();
 
     if (reportError || !report) {
       console.error("[send-accident-signature-sms] Report not found:", reportError);
       return new Response(
         JSON.stringify({ error: "Accident report not found" }),
         { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Check if already signed
     if (report.customer_signature_url) {
       console.log("[send-accident-signature-sms] Report already has signature");
       return new Response(
         JSON.stringify({ 
           success: false, 
           message: "البلاغ موقع مسبقاً",
           signature_url: report.customer_signature_url
         }),
         { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Determine phone number to use
     const phoneNumber = phone_number_override || report.clients.phone_number;
     
     if (!phoneNumber) {
       return new Response(
         JSON.stringify({ error: "لا يوجد رقم هاتف للعميل" }),
         { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Check Bunny configuration
     if (!bunnyApiKey || !bunnyStorageZone) {
       console.error('[send-accident-signature-sms] Missing Bunny configuration');
       return new Response(
         JSON.stringify({ error: 'إعدادات التخزين غير مكتملة' }),
         { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
       );
     }
 
     // Get SMS settings
     const { data: smsSettings, error: smsSettingsError } = await supabase
       .from("sms_settings")
       .select("*")
       .limit(1)
       .maybeSingle();
 
     if (smsSettingsError) {
       console.error("[send-accident-signature-sms] Error fetching SMS settings:", smsSettingsError);
       return new Response(
         JSON.stringify({ error: "Failed to fetch SMS settings" }),
         { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     if (!smsSettings || !smsSettings.is_enabled) {
       return new Response(
         JSON.stringify({ error: "خدمة الرسائل النصية غير مفعلة" }),
         { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Generate secure token
     const signatureToken = generateToken(32);
     const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
 
     // Generate signature page HTML
     const signatureHtml = buildAccidentSignaturePageHtml(
       report,
       signatureToken,
       tokenExpiresAt,
       supabaseUrl
     );
 
     // Upload signature page to Bunny CDN
     const now = new Date();
     const year = now.getFullYear();
     const month = String(now.getMonth() + 1).padStart(2, '0');
     const timestamp = Date.now();
     const randomId = crypto.randomUUID().slice(0, 8);
     const storagePath = `accident-signatures/${year}/${month}/sign_${accident_report_id}_${timestamp}_${randomId}.html`;
 
     const bunnyUploadUrl = `https://storage.bunnycdn.com/${bunnyStorageZone}/${storagePath}`;
     
     console.log(`[send-accident-signature-sms] Uploading signature page to: ${bunnyUploadUrl}`);
 
     const uploadResponse = await fetch(bunnyUploadUrl, {
       method: 'PUT',
       headers: {
         'AccessKey': bunnyApiKey,
         'Content-Type': 'text/html; charset=utf-8',
         'Cache-Control': 'no-store, max-age=0',
       },
       body: signatureHtml,
     });
 
     if (!uploadResponse.ok) {
       const errorText = await uploadResponse.text();
       console.error('[send-accident-signature-sms] Bunny upload failed:', errorText);
       return new Response(
         JSON.stringify({ error: 'فشل في رفع صفحة التوقيع' }),
         { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
       );
     }
 
     const signaturePageUrl = `${bunnyCdnUrl}/${storagePath}?v=${timestamp}`;
     console.log(`[send-accident-signature-sms] Signature page uploaded: ${signaturePageUrl}`);
 
     // Update accident report with token
     const { error: updateError } = await supabase
       .from("accident_reports")
       .update({
         signature_token: signatureToken,
         signature_token_expires_at: tokenExpiresAt,
         signature_phone_override: phone_number_override || null,
       })
       .eq("id", accident_report_id);
 
     if (updateError) {
       console.error("[send-accident-signature-sms] Error updating report:", updateError);
       return new Response(
         JSON.stringify({ error: "Failed to update accident report" }),
         { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Build SMS message
     let smsMessage = "مرحباً {{client_name}}، يرجى التوقيع على بلاغ الحادث من الرابط التالي: {{signature_url}}";
 
     smsMessage = smsMessage
       .replace(/\{\{client_name\}\}/g, report.clients.full_name || "عميل")
       .replace(/\{\{signature_url\}\}/g, signaturePageUrl);
 
     const escapeXml = (value: string) =>
       value
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/\"/g, "&quot;")
         .replace(/'/g, "&apos;");
 
     // Normalize phone for 019sms
     let cleanPhone = phoneNumber.replace(/[^0-9]/g, "");
     if (cleanPhone.startsWith("972")) {
       cleanPhone = "0" + cleanPhone.substring(3);
     }
 
     // Send SMS via 019sms
     const dlr = crypto.randomUUID();
     const smsXml =
       `<?xml version="1.0" encoding="UTF-8"?>` +
       `<sms>` +
       `<user><username>${escapeXml(smsSettings.sms_user || "")}</username></user>` +
       `<source>${escapeXml(smsSettings.sms_source || "")}</source>` +
       `<destinations><phone id="${dlr}">${escapeXml(cleanPhone)}</phone></destinations>` +
       `<message>${escapeXml(smsMessage)}</message>` +
       `</sms>`;
 
     console.log(`[send-accident-signature-sms] Sending SMS to ${cleanPhone}`);
 
     const smsResponse = await fetch("https://019sms.co.il/api", {
       method: "POST",
       headers: {
         Authorization: `Bearer ${smsSettings.sms_token}`,
         "Content-Type": "application/xml; charset=utf-8",
       },
       body: smsXml,
     });
 
     const smsResult = await smsResponse.text();
     console.log("[send-accident-signature-sms] 019sms raw response:", smsResult);
 
     const extractTag = (xml: string, tag: string) => {
       const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
       return match?.[1]?.trim() ?? null;
     };
 
     const status = extractTag(smsResult, "status");
     const apiMessage = extractTag(smsResult, "message");
 
     if (!smsResponse.ok || status !== "0") {
       console.error(`[send-accident-signature-sms] SMS failed: status=${status} message=${apiMessage}`);
       // Clear token on failure
       await supabase
         .from("accident_reports")
         .update({ signature_token: null, signature_token_expires_at: null })
         .eq("id", accident_report_id);
       return new Response(
         JSON.stringify({ error: apiMessage || `SMS API error (status=${status ?? "unknown"})` }),
         { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Log the SMS
     await supabase.from("sms_logs").insert({
       phone_number: cleanPhone,
       message: smsMessage,
       sms_type: "accident_signature",
       status: "sent",
       sent_at: new Date().toISOString(),
       client_id: report.clients.id,
       policy_id: report.policy_id || null,
       created_by: user.id,
       branch_id: report.branch_id,
     });
 
     const duration = Date.now() - startTime;
     console.log(`[send-accident-signature-sms] Completed in ${duration}ms`);
 
     return new Response(
       JSON.stringify({ 
         success: true, 
         message: "تم إرسال رابط التوقيع بنجاح",
         sent_to: cleanPhone,
         signature_page_url: signaturePageUrl,
         expires_at: tokenExpiresAt,
         duration_ms: duration
       }),
       { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
     );
 
   } catch (error: unknown) {
     console.error("[send-accident-signature-sms] Fatal error:", error);
     const errorMessage = error instanceof Error ? error.message : "Internal server error";
     return new Response(
       JSON.stringify({ error: errorMessage }),
       { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
     );
   }
 });
 
 function buildAccidentSignaturePageHtml(
   report: any,
   token: string,
   expiresAt: string,
   supabaseUrl: string
 ): string {
   const clientName = report.clients?.full_name || 'عميل';
   const clientIdNumber = report.clients?.id_number || '';
   const carInfo = report.cars ? `${report.cars.manufacturer_name || ''} ${report.cars.model || ''} - ${report.cars.car_number || ''}` : '';
   const accidentDate = report.accident_date ? formatDate(report.accident_date) : '';
   const accidentLocation = report.accident_location || '';
   const companyName = report.insurance_companies?.name_ar || report.insurance_companies?.name || '';
   const policyNumber = report.policies?.policy_number || '';
   const reportNumber = report.report_number || '';
 
   return `<!DOCTYPE html>
 <html dir="rtl" lang="ar">
 <head>
   <meta charset="UTF-8">
   <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
   <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
   <title>توقيع بلاغ الحادث | ثقة للتأمين</title>
   <style>
     * { box-sizing: border-box; margin: 0; padding: 0; }
     body {
       font-family: 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif;
       min-height: 100vh;
       background: linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 50%, #3d5a7f 100%);
       padding: 20px;
       display: flex;
       align-items: center;
       justify-content: center;
     }
     .container {
       background: white;
       border-radius: 24px;
       max-width: 500px;
       width: 100%;
       box-shadow: 0 30px 60px rgba(0,0,0,0.3);
       overflow: hidden;
     }
     .header {
       background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
       color: white;
       padding: 25px 20px;
       text-align: center;
     }
     .header h1 { 
       font-size: 24px; 
       font-weight: 800;
       margin-bottom: 5px;
     }
     .header .subtitle {
       font-size: 14px;
       opacity: 0.9;
     }
     .content { padding: 20px; }
     
     .info-card {
       background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
       border-radius: 16px;
       padding: 16px;
       margin-bottom: 20px;
     }
     .info-card h3 {
       color: #dc2626;
       font-size: 16px;
       font-weight: 700;
       margin-bottom: 12px;
       padding-bottom: 8px;
       border-bottom: 2px solid #fecaca;
     }
     .info-row {
       display: flex;
       justify-content: space-between;
       padding: 8px 0;
       border-bottom: 1px dashed #e2e8f0;
     }
     .info-row:last-child { border-bottom: none; }
     .info-label {
       color: #64748b;
       font-size: 13px;
     }
     .info-value {
       color: #1e293b;
       font-size: 14px;
       font-weight: 600;
     }
     
     .declaration {
       background: #fef3c7;
       border: 2px solid #f59e0b;
       border-radius: 12px;
       padding: 15px;
       margin-bottom: 20px;
     }
     .declaration p {
       color: #92400e;
       font-size: 13px;
       line-height: 1.7;
     }
     
     .signature-section h3 {
       color: #1e3a5f;
       font-size: 16px;
       font-weight: 700;
       margin-bottom: 12px;
       text-align: center;
     }
     .canvas-wrapper {
       border: 3px dashed #cbd5e1;
       border-radius: 16px;
       background: #fafbfc;
       position: relative;
       overflow: hidden;
       touch-action: none;
       margin-bottom: 15px;
     }
     .canvas-wrapper.active {
       border-color: #dc2626;
       border-style: solid;
     }
     #signatureCanvas {
       display: block;
       width: 100%;
       height: 180px;
       cursor: crosshair;
       touch-action: none;
     }
     .canvas-hint {
       position: absolute;
       top: 50%;
       left: 50%;
       transform: translate(-50%, -50%);
       color: #94a3b8;
       font-size: 14px;
       pointer-events: none;
       transition: opacity 0.3s;
     }
     .canvas-hint.hidden { opacity: 0; }
     
     .btn-row {
       display: flex;
       gap: 10px;
       margin-bottom: 15px;
     }
     .btn {
       flex: 1;
       padding: 14px 20px;
       border-radius: 12px;
       font-size: 16px;
       font-weight: 700;
       font-family: 'Tajawal', sans-serif;
       cursor: pointer;
       border: none;
       transition: all 0.2s;
     }
     .btn-clear {
       background: #f1f5f9;
       color: #64748b;
     }
     .btn-submit {
       background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
       color: white;
     }
     .btn-submit:disabled {
       opacity: 0.5;
       cursor: not-allowed;
     }
     
     .success-message {
       display: none;
       text-align: center;
       padding: 40px 20px;
     }
     .success-message.show { display: block; }
     .success-icon {
       width: 80px;
       height: 80px;
       background: linear-gradient(135deg, #10b981 0%, #059669 100%);
       border-radius: 50%;
       display: flex;
       align-items: center;
       justify-content: center;
       margin: 0 auto 20px;
     }
     .success-icon svg { width: 40px; height: 40px; }
     .success-message h2 {
       color: #10b981;
       font-size: 24px;
       margin-bottom: 10px;
     }
     .success-message p {
       color: #64748b;
       font-size: 14px;
     }
     
     .form-container { display: block; }
     .form-container.hidden { display: none; }
     
     .footer {
       text-align: center;
       padding: 15px;
       background: #f8fafc;
       color: #64748b;
       font-size: 12px;
     }
   </style>
 </head>
 <body>
   <div class="container">
     <div class="header">
       <h1>🚗 توقيع بلاغ الحادث</h1>
       <div class="subtitle">ثقة للتأمين - وكالة تأمين معتمدة</div>
     </div>
     
     <div class="content">
       <div class="form-container" id="formContainer">
         <div class="info-card">
           <h3>📋 بيانات البلاغ</h3>
           <div class="info-row">
             <span class="info-label">رقم البلاغ:</span>
             <span class="info-value">${reportNumber}</span>
           </div>
           <div class="info-row">
             <span class="info-label">اسم العميل:</span>
             <span class="info-value">${clientName}</span>
           </div>
           <div class="info-row">
             <span class="info-label">رقم الهوية:</span>
             <span class="info-value">${clientIdNumber}</span>
           </div>
           <div class="info-row">
             <span class="info-label">السيارة:</span>
             <span class="info-value">${carInfo}</span>
           </div>
           <div class="info-row">
             <span class="info-label">تاريخ الحادث:</span>
             <span class="info-value">${accidentDate}</span>
           </div>
           <div class="info-row">
             <span class="info-label">موقع الحادث:</span>
             <span class="info-value">${accidentLocation}</span>
           </div>
           <div class="info-row">
             <span class="info-label">شركة التأمين:</span>
             <span class="info-value">${companyName}</span>
           </div>
           <div class="info-row">
             <span class="info-label">رقم الوثيقة:</span>
             <span class="info-value">${policyNumber}</span>
           </div>
         </div>
         
         <div class="declaration">
           <p>
             <strong>إقرار:</strong> أقر أنا الموقع أدناه بأن جميع المعلومات الواردة في هذا البلاغ صحيحة ودقيقة، 
             وأتحمل المسؤولية الكاملة عن صحة هذه البيانات. كما أوافق على استخدام هذه المعلومات 
             لأغراض معالجة مطالبة التأمين.
           </p>
         </div>
         
         <div class="signature-section">
           <h3>✍️ التوقيع هنا</h3>
           <div class="canvas-wrapper" id="canvasWrapper">
             <canvas id="signatureCanvas"></canvas>
             <div class="canvas-hint" id="canvasHint">ارسم توقيعك هنا</div>
           </div>
           
           <div class="btn-row">
             <button class="btn btn-clear" onclick="clearCanvas()">مسح</button>
             <button class="btn btn-submit" id="submitBtn" disabled onclick="submitSignature()">
               إرسال التوقيع
             </button>
           </div>
         </div>
       </div>
       
       <div class="success-message" id="successMessage">
         <div class="success-icon">
           <svg fill="white" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
         </div>
         <h2>تم التوقيع بنجاح!</h2>
         <p>شكراً لك. تم استلام توقيعك على بلاغ الحادث.</p>
       </div>
     </div>
     
     <div class="footer">
       © ثقة للتأمين - جميع الحقوق محفوظة
     </div>
   </div>
   
   <script>
     const canvas = document.getElementById('signatureCanvas');
     const ctx = canvas.getContext('2d');
     const wrapper = document.getElementById('canvasWrapper');
     const hint = document.getElementById('canvasHint');
     const submitBtn = document.getElementById('submitBtn');
     
     let isDrawing = false;
     let hasDrawn = false;
     
     function resizeCanvas() {
       const rect = canvas.getBoundingClientRect();
       canvas.width = rect.width * 2;
       canvas.height = rect.height * 2;
       ctx.scale(2, 2);
       ctx.strokeStyle = '#1e3a5f';
       ctx.lineWidth = 2;
       ctx.lineCap = 'round';
       ctx.lineJoin = 'round';
     }
     
     function getPos(e) {
       const rect = canvas.getBoundingClientRect();
       const touch = e.touches ? e.touches[0] : e;
       return {
         x: touch.clientX - rect.left,
         y: touch.clientY - rect.top
       };
     }
     
     function startDrawing(e) {
       e.preventDefault();
       isDrawing = true;
       wrapper.classList.add('active');
       hint.classList.add('hidden');
       const pos = getPos(e);
       ctx.beginPath();
       ctx.moveTo(pos.x, pos.y);
     }
     
     function draw(e) {
       if (!isDrawing) return;
       e.preventDefault();
       hasDrawn = true;
       submitBtn.disabled = false;
       const pos = getPos(e);
       ctx.lineTo(pos.x, pos.y);
       ctx.stroke();
     }
     
     function stopDrawing() {
       isDrawing = false;
       wrapper.classList.remove('active');
     }
     
     function clearCanvas() {
       ctx.clearRect(0, 0, canvas.width, canvas.height);
       hasDrawn = false;
       submitBtn.disabled = true;
       hint.classList.remove('hidden');
     }
     
     async function submitSignature() {
       if (!hasDrawn) return;
       
       submitBtn.disabled = true;
       submitBtn.textContent = 'جاري الإرسال...';
       
       try {
         const dataUrl = canvas.toDataURL('image/png');
         
         const response = await fetch('${supabaseUrl}/functions/v1/submit-accident-signature', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({
             token: '${token}',
             signature_data_url: dataUrl
           })
         });
         
         const result = await response.json();
         
         if (result.success) {
           document.getElementById('formContainer').classList.add('hidden');
           document.getElementById('successMessage').classList.add('show');
         } else {
           alert(result.message || result.error || 'حدث خطأ');
           submitBtn.disabled = false;
           submitBtn.textContent = 'إرسال التوقيع';
         }
       } catch (err) {
         console.error(err);
         alert('حدث خطأ في الاتصال');
         submitBtn.disabled = false;
         submitBtn.textContent = 'إرسال التوقيع';
       }
     }
     
     // Event listeners
     canvas.addEventListener('mousedown', startDrawing);
     canvas.addEventListener('mousemove', draw);
     canvas.addEventListener('mouseup', stopDrawing);
     canvas.addEventListener('mouseleave', stopDrawing);
     
     canvas.addEventListener('touchstart', startDrawing, { passive: false });
     canvas.addEventListener('touchmove', draw, { passive: false });
     canvas.addEventListener('touchend', stopDrawing);
     
     window.addEventListener('resize', resizeCanvas);
     resizeCanvas();
   </script>
 </body>
 </html>`;
 }