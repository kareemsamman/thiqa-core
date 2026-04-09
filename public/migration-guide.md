# دليل نقل AB Insurance CRM إلى Supabase خارجي

## 📋 الفهرس

1. [المتطلبات](#المتطلبات)
2. [إنشاء مشروع Supabase](#الخطوة-1-إنشاء-مشروع-supabase-جديد)
3. [تشغيل migration.sql](#الخطوة-2-تشغيل-migrationsql)
4. [إعداد Google OAuth](#الخطوة-3-إعداد-google-oauth)
5. [تصدير البيانات](#الخطوة-4-تصدير-البيانات)
6. [نسخ API Keys](#الخطوة-5-نسخ-api-keys)
7. [تحديث الكود](#الخطوة-6-تحديث-الكود)
8. [استيراد البيانات](#الخطوة-7-استيراد-البيانات)
9. [نشر Edge Functions](#الخطوة-8-نشر-edge-functions)
10. [بناء ونشر على Plesk](#الخطوة-9-بناء-ونشر-على-plesk)
11. [إعداد الدومين](#الخطوة-10-إعداد-الدومين)
12. [استكشاف الأخطاء](#استكشاف-الأخطاء)

---

## المتطلبات

قبل البدء، تأكد من توفر:

| المتطلب | الوصف |
|---------|-------|
| حساب Supabase | [supabase.com](https://supabase.com) - مجاني |
| Node.js | الإصدار 18 أو أحدث |
| Git | لإدارة الكود |
| Supabase CLI | لنشر Edge Functions |
| Plesk | مع دعم Static Hosting |

### تثبيت المتطلبات

```bash
# تثبيت Node.js (إذا لم يكن مثبت)
# https://nodejs.org/

# تثبيت Supabase CLI
npm install -g supabase

# التحقق من التثبيت
supabase --version
node --version
```

---

## الخطوة 1: إنشاء مشروع Supabase جديد

### 1.1 إنشاء حساب

1. اذهب إلى [supabase.com](https://supabase.com)
2. اضغط **"Start your project"**
3. سجّل دخول بـ GitHub أو Email

### 1.2 إنشاء مشروع جديد

1. اضغط **"New project"**
2. املأ البيانات:

| الحقل | القيمة |
|-------|--------|
| **Name** | `ab-insurance-crm` |
| **Database Password** | كلمة مرور قوية (احفظها!) |
| **Region** | اختر الأقرب (مثل: Frankfurt) |

3. اضغط **"Create new project"**
4. ⏳ انتظر 2-3 دقائق حتى يتم إنشاء المشروع

---

## الخطوة 2: تشغيل migration.sql

### 2.1 فتح SQL Editor

1. في Supabase Dashboard → **SQL Editor**
2. اضغط **"New query"**

### 2.2 تشغيل Schema

1. افتح ملف `migration.sql` (يمكن تحميله من صفحة النقل)
2. انسخ **كل** المحتوى
3. الصق في SQL Editor
4. اضغط **"Run"** (أو Ctrl+Enter)

### 2.3 التحقق

تأكد من:
- ✅ لا توجد أخطاء حمراء
- ✅ رسالة "Success" ظهرت
- ✅ الجداول ظهرت في Table Editor

---

## الخطوة 3: إعداد Google OAuth

### 3.1 إنشاء OAuth Client في Google

1. اذهب إلى [Google Cloud Console](https://console.cloud.google.com)
2. أنشئ مشروع جديد أو اختر مشروع قائم
3. APIs & Services → **Credentials**
4. **Create Credentials** → **OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Name: `AB Insurance CRM`

### 3.2 إضافة Redirect URI

أضف هذا الرابط في **Authorized redirect URIs**:

```
https://YOUR-PROJECT-ID.supabase.co/auth/v1/callback
```

> 💡 استبدل `YOUR-PROJECT-ID` بمعرف مشروعك الفعلي

### 3.3 تفعيل Google في Supabase

1. Supabase Dashboard → **Authentication** → **Providers**
2. فعّل **Google**
3. أدخل:
   - **Client ID**: من Google Cloud Console
   - **Client Secret**: من Google Cloud Console
4. اضغط **Save**

---

## الخطوة 4: تصدير البيانات

### من صفحة نقل قاعدة البيانات في Lovable:

1. اذهب إلى `/admin/database-migration`
2. تبويب **"تصدير البيانات"**
3. اضغط **"تصدير كل البيانات"**
4. احفظ ملف JSON

### الملفات المطلوب تحميلها:

| الملف | الوصف |
|-------|-------|
| `ab-insurance-backup-YYYY-MM-DD.json` | كل البيانات |
| `media-links-YYYY-MM-DD.json` | روابط الصور (اختياري) |

---

## الخطوة 5: نسخ API Keys

### 5.1 الحصول على المفاتيح

من Supabase Dashboard → **Settings** → **API**:

| المفتاح | الموقع | الاستخدام |
|---------|--------|----------|
| **Project URL** | أعلى الصفحة | `VITE_SUPABASE_URL` |
| **anon/public** | تحت API Keys | `VITE_SUPABASE_PUBLISHABLE_KEY` |
| **service_role** | تحت API Keys | للـ Edge Functions فقط |

### 5.2 مثال

```env
VITE_SUPABASE_URL=https://abcdefghijk.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_SUPABASE_PROJECT_ID=abcdefghijk
```

---

## الخطوة 6: تحديث الكود

### الطريقة 1: استخدام السكربت (الأسهل)

```bash
# تحميل السكربت
# من صفحة النقل → تحميل setup-supabase.sh

# تشغيل السكربت
chmod +x setup-supabase.sh
./setup-supabase.sh
```

### الطريقة 2: يدوياً

1. أنشئ ملف `.env` في جذر المشروع:

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT-ID.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_ANON_KEY
VITE_SUPABASE_PROJECT_ID=YOUR_PROJECT_ID
```

2. استبدل القيم بمعلومات مشروعك

---

## الخطوة 7: استيراد البيانات

### 7.1 بناء المشروع محلياً

```bash
npm install
npm run build
```

### 7.2 تشغيل محلياً (للاختبار)

```bash
npm run dev
```

### 7.3 استيراد البيانات

1. اذهب إلى `http://localhost:5173/admin/database-migration`
2. تبويب **"استيراد البيانات"**
3. ارفع ملف JSON المصدّر
4. انتظر انتهاء الاستيراد

---

## الخطوة 8: نشر Edge Functions

### 8.1 تسجيل الدخول

```bash
supabase login
```

سيفتح المتصفح للتسجيل.

### 8.2 ربط المشروع

```bash
supabase link --project-ref YOUR_PROJECT_ID
```

### 8.3 إعداد Secrets

```bash
# Bunny CDN
supabase secrets set BUNNY_API_KEY=your-bunny-api-key
supabase secrets set BUNNY_STORAGE_ZONE=your-storage-zone
supabase secrets set BUNNY_CDN_URL=https://your-cdn.b-cdn.net

# Service Role (اختياري - للـ functions التي تحتاجه)
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 8.4 نشر الـ Functions

```bash
supabase functions deploy
```

### 8.5 قائمة الـ Edge Functions

| Function | الوصف |
|----------|-------|
| `check-expiring-policies` | فحص الوثائق المنتهية |
| `delete-media` | حذف الوسائط |
| `fetch-car-price` | جلب سعر السيارة |
| `fetch-vehicle` | جلب بيانات المركبة |
| `generate-invoice-pdf` | إنشاء فاتورة PDF |
| `generate-invoices` | إنشاء الفواتير |
| `generate-pdf` | إنشاء PDF |
| `get-signature-info` | معلومات التوقيع |
| `payment-result` | نتيجة الدفع |
| `send-invoice-sms` | إرسال SMS فاتورة |
| `send-signature-sms` | إرسال SMS توقيع |
| `send-sms` | إرسال SMS |
| `signature-page` | صفحة التوقيع |
| `submit-signature` | تقديم التوقيع |
| `tranzila-init` | بدء Tranzila |
| `tranzila-status` | حالة Tranzila |
| `tranzila-webhook` | Webhook لـ Tranzila |
| `upload-media` | رفع الوسائط |
| `wordpress-import` | استيراد من WordPress |

---

## الخطوة 9: بناء ونشر على Plesk

### 9.1 بناء المشروع

```bash
npm install
npm run build
```

### 9.2 رفع إلى Plesk

1. اضغط الملفات في مجلد `dist/`:
   ```bash
   cd dist
   zip -r ../ab-insurance-dist.zip .
   ```

2. في Plesk:
   - اذهب إلى **File Manager**
   - افتح `public_html` أو `httpdocs`
   - ارفع محتويات `dist/` (أو فك ضغط zip)

### 9.3 إعداد SPA Routing

أنشئ ملف `.htaccess` في `public_html`:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```

---

## الخطوة 10: إعداد الدومين

### إعداد SSL

1. في Plesk → **Websites & Domains**
2. اختر الدومين
3. **SSL/TLS Certificates** → **Get it free** (Let's Encrypt)

### تحديث Google OAuth

بعد ربط الدومين، أضف Redirect URI جديد:

```
https://yourdomain.com/auth/callback
```

---

## ملاحظات مهمة

### ✅ الصور على Bunny CDN

- الصور ستبقى تعمل بنفس الروابط
- لا تحتاج نقل الصور
- تأكد من إعداد CORS في Bunny

### ⚠️ المستخدمين

- المستخدمون يحتاجون تسجيل دخول جديد
- `morshed500@gmail.com` سيكون Admin تلقائياً
- باقي المستخدمين سيكونون `pending`

### 📊 حدود Supabase المجاني

| الموارد | الحد |
|---------|------|
| Database | 500MB |
| File Storage | 1GB |
| Bandwidth | 2GB/شهر |
| Edge Function Invocations | 500K/شهر |
| Monthly Active Users | 50,000 |

---

## استكشاف الأخطاء

### ❌ خطأ "Invalid API key"

**السبب**: مفتاح API غير صحيح

**الحل**:
1. تحقق من `.env`
2. تأكد من نسخ المفتاح كاملاً
3. أعد بناء المشروع: `npm run build`

### ❌ خطأ RLS

**السبب**: صلاحيات غير كافية

**الحل**:
1. تأكد من تسجيل الدخول
2. تأكد من أن المستخدم `active`
3. تأكد من وجود `role` للمستخدم

### ❌ Edge Function لا تعمل

**الحل**:
1. تحقق من Secrets:
   ```bash
   supabase secrets list
   ```
2. راجع Logs:
   ```bash
   supabase functions logs FUNCTION_NAME
   ```

### ❌ الصور لا تظهر

**الحل**:
1. تأكد من أن Bunny CDN يعمل
2. تحقق من CORS في Bunny:
   - Access Control → Allow Origin: `*`

### ❌ 404 عند تحديث الصفحة

**الحل**: أضف `.htaccess` كما في الخطوة 9.3

---

## 📞 الدعم

إذا واجهت مشاكل:

1. راجع Console في المتصفح (F12)
2. راجع Supabase Logs
3. تحقق من إعدادات `.env`
4. تأكد من تشغيل `migration.sql` بالكامل
