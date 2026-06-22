/**
 * ============================================================================
 *  أدوات الاختيار والخلط المبذور بالـtoken — sampling.js
 * ============================================================================
 *  مشتركة بين خدمة الأسئلة (candidate-routes) والمحرّك العامّ (scenario-engine)
 *  لضمان أن نفس الـtoken يُنتِج نفس مجموعة الأسئلة وترتيبها (ثبات عند الاستئناف،
 *  وتنوّع بين المختبَرين).
 * ============================================================================
 */

function seedFromToken(token) {
  let h = 2166136261 >>> 0;
  const s = String(token || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * يختار ويرتّب الأسئلة المخدومة لمختبَرٍ مُعيّن (حسب token).
 *  - إن وُجد serve_count < إجمالي الأسئلة و sampling=stratified: يختار per_domain من كل مصدر.
 *  - وإلا: يخلط كل الأسئلة.
 * كما يخلط خيارات كل سؤال (مع إبقاء المُعرّفات) كي لا يثبت موضع الإجابة الصحيحة.
 * النتيجة حتمية لنفس الـtoken.
 *
 * @returns {Array} أسئلة كاملة (تتضمّن الدرجات) مرتّبة ومخلوطة الخيارات
 */
function selectServed(raw, token) {
  const rnd = mulberry32(seedFromToken(token));
  const total = raw.questions.length;
  const serveN = (raw.serve_count && raw.serve_count < total) ? raw.serve_count : total;

  let selected;
  if (raw.sampling && raw.sampling.strategy === 'stratified' && serveN < total) {
    const per = raw.sampling.per_domain || 1;
    const byDom = {};
    for (const q of raw.questions) {
      (byDom[q.domain] = byDom[q.domain] || []).push(q);
    }
    selected = [];
    // ترتيب ثابت للمصادر (حسب تعريف domains) لضمان الحتمية
    const domainOrder = raw.domains ? Object.keys(raw.domains) : Object.keys(byDom);
    for (const dom of domainOrder) {
      const pool = seededShuffle(byDom[dom] || [], rnd);
      selected.push(...pool.slice(0, per));
    }
    selected = seededShuffle(selected, rnd);
  } else {
    selected = seededShuffle(raw.questions, rnd);
  }

  return selected.map(q => ({ ...q, options: seededShuffle(q.options, rnd) }));
}

module.exports = { seedFromToken, mulberry32, seededShuffle, selectServed };
