#!/usr/bin/env node
/**
 * اختبار تكامل شامل (End-to-End) عبر HTTP
 * يُشغّل الخادم، يُرسل طلبات لكل الاختبارات الثلاثة، ويُتحقّق من المخرجات.
 */

const { spawn } = require('child_process');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
let serverProcess = null;
let pass = 0, fail = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); pass++; }
  else { console.log(`  ❌ ${msg}`); fail++; }
}

async function request(method, url, body) {
  const res = await fetch(BASE_URL + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', [path.join(__dirname, 'server', 'app.js')], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let ready = false;
    serverProcess.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('الخادم يعمل على') && !ready) {
        ready = true;
        setTimeout(resolve, 300); // ريثما يستقرّ
      }
    });
    serverProcess.stderr.on('data', (chunk) => {
      console.error('[SERVER ERR]', chunk.toString());
    });
    serverProcess.on('error', reject);
    setTimeout(() => { if (!ready) reject(new Error('Server startup timeout')); }, 5000);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

// توليد إجابات لنمط معيّن حسب الاختبار
function generateAnswers(testId, targetProfile) {
  if (testId === 'mbti') {
    // MBTI: targetProfile = { type: "INTJ" }
    const qs = require(path.join(__dirname, 'data', 'mbti-questions.json')).questions;
    const axes = require(path.join(__dirname, 'data', 'mbti-questions.json')).axes;
    const [ei, sn, tf, jp] = targetProfile.type.split('');
    const targets = { EI: ei, SN: sn, TF: tf, JP: jp };
    return qs.map(q => {
      const wantPositive = (targets[q.axis] === axes[q.axis].positive);
      const answer = ((wantPositive && q.direction === '+') || (!wantPositive && q.direction === '-')) ? 5 : 1;
      return { id: q.id, answer };
    });
  }
  if (testId === 'disc') {
    // DISC: targetProfile = { style: "D" }
    const qs = require(path.join(__dirname, 'data', 'disc-questions.json')).questions;
    return qs.map(q => ({ id: q.id, answer: (q.style === targetProfile.style) ? 5 : 1 }));
  }
  if (testId === 'bigfive') {
    // BigFive: targetProfile = { levels: {O:'high', C:'high',...} }
    const qs = require(path.join(__dirname, 'data', 'bigfive-questions.json')).questions;
    return qs.map(q => {
      const level = targetProfile.levels[q.dimension];
      let ans;
      if (level === 'high') ans = q.direction === '+' ? 5 : 1;
      else if (level === 'low') ans = q.direction === '+' ? 1 : 5;
      else ans = 3;
      return { id: q.id, answer: ans };
    });
  }
}

async function main() {
  console.log('='.repeat(65));
  console.log('  اختبار تكامل HTTP End-to-End');
  console.log('='.repeat(65));

  console.log('\n▶ تشغيل الخادم...');
  await startServer();
  console.log('  الخادم يعمل.');

  try {
    // 1. فحص الصحّة
    console.log('\n──── 1. فحص /api/health ────');
    const health = await request('GET', '/api/health');
    assert(health.status === 200, 'الحالة 200');
    assert(health.data.status === 'ok', 'الحالة = ok');

    // 2. قائمة الاختبارات
    console.log('\n──── 2. فحص /api/tests ────');
    const tests = await request('GET', '/api/tests');
    assert(tests.status === 200, 'الحالة 200');
    assert(tests.data.tests.length === 3, 'ثلاثة اختبارات متاحة');
    const testIds = tests.data.tests.map(t => t.test_id).sort();
    assert(JSON.stringify(testIds) === JSON.stringify(['bigfive', 'disc', 'mbti']), 'المعرّفات صحيحة');

    // 3. MBTI: كامل دورة
    console.log('\n──── 3. دورة كاملة MBTI (نمط INTJ) ────');
    const mbtiQs = await request('GET', '/api/test/mbti/questions');
    assert(mbtiQs.status === 200, 'تحميل الأسئلة: 200');
    assert(mbtiQs.data.total_questions === 70, 'عدد الأسئلة = 70');
    assert(!('axis' in mbtiQs.data.questions[0]), 'لا يظهر الحقل axis في الأسئلة العامة');
    assert(!('direction' in mbtiQs.data.questions[0]), 'لا يظهر الحقل direction');

    const mbtiAns = generateAnswers('mbti', { type: 'INTJ' });
    const mbtiResult = await request('POST', '/api/test/mbti/submit', { answers: mbtiAns });
    assert(mbtiResult.status === 200, 'التسليم: 200');
    assert(mbtiResult.data.type_code === 'INTJ', `النمط = INTJ (حصل: ${mbtiResult.data.type_code})`);

    // 4. DISC: كامل دورة
    console.log('\n──── 4. دورة كاملة DISC (نمط D) ────');
    const discQs = await request('GET', '/api/test/disc/questions');
    assert(discQs.status === 200, 'تحميل الأسئلة: 200');
    assert(discQs.data.total_questions === 32, 'عدد الأسئلة = 32');
    assert(!('style' in discQs.data.questions[0]), 'لا يظهر الحقل style');

    const discAns = generateAnswers('disc', { style: 'D' });
    const discResult = await request('POST', '/api/test/disc/submit', { answers: discAns });
    assert(discResult.status === 200, 'التسليم: 200');
    assert(discResult.data.primary_style === 'D', `النمط الأساسي = D (حصل: ${discResult.data.primary_style})`);

    // 5. Big Five: كامل دورة
    console.log('\n──── 5. دورة كاملة Big Five (محامٍ مثالي) ────');
    const bfQs = await request('GET', '/api/test/bigfive/questions');
    assert(bfQs.status === 200, 'تحميل الأسئلة: 200');
    assert(bfQs.data.total_questions === 60, 'عدد الأسئلة = 60');
    assert(!('dimension' in bfQs.data.questions[0]), 'لا يظهر الحقل dimension');

    const bfAns = generateAnswers('bigfive', { levels: { O: 'high', C: 'high', E: 'high', A: 'high', N: 'low' }});
    const bfResult = await request('POST', '/api/test/bigfive/submit', { answers: bfAns });
    assert(bfResult.status === 200, 'التسليم: 200');
    assert(bfResult.data.profile_code === 'O-hi_C-hi_E-hi_A-hi_N-lo',
      `كود الملف = O-hi_C-hi_E-hi_A-hi_N-lo (حصل: ${bfResult.data.profile_code})`);

    // 6. معالجة الأخطاء
    console.log('\n──── 6. معالجة الأخطاء ────');
    const notFound = await request('GET', '/api/test/nonexistent/questions');
    assert(notFound.status === 404, '404 لاختبار غير موجود');

    const badSubmit = await request('POST', '/api/test/disc/submit', { answers: [{ id: 1, answer: 5 }] });
    assert(badSubmit.status === 400, '400 لإجابات ناقصة');
    assert(badSubmit.data.error && badSubmit.data.error.includes('32'), 'رسالة الخطأ تذكر 32');

    const missingAnswers = await request('POST', '/api/test/disc/submit', {});
    assert(missingAnswers.status === 400, '400 عند غياب answers');

    // 7. الأداء
    console.log('\n──── 7. فحص الأداء (استجابة سريعة) ────');
    const start = Date.now();
    await request('POST', '/api/test/mbti/submit', { answers: mbtiAns });
    const duration = Date.now() - start;
    console.log(`  وقت حساب MBTI: ${duration}ms`);
    assert(duration < 200, 'استجابة أقل من 200ms');

  } finally {
    stopServer();
  }

  console.log('\n' + '='.repeat(65));
  console.log(`  خلاصة: ✅ نجح ${pass}   ❌ فشل ${fail}`);
  console.log('='.repeat(65));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('خطأ:', err);
  stopServer();
  process.exit(1);
});
