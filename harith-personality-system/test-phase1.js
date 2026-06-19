#!/usr/bin/env node
/**
 * اختبار تكامل المرحلة 1 — الرحلة الكاملة:
 *   1. تسجيل دخول المؤسس
 *   2. المؤسس يُنشئ دعوة اختبار لموظف
 *   3. الموظف يفتح الرابط
 *   4. الموظف يحلّ الاختبار
 *   5. المؤسس يطّلع على النتيجة
 *   6. المؤسس يمنح المدير صلاحية الاطلاع
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:3001';  // نستخدم منفذاً غير افتراضي
const DB_FILE = path.join(__dirname, 'database.sqlite');

let serverProcess = null;
let pass = 0, fail = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); pass++; }
  else { console.log(`  ❌ ${msg}`); fail++; }
}

// Cookie storage
let cookieJar = '';

async function req(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookieJar) headers['Cookie'] = cookieJar;

  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  // حفظ الكوكيز
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const sidMatch = setCookie.match(/connect\.sid=([^;]+)/);
    if (sidMatch) cookieJar = 'connect.sid=' + sidMatch[1];
  }

  let data;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function startServer() {
  // حذف DB قديمة لضمان بداية نظيفة
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);

  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', [path.join(__dirname, 'server', 'app.js')], {
      cwd: __dirname,
      env: { ...process.env, PORT: '3001' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let ready = false;
    let buffer = '';
    serverProcess.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes('الخادم يعمل على') && !ready) {
        ready = true;
        setTimeout(resolve, 500);
      }
    });
    serverProcess.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      if (!s.includes('[auth/login]') && !s.includes('[POST submit]')) {
        process.stderr.write('[SERVER] ' + s);
      }
    });
    setTimeout(() => { if (!ready) reject(new Error('timeout')); }, 10000);
  });
}

function stopServer() {
  if (serverProcess) { serverProcess.kill('SIGTERM'); serverProcess = null; }
}

// توليد إجابات DISC-D
function discAnswers() {
  const qs = require(path.join(__dirname, 'data', 'disc-questions.json')).questions;
  return qs.map(q => ({ id: q.id, answer: (q.style === 'D') ? 5 : 1 }));
}

async function main() {
  console.log('='.repeat(70));
  console.log('  اختبار المرحلة 1 — الرحلة الكاملة');
  console.log('='.repeat(70));

  console.log('\n▶ تشغيل الخادم...');
  await startServer();
  console.log('  الخادم يعمل على المنفذ 3001');

  try {
    // 1. فحص الصحّة
    console.log('\n──── 1. فحص الصحّة ────');
    const health = await req('GET', '/api/health');
    assert(health.status === 200, 'الخادم حيّ');

    // 2. تسجيل دخول برقم مرور خاطئ
    console.log('\n──── 2. رفض الدخول بكلمة مرور خاطئة ────');
    const badLogin = await req('POST', '/api/auth/login', {
      email: 'founder@harith-law.sa',
      password: 'wrong'
    });
    assert(badLogin.status === 401, 'رفض كلمة مرور خاطئة (401)');

    // 3. الوصول لمسار محمي بدون مصادقة
    console.log('\n──── 3. رفض الوصول بدون جلسة ────');
    cookieJar = ''; // مسح الكوكيز
    const noAuth = await req('GET', '/api/admin/invitations');
    assert(noAuth.status === 401, 'رفض الوصول للإدارة بدون جلسة (401)');

    // 4. تسجيل دخول المؤسس
    console.log('\n──── 4. تسجيل دخول المؤسس ────');
    const login = await req('POST', '/api/auth/login', {
      email: 'founder@harith-law.sa',
      password: 'Founder@2026'
    });
    assert(login.status === 200, 'الدخول ناجح (200)');
    assert(login.data.user.role === 'founder', 'الدور = founder');
    assert(cookieJar.length > 0, 'تمّ استلام كوكي الجلسة');

    // 5. /api/auth/me
    console.log('\n──── 5. قراءة المستخدم الحالي ────');
    const me = await req('GET', '/api/auth/me');
    assert(me.status === 200, 'قراءة me (200)');
    assert(me.data.user.email === 'founder@harith-law.sa', 'البريد صحيح');

    // 6. إنشاء دعوة اختبار
    console.log('\n──── 6. إنشاء دعوة اختبار DISC ────');
    const invCreate = await req('POST', '/api/admin/invitations', {
      candidate_name: 'أحمد محمد السبيعي',
      candidate_email: 'ahmed@example.com',
      candidate_phone: '0501234567',
      test_id: 'disc',
      allow_pause_resume: true
    });
    assert(invCreate.status === 200, 'إنشاء الدعوة (200)');
    assert(invCreate.data.invitation.token.length >= 30, 'الـ token طويل (≥30 حرف)');
    assert(invCreate.data.invitation.link.includes('/t/'), 'الرابط يحوي /t/');
    const token = invCreate.data.invitation.token;
    console.log(`    الرابط: ${invCreate.data.invitation.link}`);

    // 7. قائمة الدعوات
    console.log('\n──── 7. عرض قائمة الدعوات ────');
    const listInv = await req('GET', '/api/admin/invitations');
    assert(listInv.status === 200, 'جلب القائمة (200)');
    assert(listInv.data.invitations.length === 1, 'توجد دعوة واحدة');
    assert(listInv.data.invitations[0].status === 'pending', 'الحالة = pending');

    // ========== رحلة الموظف (بدون مصادقة) ==========

    // احفظ الكوكيز وأمسحها مؤقتاً لمحاكاة موظف جديد
    const savedCookies = cookieJar;
    cookieJar = '';

    // 8. الموظف يفتح الرابط
    console.log('\n──── 8. الموظف يفتح الرابط (info) ────');
    const info = await req('GET', `/api/take/${token}/info`);
    assert(info.status === 200, 'جلب معلومات الاختبار (200)');
    assert(info.data.candidate_name === 'أحمد محمد السبيعي', 'اسم المرشّح');
    assert(info.data.test_id === 'disc', 'نوع الاختبار');
    assert(info.data.allow_pause_resume === true, 'السماح بالإيقاف مفعّل');

    // 9. الموظف يجلب الأسئلة
    console.log('\n──── 9. الموظف يجلب الأسئلة ────');
    const qs = await req('GET', `/api/take/${token}/questions`);
    assert(qs.status === 200, 'جلب الأسئلة (200)');
    assert(qs.data.questions.length === 32, 'عدد أسئلة DISC = 32');
    assert(!('style' in qs.data.questions[0]), 'لا يظهر الحقل style');

    // 10. حفظ جزئي
    console.log('\n──── 10. حفظ تقدّم جزئي ────');
    const save = await req('POST', `/api/take/${token}/save`, {
      answers: { '1': 5, '2': 5 },
      current_index: 2
    });
    assert(save.status === 200, 'الحفظ ناجح (200)');

    // 11. إعادة تحميل الأسئلة — يجب أن يظهر التقدّم المحفوظ
    console.log('\n──── 11. استرجاع التقدّم المحفوظ ────');
    const qs2 = await req('GET', `/api/take/${token}/questions`);
    assert(qs2.status === 200, 'الجلب الثاني (200)');
    assert(qs2.data.saved_progress !== null, 'يوجد تقدّم محفوظ');
    assert(qs2.data.saved_progress.current_index === 2, 'current_index = 2');

    // 12. تسليم نهائي
    console.log('\n──── 12. تسليم الإجابات النهائية ────');
    const submit = await req('POST', `/api/take/${token}/submit`, {
      answers: discAnswers()
    });
    assert(submit.status === 200, 'التسليم ناجح (200)');
    assert(submit.data.success === true, 'success = true');
    assert(submit.data.short_result.primary_style === 'D', 'النتيجة = D');
    assert(submit.data.short_result.top_strengths.length > 0, 'نقاط القوة موجودة');

    // 13. محاولة التسليم مرّة ثانية — يجب أن تُرفَض
    console.log('\n──── 13. منع إعادة التسليم ────');
    const submit2 = await req('POST', `/api/take/${token}/submit`, {
      answers: discAnswers()
    });
    assert(submit2.status === 400, 'رفض إعادة التسليم (400)');
    assert(submit2.data.error.includes('إكمال'), 'رسالة تذكر "إكمال"');

    // 14. استعادة جلسة المؤسس ورؤية النتيجة
    cookieJar = savedCookies;
    console.log('\n──── 14. المؤسس يعرض قائمة النتائج ────');
    const results = await req('GET', '/api/admin/results');
    assert(results.status === 200, 'جلب النتائج (200)');
    assert(results.data.results.length === 1, 'توجد نتيجة واحدة');
    assert(results.data.results[0].test_id === 'disc', 'نوع الاختبار');
    const resultId = results.data.results[0].id;

    // 15. المؤسس يفتح النتيجة الكاملة
    console.log('\n──── 15. المؤسس يفتح النتيجة الكاملة ────');
    const fullRes = await req('GET', `/api/admin/results/${resultId}`);
    assert(fullRes.status === 200, 'جلب النتيجة الكاملة (200)');
    assert(fullRes.data.candidate_name === 'أحمد محمد السبيعي', 'اسم المرشّح');
    assert(fullRes.data.data.primary_style === 'D', 'النتيجة = D');
    assert(fullRes.data.data.primary_profile.style_name_ar, 'التفسير الكامل موجود');

    // 16. قائمة المستخدمين
    console.log('\n──── 16. قائمة المستخدمين للمنح ────');
    const users = await req('GET', '/api/admin/users');
    assert(users.status === 200, 'جلب المستخدمين (200)');
    assert(users.data.users.length === 2, 'يوجد مستخدمان');
    const adminUser = users.data.users.find(u => u.role === 'admin');
    assert(!!adminUser, 'المستخدم admin موجود');

    // 17. المؤسس يمنح المدير صلاحية الاطلاع
    console.log('\n──── 17. منح المدير صلاحية الاطلاع ────');
    const grant = await req('POST', `/api/admin/results/${resultId}/grant`, {
      user_id: adminUser.id,
      notes: 'للاطلاع والمقارنة'
    });
    assert(grant.status === 200, 'المنح ناجح (200)');

    // 18. منح مكرّر — يُرفَض
    const grant2 = await req('POST', `/api/admin/results/${resultId}/grant`, {
      user_id: adminUser.id
    });
    assert(grant2.status === 400, 'رفض المنح المكرّر (400)');

    // ========== اختبار صلاحيات المدير ==========

    // 19. تسجيل خروج المؤسس ودخول المدير
    console.log('\n──── 19. تبديل الجلسة للمدير ────');
    await req('POST', '/api/auth/logout');
    cookieJar = '';
    const adminLogin = await req('POST', '/api/auth/login', {
      email: 'admin@harith-law.sa',
      password: 'Admin@2026'
    });
    assert(adminLogin.status === 200, 'دخول المدير (200)');
    assert(adminLogin.data.user.role === 'admin', 'الدور = admin');

    // 20. المدير يرى النتيجة الممنوحة
    console.log('\n──── 20. المدير يرى النتيجة (بصلاحية ممنوحة) ────');
    const adminResults = await req('GET', '/api/admin/results');
    assert(adminResults.status === 200, 'جلب النتائج (200)');
    assert(adminResults.data.results.length === 1, 'المدير يرى النتيجة الممنوحة');

    const adminFullRes = await req('GET', `/api/admin/results/${resultId}`);
    assert(adminFullRes.status === 200, 'المدير يفتح النتيجة (200)');

    // 21. تغيير كلمة المرور
    console.log('\n──── 21. المدير يُغيّر كلمة مروره ────');
    const changePass = await req('POST', '/api/auth/change-password', {
      current_password: 'Admin@2026',
      new_password: 'NewPass@123'
    });
    assert(changePass.status === 200, 'تغيير كلمة المرور (200)');

    // 22. تسجيل خروج + محاولة دخول بالقديمة
    await req('POST', '/api/auth/logout');
    cookieJar = '';
    const badLogin2 = await req('POST', '/api/auth/login', {
      email: 'admin@harith-law.sa',
      password: 'Admin@2026'  // القديمة
    });
    assert(badLogin2.status === 401, 'كلمة المرور القديمة لم تعد تعمل');

    const goodLogin = await req('POST', '/api/auth/login', {
      email: 'admin@harith-law.sa',
      password: 'NewPass@123'  // الجديدة
    });
    assert(goodLogin.status === 200, 'كلمة المرور الجديدة تعمل');

    // 23. رابط منتهٍ (غير موجود)
    console.log('\n──── 23. معالجة رابط غير موجود ────');
    cookieJar = '';
    const invalidToken = await req('GET', '/api/take/xxx/info');
    assert(invalidToken.status === 400, 'رفض token غير موجود');

    // 24. كلمة مرور جديدة قصيرة
    console.log('\n──── 24. رفض كلمة مرور جديدة قصيرة ────');
    // نحتاج الدخول أولاً
    const login2 = await req('POST', '/api/auth/login', {
      email: 'admin@harith-law.sa',
      password: 'NewPass@123'
    });
    const shortPass = await req('POST', '/api/auth/change-password', {
      current_password: 'NewPass@123',
      new_password: '123'
    });
    assert(shortPass.status === 400, 'رفض كلمة مرور قصيرة');

  } finally {
    stopServer();
    // تنظيف DB
    if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  }

  console.log('\n' + '='.repeat(70));
  console.log(`  الخلاصة: ✅ ${pass} ناجح   ❌ ${fail} فاشل`);
  console.log('='.repeat(70));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('خطأ:', err);
  stopServer();
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  process.exit(1);
});
