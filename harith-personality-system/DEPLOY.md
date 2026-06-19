# دليل النشر على Render

نظام تحليل شخصية الموظفين — الحارث السحيباني محامون ومستشارون

> النظام موجود في مجلد فرعي (`harith-personality-system/`) داخل مستودع
> `World-Cup`. سيُنشَر كـ **خدمة Web مستقلة** لا تمسّ موقع كأس العالم الثابت
> القائم في نفس المستودع.

---

## الطريقة الموصى بها: إنشاء Web Service يدوياً

1. في Render: **New → Web Service**.
2. اختر مستودع **`sshat2077/World-Cup`** والفرع **`main`**.
3. اضبط الإعدادات التالية:

   | الحقل | القيمة |
   |------|--------|
   | **Name** | `harith-personality-system` |
   | **Root Directory** | `harith-personality-system` |
   | **Runtime** | `Node` |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Health Check Path** | `/api/health` |
   | **Region** | `Frankfurt` (الأقرب للسعودية) |
   | **Instance Type** | `Starter` أو أعلى (مطلوب لاستخدام القرص الدائم) |

4. **أضف قرصاً دائماً (Disk)** — مهم لحفظ قاعدة البيانات:
   - **Name:** `harith-data`
   - **Mount Path:** `/var/data`
   - **Size:** `1 GB`

5. **متغيّرات البيئة (Environment):**

   | المفتاح | القيمة |
   |--------|--------|
   | `NODE_ENV` | `production` |
   | `DATABASE_PATH` | `/var/data/database.sqlite` |
   | `SESSION_SECRET` | اضغط **Generate** ليولّد Render قيمة عشوائية ثابتة |

6. **Create Web Service** — سيبدأ البناء والنشر.

---

## بعد النشر

- الرابط سيكون مثل: `https://harith-personality-system.onrender.com`
- افتح `/` للصفحة الرئيسية، و`/admin` للوحة الإدارة.
- بيانات الدخول الافتراضية (موجودة في seed قاعدة البيانات):
  - المؤسس: `founder@harith-law.sa` / `Founder@2026`
  - المدير: `admin@harith-law.sa` / `Admin@2026`
- **أول خطوة بعد الدخول: غيّر كلمتي المرور** (اللوحة تذكّرك بذلك تلقائياً).

---

## ملاحظات مهمّة

- **لماذا قرص دائم؟** قاعدة البيانات ملف SQLite. بدون قرص دائم تُفقَد كل
  البيانات (المستخدمون، الدعوات، النتائج) عند كل إعادة نشر أو إعادة تشغيل.
- **موقع كأس العالم** في نفس المستودع لن يتأثّر — هذه خدمة منفصلة بجذر مختلف.
- **الخطة المجانية لا تكفي**: لا تدعم القرص الدائم، وتُوقِف الخدمة عند الخمول.
- لتغيير المنطقة أو الحجم لاحقاً: من إعدادات الخدمة في Render.

---

## بديل: استخدام render.yaml كـ Blueprint

ملف `render.yaml` المرفق يحوي نفس الإعدادات. لاستخدامه كـ Blueprint يجب
نقله إلى **جذر المستودع** (لأن Render يقرأ Blueprints من الجذر فقط)، مع
إبقاء `rootDir: harith-personality-system`. الطريقة اليدوية أعلاه أبسط
وأقل تعارضاً مع موقع كأس العالم القائم.
