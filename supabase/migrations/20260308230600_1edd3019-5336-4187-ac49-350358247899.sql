ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS signature_header_html text DEFAULT '<h2>نموذج الموافقة على الخصوصية</h2>',
  ADD COLUMN IF NOT EXISTS signature_body_html text DEFAULT '<p>مرحباً.</p><p>أقرّ بأنني قرأت وفهمت سياسة الخصوصية، وأوافق على قيام الشركة بجمع واستخدام ومعالجة بياناتي الشخصية للأغراض المتعلقة بخدمات التأمين والتواصل وإتمام الإجراءات اللازمة.</p><p>بالتوقيع أدناه، أؤكد صحة البيانات وأمنح موافقتي على ما ورد أعلاه.</p>',
  ADD COLUMN IF NOT EXISTS signature_footer_html text DEFAULT '<p>جميع الحقوق محفوظة</p>',
  ADD COLUMN IF NOT EXISTS signature_primary_color text DEFAULT '#1e3a5f';