#!/bin/bash

# AB Insurance CRM - Supabase Setup Script
# سكربت إعداد Supabase لنظام AB Insurance CRM

echo "============================================"
echo "   AB Insurance CRM - Supabase Setup"
echo "   إعداد Supabase لنظام AB Insurance CRM"
echo "============================================"
echo ""

# Check if .env already exists
if [ -f ".env" ]; then
    echo "⚠️  ملف .env موجود بالفعل!"
    echo "⚠️  .env file already exists!"
    read -p "هل تريد الكتابة فوقه؟ (y/n): " overwrite
    if [ "$overwrite" != "y" ]; then
        echo "تم الإلغاء."
        exit 0
    fi
fi

echo ""
echo "📋 ستحتاج إلى المعلومات التالية من Supabase Dashboard:"
echo "   Settings → API"
echo ""

# Get Supabase URL
echo "1️⃣  أدخل Supabase Project URL:"
echo "   (مثال: https://abcdefghijk.supabase.co)"
read -p "   URL: " SUPABASE_URL

# Validate URL
if [[ ! $SUPABASE_URL =~ ^https://.*\.supabase\.co$ ]]; then
    echo "❌ الرابط غير صحيح! يجب أن يكون بصيغة: https://xxxxx.supabase.co"
    exit 1
fi

# Extract project ID from URL
PROJECT_ID=$(echo $SUPABASE_URL | sed 's|https://||' | sed 's|\.supabase\.co||')

echo ""
echo "2️⃣  أدخل Anon/Public Key:"
echo "   (المفتاح الطويل الذي يبدأ بـ eyJ...)"
read -p "   Key: " ANON_KEY

# Validate key
if [[ ! $ANON_KEY =~ ^eyJ ]]; then
    echo "❌ المفتاح غير صحيح! يجب أن يبدأ بـ eyJ..."
    exit 1
fi

echo ""
echo "📝 إنشاء ملف .env ..."

# Create .env file
cat > .env << EOF
# Supabase Configuration - AB Insurance CRM
# تم إنشاؤه بواسطة setup-supabase.sh

VITE_SUPABASE_URL=$SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY=$ANON_KEY
VITE_SUPABASE_PROJECT_ID=$PROJECT_ID
EOF

echo "✅ تم إنشاء ملف .env بنجاح!"
echo ""

# Ask about building
read -p "هل تريد بناء المشروع الآن؟ (y/n): " build_now

if [ "$build_now" == "y" ]; then
    echo ""
    echo "📦 تثبيت الحزم..."
    npm install
    
    echo ""
    echo "🔨 بناء المشروع..."
    npm run build
    
    if [ $? -eq 0 ]; then
        echo ""
        echo "============================================"
        echo "✅ تم بناء المشروع بنجاح!"
        echo "📁 الملفات جاهزة في مجلد: dist/"
        echo ""
        echo "الخطوة التالية:"
        echo "   1. ارفع محتويات مجلد dist/ إلى Plesk"
        echo "   2. تأكد من إعداد Error Document إلى index.html"
        echo "============================================"
    else
        echo "❌ فشل بناء المشروع!"
        exit 1
    fi
else
    echo ""
    echo "============================================"
    echo "✅ تم الإعداد بنجاح!"
    echo ""
    echo "الخطوات التالية:"
    echo "   1. npm install"
    echo "   2. npm run build"
    echo "   3. ارفع محتويات dist/ إلى Plesk"
    echo "============================================"
fi
