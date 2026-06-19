/**
 * ============================================================================
 *  محرك حساب DISC  —  disc-engine.js
 * ============================================================================
 *
 *  يستقبل إجابات الموظف على اختبار DISC (32 سؤال) ويُنتج:
 *    1. درجة خام (8-40) لكل نمط من الأنماط الأربعة (D, I, S, C)
 *    2. نسبة مئوية (0-100%) لكل نمط
 *    3. النمط الأساسي (Primary) — الأعلى درجةً
 *    4. النمط الثانوي (Secondary) — الثاني إن كان قريباً من الأساسي
 *    5. تقرير مُركَّب جاهز للعرض على الشاشة وإرساله بالبريد الإداري
 *
 *  طريقة عمل المحرك:
 *    - كل سؤال ينتمي إلى نمط واحد فقط (D أو I أو S أو C).
 *    - الإجابات على مقياس ليكرت من 1 إلى 5.
 *    - نجمع إجابات الأسئلة المنتمية لكل نمط → درجة خام بين 8 و 40.
 *    - نحوّل لنسبة مئوية: (raw − 8) / 32 × 100 (لأن أقل قيمة ممكنة = 8×1 = 8،
 *      وأعلى = 8×5 = 40، والفرق = 32).
 *    - النمط الأعلى = Primary. الثاني إذا كان الفرق بينه وبين Primary
 *      أقل من عتبة (SECONDARY_THRESHOLD) = Secondary.
 *
 *  تعريف النمط الثانوي:
 *    - إذا كان الفارق بين الثاني والأول ≤ 10 نقاط (من 100): يُعتبر ثانوياً قوياً.
 *    - إذا كان الفارق > 10: لا يُعرَض نمط ثانوي (النمط الأساسي مُهيمن).
 *
 *  CommonJS — Node.js
 *  © الحارث السحيباني محامون ومستشارون
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

// ========== ثوابت المحرك ==========

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const QUESTIONS_FILE = path.join(DATA_DIR, 'disc-questions.json');
const TYPES_DIR = path.join(DATA_DIR, 'disc-types');

// ملف النمط C يقع خارج مجلد disc-types (في sample-disc-c.json)
const SAMPLE_C_FILE = path.join(DATA_DIR, 'sample-disc-c.json');

const STYLES = ['D', 'I', 'S', 'C'];

// عتبة النمط الثانوي: إذا كان الفرق بين Primary وأعلى نمط آخر ≤ هذه النسبة، نعرضه ثانوياً
// القيمة 25% مُوائمة للمعايير العملية لـ DISC — فارق أكبر من ذلك يعني أن النمط الأساسي مُهيمن
// بوضوح دون نمط ثانوي واضح.
const SECONDARY_THRESHOLD_PERCENT = 25;

// عتبات قوّة هيمنة النمط الأساسي (كم يبتعد عن بقية الأنماط)
const DOMINANCE_LABELS = {
  BALANCED:   { threshold_gap: 5,   label_ar: 'متوازن',       description_ar: 'الأنماط متقاربة — شخصية مرنة متعددة الجوانب' },
  MODERATE:   { threshold_gap: 15,  label_ar: 'واضح',         description_ar: 'النمط الأساسي يظهر بوضوح مع أنماط ثانوية' },
  STRONG:     { threshold_gap: 30,  label_ar: 'قوي',          description_ar: 'النمط الأساسي مُهيمن بشكل واضح' },
  DOMINANT:   { threshold_gap: 101, label_ar: 'مُهيمن',        description_ar: 'النمط الأساسي مُهيمن بقوّة على السلوك' }
};

// ========== تحميل البيانات (cache) ==========

let _questionsCache = null;
let _stylesMetaCache = null;

function loadQuestions() {
  if (_questionsCache) {
    return { questions: _questionsCache, stylesMeta: _stylesMetaCache };
  }

  const raw = fs.readFileSync(QUESTIONS_FILE, 'utf8');
  const data = JSON.parse(raw);

  _questionsCache = data.questions;
  _stylesMetaCache = data.styles;

  return { questions: _questionsCache, stylesMeta: _stylesMetaCache };
}

/**
 * تحميل تفسير نمط DISC من ملف JSON المناسب
 * النمط C يُقرَأ من sample-disc-c.json (هذا قرار معماري سابق)،
 * وبقية الأنماط (D, I, S) تُقرَأ من disc-types/{style}.json
 *
 * @param {string} styleCode — كود النمط (D, I, S, C)
 * @returns {object} — بيانات النمط الكاملة
 */
function loadStyleProfile(styleCode) {
  let filepath;

  if (styleCode === 'C') {
    filepath = SAMPLE_C_FILE;
  } else {
    const filename = styleCode.toLowerCase() + '.json';
    filepath = path.join(TYPES_DIR, filename);
  }

  if (!fs.existsSync(filepath)) {
    throw new Error(`ملف النمط غير موجود: ${filepath}`);
  }

  const raw = fs.readFileSync(filepath, 'utf8');
  return JSON.parse(raw);
}

// ========== التحقّق من صحّة المدخلات ==========

/**
 * يتحقّق أن مصفوفة الإجابات كاملة وصحيحة
 * @param {Array<{id: number, answer: number}>} answers
 * @throws {Error} — إذا فشل التحقّق
 */
function validateAnswers(answers) {
  const { questions } = loadQuestions();

  if (!Array.isArray(answers)) {
    throw new Error('الإجابات يجب أن تكون مصفوفة');
  }

  if (answers.length !== questions.length) {
    throw new Error(`عدد الإجابات (${answers.length}) لا يطابق عدد الأسئلة (${questions.length})`);
  }

  const questionIds = new Set(questions.map(q => q.id));
  const seenIds = new Set();

  for (const a of answers) {
    if (typeof a.id !== 'number' || typeof a.answer !== 'number') {
      throw new Error(`صيغة الإجابة غير صحيحة: ${JSON.stringify(a)}`);
    }
    if (!questionIds.has(a.id)) {
      throw new Error(`معرّف سؤال غير صالح: ${a.id}`);
    }
    if (seenIds.has(a.id)) {
      throw new Error(`إجابة مُكرّرة للسؤال: ${a.id}`);
    }
    if (a.answer < 1 || a.answer > 5 || !Number.isInteger(a.answer)) {
      throw new Error(`قيمة الإجابة ${a.answer} للسؤال ${a.id} يجب أن تكون بين 1 و 5`);
    }
    seenIds.add(a.id);
  }

  return true;
}

// ========== حساب الدرجات ==========

/**
 * يحسب درجة كل نمط (D, I, S, C)
 * @param {Array<{id: number, answer: number}>} answers
 * @returns {object} — الدرجات الخام والنسب المئوية لكل نمط
 */
function computeStyleScores(answers) {
  const { questions, stylesMeta } = loadQuestions();

  // فهرسة الأسئلة بالمعرّف
  const questionById = {};
  for (const q of questions) {
    questionById[q.id] = q;
  }

  // تهيئة درجات كل نمط
  const scores = {};
  for (const styleKey of STYLES) {
    scores[styleKey] = {
      raw_score: 0,           // مجموع الإجابات (سيكون بين 8 و 40 لـ 8 أسئلة)
      question_count: 0,
      min_possible: 0,        // أقل قيمة ممكنة (عدد الأسئلة × 1)
      max_possible: 0,        // أعلى قيمة ممكنة (عدد الأسئلة × 5)
      percent: 0,             // النسبة المئوية (ستُحسب لاحقاً)
      style_name_ar: stylesMeta[styleKey].name_ar,
      style_name_en: stylesMeta[styleKey].name_en,
      short_ar: stylesMeta[styleKey].short_ar
    };
  }

  // عدّ أسئلة كل نمط
  for (const q of questions) {
    scores[q.style].question_count += 1;
  }

  // حساب الحدود القصوى والدنيا
  for (const styleKey of STYLES) {
    scores[styleKey].min_possible = scores[styleKey].question_count * 1;
    scores[styleKey].max_possible = scores[styleKey].question_count * 5;
  }

  // معالجة الإجابات
  for (const { id, answer } of answers) {
    const q = questionById[id];
    scores[q.style].raw_score += answer;
  }

  // حساب النسبة المئوية لكل نمط
  for (const styleKey of STYLES) {
    const s = scores[styleKey];
    const range = s.max_possible - s.min_possible;  // المدى الممكن (مثلاً 32 لـ 8 أسئلة)
    const normalized = s.raw_score - s.min_possible; // الإزاحة من الحد الأدنى
    s.percent = Math.round((normalized / range) * 100);
  }

  return scores;
}

/**
 * يُحدّد النمط الأساسي والثانوي ويُصنّف قوّة الهيمنة
 * @param {object} styleScores — ناتج computeStyleScores
 * @returns {object} — تفصيل النمط الأساسي والثانوي وقوّة الهيمنة
 */
function determinePrimaryAndSecondary(styleScores) {
  // ترتيب الأنماط تنازلياً بحسب النسبة المئوية
  const ranked = STYLES.map(s => ({
    style_code: s,
    percent: styleScores[s].percent,
    raw_score: styleScores[s].raw_score,
    style_name_ar: styleScores[s].style_name_ar,
    style_name_en: styleScores[s].style_name_en,
    short_ar: styleScores[s].short_ar
  })).sort((a, b) => b.percent - a.percent);

  const primary = ranked[0];
  const runnerUp = ranked[1];

  // هل هناك تعادل في المركز الأول؟
  const primaryTie = (primary.percent === runnerUp.percent);

  // تحديد النمط الثانوي: يُعرَض إذا كان الفارق مع الأساسي ≤ العتبة
  const gap = primary.percent - runnerUp.percent;
  let secondary = null;
  if (gap <= SECONDARY_THRESHOLD_PERCENT) {
    secondary = {
      style_code: runnerUp.style_code,
      percent: runnerUp.percent,
      raw_score: runnerUp.raw_score,
      style_name_ar: runnerUp.style_name_ar,
      short_ar: runnerUp.short_ar,
      gap_from_primary: gap
    };
  }

  // تحديد قوّة هيمنة النمط الأساسي (مقارنةً بمتوسط بقية الأنماط الثلاثة)
  const othersAvg = (ranked[1].percent + ranked[2].percent + ranked[3].percent) / 3;
  const dominanceGap = primary.percent - othersAvg;

  let dominanceInfo = null;
  for (const [key, info] of Object.entries(DOMINANCE_LABELS)) {
    if (dominanceGap < info.threshold_gap) {
      dominanceInfo = {
        code: key,
        label_ar: info.label_ar,
        description_ar: info.description_ar,
        gap_value: Math.round(dominanceGap * 10) / 10
      };
      break;
    }
  }
  if (!dominanceInfo) {
    const last = DOMINANCE_LABELS.DOMINANT;
    dominanceInfo = {
      code: 'DOMINANT',
      label_ar: last.label_ar,
      description_ar: last.description_ar,
      gap_value: Math.round(dominanceGap * 10) / 10
    };
  }

  return {
    primary: {
      style_code: primary.style_code,
      percent: primary.percent,
      raw_score: primary.raw_score,
      style_name_ar: primary.style_name_ar,
      style_name_en: primary.style_name_en,
      short_ar: primary.short_ar
    },
    secondary,
    primary_tie: primaryTie,
    dominance: dominanceInfo,
    ranking: ranked  // ترتيب كامل للأنماط الأربعة
  };
}

/**
 * يُركّب كود النمط المُركّب (مثال: "DI" = أساسي D ثانوي I، أو "D" فقط بلا ثانوي)
 * هذا الكود مفيد للتخزين في قاعدة البيانات والبحث
 */
function buildCompoundCode(analysis) {
  if (analysis.secondary) {
    return analysis.primary.style_code + analysis.secondary.style_code;
  }
  return analysis.primary.style_code;
}

// ========== الواجهة الرئيسية ==========

/**
 * الدالة الرئيسية — تستقبل الإجابات وترجع تقريراً كاملاً
 *
 * @param {Array<{id: number, answer: number}>} answers — إجابات الموظف
 * @returns {object} — تقرير DISC كامل
 *
 *  صيغة الإدخال:
 *    [
 *      { id: 1, answer: 4 },
 *      { id: 2, answer: 5 },
 *      ...
 *      { id: 32, answer: 3 }
 *    ]
 *
 *  صيغة الإخراج:
 *    {
 *      test_id: "disc",
 *      primary_style: "D",
 *      secondary_style: "I" | null,
 *      compound_code: "DI" or "D",
 *      ranking: [...],              // ترتيب الأنماط تنازلياً
 *      style_scores: { D: {...}, I: {...}, S: {...}, C: {...} },
 *      primary_profile: { ... محتوى d.json / c.json ... },
 *      dominance: { ... قوّة هيمنة النمط الأساسي },
 *      primary_tie: boolean,        // هل هناك تعادل في المركز الأول
 *      computed_at: ISO timestamp
 *    }
 */
function analyzeDISC(answers) {
  // 1) التحقّق من صحّة المدخلات
  validateAnswers(answers);

  // 2) حساب درجات الأنماط الأربعة
  const styleScores = computeStyleScores(answers);

  // 3) تحديد الأساسي والثانوي
  const analysis = determinePrimaryAndSecondary(styleScores);

  // 4) تحميل تفسير النمط الأساسي
  const primaryProfile = loadStyleProfile(analysis.primary.style_code);

  // 5) تحميل تفسير النمط الثانوي (إن وُجد) — مُبسَّط، لعرض الاسم والمختصر
  let secondaryProfile = null;
  if (analysis.secondary) {
    const fullProfile = loadStyleProfile(analysis.secondary.style_code);
    // نعرض فقط ما يلزم للتنبيه الإداري، لا التقرير الكامل
    secondaryProfile = {
      style_code: fullProfile.style_code,
      style_name_ar: fullProfile.style_name_ar,
      style_name_en: fullProfile.style_name_en,
      tagline_ar: fullProfile.tagline_ar,
      top_strengths_ar: fullProfile.summary_for_employee.top_strengths_ar
    };
  }

  // 6) بناء الكود المركّب
  const compoundCode = buildCompoundCode(analysis);

  return {
    test_id: 'disc',
    test_name_ar: 'اختبار أنماط السلوك (DISC)',
    primary_style: analysis.primary.style_code,
    secondary_style: analysis.secondary ? analysis.secondary.style_code : null,
    compound_code: compoundCode,
    primary_tie: analysis.primary_tie,
    ranking: analysis.ranking,
    style_scores: styleScores,
    primary_profile: primaryProfile,
    secondary_profile: secondaryProfile,
    primary_info: analysis.primary,
    secondary_info: analysis.secondary,
    dominance: analysis.dominance,
    computed_at: new Date().toISOString()
  };
}

// ========== تصدير الدوال ==========

module.exports = {
  analyzeDISC,
  // دوال مُساعِدة للاختبار والاستخدام المُتقدّم
  validateAnswers,
  computeStyleScores,
  determinePrimaryAndSecondary,
  buildCompoundCode,
  loadStyleProfile,
  // ثوابت
  STYLES,
  SECONDARY_THRESHOLD_PERCENT,
  DOMINANCE_LABELS
};
