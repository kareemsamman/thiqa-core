# AB Insurance CRM - Accounting Ledger Specification

## نظام الدفتر المحاسبي الموحد (ab_ledger)

### المبدأ الأساسي
```
outstanding = -SUM(amount) for all posted entries
```

كل القيود تتبع اتفاقية إشارات موحدة:
- **سالب (-)**: التزام علينا (نحن مدينون)
- **موجب (+)**: حق لنا (مستحق لنا)

---

## أنواع القيود (Categories)

### 1. قيود شركات التأمين (insurance_company)

| Category | الوصف | الإشارة | متى يُنشأ | يدخل في Wallet؟ |
|----------|-------|---------|-----------|-----------------|
| `company_payable` | مستحق لشركة التأمين | - | عند إنشاء بوليصة | ✅ نعم |
| `company_payable_reversal` | عكس المستحق (إلغاء) | + | عند إلغاء بوليصة | ✅ نعم |
| `commission_expense` | تكلفة عمولة الإلزامي | - | عند إنشاء بوليصة ELZAMI | ❌ لا (منفصل) |
| `company_settlement_paid` | تسديد للشركة | + | عند دفع للشركة | ✅ نعم |
| `company_settlement_reversal` | عكس التسديد (رفض) | - | عند رفض دفعة | ✅ نعم |

**حساب رصيد الشركة (Wallet):**
```sql
-- فقط القيود التالية تدخل في حساب outstanding:
-- company_payable, company_payable_reversal, company_settlement_paid, company_settlement_reversal

outstanding = -SUM(amount) WHERE category IN (wallet_categories) AND status = 'posted'
total_paid = SUM(settlement_paid + settlement_reversal) WHERE status = 'posted'

-- تكلفة الإلزامي منفصلة:
elzami_costs = -SUM(amount) WHERE category = 'commission_expense' AND status = 'posted'
```

### 2. قيود الوسطاء (broker)

| Category | الوصف | الإشارة | متى يُنشأ |
|----------|-------|---------|-----------|
| `broker_payable` | مستحق للوسيط (from_broker) | - | بوليصة الوسيط أحضرها |
| `broker_receivable` | مستحق من الوسيط (to_broker) | + | بوليصة صنعناها للوسيط |
| `broker_settlement_paid` | دفعنا للوسيط | + | تسوية we_owe |
| `broker_settlement_received` | استلمنا من الوسيط | + | تسوية broker_owes |

**حساب رصيد الوسيط:**
```sql
net = SUM(amount) WHERE status = 'posted'
-- موجب = الوسيط مدين لنا
-- سالب = نحن مدينون للوسيط
```

### 3. قيود العملاء (customer)

| Category | الوصف | الإشارة | متى يُنشأ |
|----------|-------|---------|-----------|
| `refund_payable` | مرتجع مستحق للعميل | - | إلغاء/تحويل بوليصة |
| `receivable_collected` | دفعة مستلمة | + | استلام دفعة (للمتابعة فقط) |

---

## Triggers

### عند إنشاء بوليصة (ledger_on_policy_created)
1. `company_payable = -payed_for_company` (إذا > 0)
2. `commission_expense = -elzami_commission` (إذا ELZAMI)
3. `broker_payable = -profit` أو `broker_receivable = +profit` (حسب الاتجاه)

### عند إلغاء بوليصة (ledger_on_policy_cancelled)
1. القيود الأصلية (`policy_created`) → status = `reversed`
2. قيود عكسية جديدة (`policy_cancelled`) → status = `posted`
3. `company_payable_reversal = +payed_for_company`

### عند تسديد شركة (ledger_on_company_settlement)
- `company_settlement_paid = +total_amount`

### عند رفض تسديد (ledger_on_company_settlement_refused)
- `company_settlement_reversal = -total_amount`
- **لا** نغير القيد الأصلي لـ reversed، نضيف قيد عكسي فقط

### عند مرتجع عميل (ledger_on_customer_refund)
- `refund_payable = -amount`

---

## السيناريوهات المختبرة ✅

### السيناريو 1: Company Settlement + Refusal
```
قبل التسديد:  outstanding = 415,042
بعد تسديد 500: outstanding = 414,542, paid = 500
بعد الرفض:    outstanding = 415,042, paid = 0
```
**النتيجة:** ✅ نجح

### السيناريو 2: ELZAMI Policy
```
البوليصة: price=1490, payed_for_company=1490
القيود المتوقعة:
  - company_payable = -1490
  - commission_expense = -100
Company outstanding زاد: +1590
```
**النتيجة:** ✅ نجح

### السيناريو 3: Policy Cancellation + Refund
```
البوليصة: price=1200, payed_for_company=900
قبل الإلغاء:
  - company_payable = -900 (posted)
بعد الإلغاء:
  - company_payable = -900 (reversed)
  - company_payable_reversal = +900 (posted)
بعد المرتجع:
  - refund_payable = -300 (posted)
صافي البوليصة على الشركة = 0
عدد القيود = 3 (بدون تكرار)
```
**النتيجة:** ✅ نجح

---

## ملاحظات مهمة

1. **لا تستخدم هذه الفئات (محذوفة):**
   - `premium_income`
   - `profit_share`
   - `receivable_collected` (للمتابعة فقط، لا تدخل في Wallet)

2. **فقط `status = 'posted'` تُحسب** في كل التقارير

3. **عند الرفض:** لا تغير القيد الأصلي لـ reversed، أضف قيد عكسي فقط

4. **الصيغة الذهبية:**
   ```
   outstanding = -SUM(amount) WHERE status = 'posted'
   ```

---

## تقرير الأرصدة النهائي

| النوع | العدد | المستحق | المدفوع | المتبقي |
|-------|-------|---------|---------|---------|
| شركات التأمين | 18 | ₪2,678,708 | ₪1,500 | ₪2,726,008 |
| الوسطاء (لنا) | 6 | ₪77,525 | - | صافي: ₪73,529 |
| مرتجعات العملاء | 2 | - | - | ₪1,800 |

**آخر تحديث:** 2025-12-31
