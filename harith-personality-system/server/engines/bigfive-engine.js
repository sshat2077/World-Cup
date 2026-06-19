/**
 * ============================================================================
 *  محرك حساب Big Five (OCEAN)  —  bigfive-engine.js
 * ============================================================================
 *
 *  يستقبل إجابات الموظف على اختبار العوامل الخمسة الكبرى (60 سؤال) ويُنتج:
 *    1. درجة خام لكل بُعد من الأبعاد الخمسة (O, C, E, A, N)
 *    2. نسبة مئوية (0-100%) لكل بُعد
 *    3. مستوى كل بُعد (low / moderate / high) حسب العتبات المعيارية
 *    4. تقرير مُركَّب من 5 قطع (واحدة لكل بُعد) بحسب المستوى
 *    5. ملخّص عام للشخصية وتقرير إداري شامل
 *
 *  طريقة عمل المحرك:
 *    - كل سؤال ينتمي إلى بُعد واحد (O/C/E/A/N) وله اتجاه (+ أو −).
 *    - الإجابات على مقياس ليكرت من 1 إلى 5.
 *    - سؤال اتجاهه + يُستخدم كما هو.
 *    - سؤال اتجاهه − يُعكس: (6 − answer) — فإجابة 5 تصبح 1، والعكس.
 *    - نجمع القيم المُصحَّحة لكل بُعد → درجة خام بين 12 و 60.
 *    - نحوّل لنسبة مئوية: (raw − 12) / 48 × 100.
 *    - نُحدّد المستوى:
 *        0-33%  →  low
 *        34-66% →  moderate
 *        67-100% → high
 *
 *  ملاحظة حاسمة لبُعد N (العصابية):
 *    المستوى "low" في N هو القطب الإيجابي (استقرار عاطفي).
 *    التفسير نفسه يُعالج هذا في ملف neuroticism.json (حقل _design_note).
 *    المحرك لا يقلب شيئاً — يعرض المستوى الرياضي كما هو.
 *
 *  طريقة تركيب التقرير:
 *    - لكل بُعد من الأبعاد الخمسة، نُحمّل الملف المناسب من bigfive-interpretations/
 *      ثم نأخذ القطعة المناسبة من levels[low|moderate|high].
 *    - نجمع القطع الخمس في مصفوفة مُرتّبة لتكوين التقرير الكامل.
 *
 *  CommonJS — Node.js
 *  © الحارث السحيباني محامون ومستشارون
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

// ========== ثوابت المحرك ==========

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const QUESTIONS_FILE = path.join(DATA_DIR, 'bigfive-questions.json');
const INTERP_DIR = path.join(DATA_DIR, 'bigfive-interpretations');

// الأبعاد الخمسة — بالترتيب المعتاد (OCEAN)
const DIMENSIONS = ['O', 'C', 'E', 'A', 'N'];

// تعيين كود البُعد إلى اسم الملف
const DIMENSION_FILE = {
  'O': 'openness.json',
  'C': 'conscientiousness.json',
  'E': 'extraversion.json',
  'A': 'agreeableness.json',
  'N': 'neuroticism.json'
};

// عتبات المستويات — معيارية في علم النفس الحديث
const LEVEL_THRESHOLDS = {
  LOW_MAX: 33,       // 0-33 = low
  MODERATE_MAX: 66   // 34-66 = moderate، وما فوق = high
};

// الأبعاد التي يُعدّ فيها المستوى "low" هو القطب الإيجابي
// (حالياً: N فقط — انخفاض العصابية = استقرار عاطفي)
const REVERSE_SCORED_DIMENSIONS = new Set(['N']);

// ========== تحميل البيانات (cache) ==========

let _questionsCache = null;
let _dimensionsMetaCache = null;
let _interpretationsCache = {};

function loadQuestions() {
  if (_questionsCache) {
    return { questions: _questionsCache, dimensionsMeta: _dimensionsMetaCache };
  }

  const raw = fs.readFileSync(QUESTIONS_FILE, 'utf8');
  const data = JSON.parse(raw);

  _questionsCache = data.questions;
  _dimensionsMetaCache = data.dimensions;

  return { questions: _questionsCache, dimensionsMeta: _dimensionsMetaCache };
}

/**
 * تحميل ملف تفسير بُعد من bigfive-interpretations/
 * يتم التخزين المؤقّت لكل بُعد.
 *
 * @param {string} dimensionCode — كود البُعد (O, C, E, A, N)
 * @returns {object} — ملف التفسير الكامل (يحوي 3 مستويات)
 */
function loadDimensionInterpretation(dimensionCode) {
  if (_interpretationsCache[dimensionCode]) {
    return _interpretationsCache[dimensionCode];
  }

  const filename = DIMENSION_FILE[dimensionCode];
  if (!filename) {
    throw new Error(`كود بُعد غير معروف: ${dimensionCode}`);
  }

  const filepath = path.join(INTERP_DIR, filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(`ملف التفسير غير موجود: ${filepath}`);
  }

  const raw = fs.readFileSync(filepath, 'utf8');
  const data = JSON.parse(raw);

  // التحقّق السريع من سلامة البنية
  if (!data.levels || !data.levels.low || !data.levels.moderate || !data.levels.high) {
    throw new Error(`ملف التفسير ${filename} لا يحوي المستويات الثلاثة المطلوبة`);
  }

  _interpretationsCache[dimensionCode] = data;
  return data;
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
 * يحسب درجة كل بُعد (درجة خام + نسبة مئوية + مستوى)
 * @param {Array<{id: number, answer: number}>} answers
 * @returns {object} — الدرجات التفصيلية لكل بُعد
 */
function computeDimensionScores(answers) {
  const { questions, dimensionsMeta } = loadQuestions();

  // فهرسة الأسئلة بالمعرّف
  const questionById = {};
  for (const q of questions) {
    questionById[q.id] = q;
  }

  // تهيئة درجات كل بُعد
  const scores = {};
  for (const dimKey of DIMENSIONS) {
    scores[dimKey] = {
      dimension_code: dimKey,
      dimension_name_ar: dimensionsMeta[dimKey].name_ar,
      dimension_name_en: dimensionsMeta[dimKey].name_en,
      raw_score: 0,
      question_count: 0,
      min_possible: 0,
      max_possible: 0,
      percent: 0,
      level: null,
      level_label_ar: null,
      is_reverse_scored: REVERSE_SCORED_DIMENSIONS.has(dimKey)
    };
  }

  // عدّ أسئلة كل بُعد
  for (const q of questions) {
    scores[q.dimension].question_count += 1;
  }

  // حساب الحدود
  for (const dimKey of DIMENSIONS) {
    scores[dimKey].min_possible = scores[dimKey].question_count * 1;
    scores[dimKey].max_possible = scores[dimKey].question_count * 5;
  }

  // معالجة الإجابات
  for (const { id, answer } of answers) {
    const q = questionById[id];
    // تصحيح الاتجاه: السؤال "+" يُؤخذ كما هو، "-" يُعكس
    const correctedValue = (q.direction === '+') ? answer : (6 - answer);
    scores[q.dimension].raw_score += correctedValue;
  }

  // حساب النسبة المئوية وتحديد المستوى
  for (const dimKey of DIMENSIONS) {
    const s = scores[dimKey];
    const range = s.max_possible - s.min_possible;
    const normalized = s.raw_score - s.min_possible;
    s.percent = Math.round((normalized / range) * 100);

    // تحديد المستوى
    if (s.percent <= LEVEL_THRESHOLDS.LOW_MAX) {
      s.level = 'low';
    } else if (s.percent <= LEVEL_THRESHOLDS.MODERATE_MAX) {
      s.level = 'moderate';
    } else {
      s.level = 'high';
    }
  }

  return scores;
}

/**
 * يُركّب تقرير البُعد الواحد بجمع الدرجة مع التفسير المناسب
 * @param {string} dimensionCode
 * @param {object} scoreData — بيانات الدرجة للبُعد
 * @returns {object} — تقرير بُعد كامل
 */
function assembleDimensionReport(dimensionCode, scoreData) {
  const fullInterpretation = loadDimensionInterpretation(dimensionCode);
  const levelData = fullInterpretation.levels[scoreData.level];

  if (!levelData) {
    throw new Error(`لا يوجد تفسير للمستوى ${scoreData.level} في البُعد ${dimensionCode}`);
  }

  return {
    // معلومات البُعد العامة
    dimension_code: fullInterpretation.dimension_code,
    dimension_name_ar: fullInterpretation.dimension_name_ar,
    dimension_name_en: fullInterpretation.dimension_name_en,

    // نتيجة الموظف في هذا البُعد
    score: {
      raw_score: scoreData.raw_score,
      min_possible: scoreData.min_possible,
      max_possible: scoreData.max_possible,
      percent: scoreData.percent,
      level: scoreData.level,
      is_reverse_scored: scoreData.is_reverse_scored
    },

    // محتوى التفسير المُطبَّق
    interpretation: {
      level_label_ar: levelData.level_label_ar,
      percentile_range: levelData.percentile_range,
      headline_ar: levelData.headline_ar,
      short_description_ar: levelData.short_description_ar,
      meaning_ar: levelData.meaning_ar,
      workplace_implications_ar: levelData.workplace_implications_ar,
      swot_mini_ar: levelData.swot_mini_ar,
      management_tip_ar: levelData.management_tip_ar,
      recommendations_by_role_ar: levelData.recommendations_by_role_ar
    },

    // ملاحظة خاصة إذا كان البُعد معكوس التقييم (حالياً N فقط)
    reverse_scoring_note_ar: scoreData.is_reverse_scored
      ? 'ملاحظة: في هذا البُعد، المستوى المنخفض يُمثّل القطب الإيجابي (الاستقرار العاطفي).'
      : null
  };
}

/**
 * يُولّد كود ملخّص يُجمع المستويات الخمسة — مفيد للتخزين والتصنيف السريع
 * مثال: "O-hi_C-hi_E-mod_A-hi_N-lo" لشخص منفتح منضبط متوسط الانبساط مقبول مستقر عاطفياً
 */
function buildProfileCode(scores) {
  const levelShort = { 'high': 'hi', 'moderate': 'mod', 'low': 'lo' };
  return DIMENSIONS.map(d => `${d}-${levelShort[scores[d].level]}`).join('_');
}

/**
 * يُولّد ملخّصاً لفظياً شاملاً للشخصية يربط بين الأبعاد الخمسة
 */
function buildExecutiveSummary(dimensionReports) {
  const parts = [];
  for (const report of dimensionReports) {
    parts.push(
      `${report.dimension_name_ar} (${report.score.percent}%): ${report.interpretation.level_label_ar} — ${report.interpretation.headline_ar}`
    );
  }
  return parts;
}

// ========== الواجهة الرئيسية ==========

/**
 * الدالة الرئيسية — تستقبل الإجابات وترجع تقريراً كاملاً
 *
 * @param {Array<{id: number, answer: number}>} answers — إجابات الموظف
 * @returns {object} — تقرير Big Five كامل
 *
 *  صيغة الإدخال:
 *    [
 *      { id: 1, answer: 4 },
 *      { id: 2, answer: 2 },
 *      ...
 *      { id: 60, answer: 3 }
 *    ]
 *
 *  صيغة الإخراج:
 *    {
 *      test_id: "bigfive",
 *      profile_code: "O-hi_C-hi_E-mod_A-hi_N-lo",
 *      dimension_scores: {
 *        O: { raw_score, percent, level, ... },
 *        C: { ... },
 *        E: { ... },
 *        A: { ... },
 *        N: { ... }
 *      },
 *      dimension_reports: [
 *        { dimension_code, score, interpretation: { headline, swot, recommendations_by_role... } },
 *        ... (5 تقارير بالترتيب OCEAN)
 *      ],
 *      executive_summary: [...],  // ملخّص لفظي لكل بُعد
 *      computed_at: ISO timestamp
 *    }
 */
function analyzeBigFive(answers) {
  // 1) التحقّق من صحّة المدخلات
  validateAnswers(answers);

  // 2) حساب درجات الأبعاد الخمسة
  const dimensionScores = computeDimensionScores(answers);

  // 3) تركيب تقرير كامل لكل بُعد
  const dimensionReports = DIMENSIONS.map(dimKey =>
    assembleDimensionReport(dimKey, dimensionScores[dimKey])
  );

  // 4) بناء كود الملخّص
  const profileCode = buildProfileCode(dimensionScores);

  // 5) بناء ملخّص تنفيذي لفظي
  const executiveSummary = buildExecutiveSummary(dimensionReports);

  return {
    test_id: 'bigfive',
    test_name_ar: 'اختبار العوامل الخمسة الكبرى (Big Five / OCEAN)',
    profile_code: profileCode,
    dimension_scores: dimensionScores,
    dimension_reports: dimensionReports,
    executive_summary: executiveSummary,
    computed_at: new Date().toISOString()
  };
}

// ========== تصدير الدوال ==========

module.exports = {
  analyzeBigFive,
  // دوال مُساعِدة للاختبار والاستخدام المُتقدّم
  validateAnswers,
  computeDimensionScores,
  assembleDimensionReport,
  buildProfileCode,
  loadDimensionInterpretation,
  // ثوابت
  DIMENSIONS,
  LEVEL_THRESHOLDS,
  REVERSE_SCORED_DIMENSIONS,
  DIMENSION_FILE
};
