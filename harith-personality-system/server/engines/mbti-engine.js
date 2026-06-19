/**
 * ============================================================================
 *  محرك حساب MBTI  —  mbti-engine.js
 * ============================================================================
 *
 *  يستقبل إجابات الموظف على اختبار مؤشر مايرز-بريجز (70 سؤال) ويُنتج:
 *    1. درجات خام لكل محور من المحاور الأربعة (EI, SN, TF, JP)
 *    2. تفضيلات الموظف (E/I, S/N, T/F, J/P) + قوة كل تفضيل كنسبة مئوية
 *    3. كود النمط النهائي (مثال: INTJ, ESFP)
 *    4. تقرير مُركَّب جاهز للعرض على الشاشة وإرساله بالبريد الإداري
 *
 *  طريقة عمل المحرك:
 *    - كل سؤال يقع على محور واحد (EI, SN, TF, JP).
 *    - كل سؤال له اتجاه (+ أو -) يُحدّد إلى أيّ قطب من المحور يُحسب.
 *    - الإجابات على مقياس ليكرت من 1 إلى 5:
 *        1 = لا يشبهني إطلاقاً   →  يُعاكس اتجاه السؤال بقوة
 *        5 = يشبهني تماماً       →  يُوافق اتجاه السؤال بقوة
 *    - القاعدة: نُحوّل الإجابة (1..5) إلى نقطة (-2..+2) بالمعادلة (answer - 3).
 *    - سؤال اتّجاهه + يُضيف هذه النقطة كما هي للقطب الإيجابي.
 *    - سؤال اتّجاهه − يعكسها، فتُضاف للقطب السالب.
 *    - في النهاية نجمع كل النقاط لكل محور، ونُقارن القطب الإيجابي بالسالب.
 *
 *  CommonJS — Node.js
 *  © الحارث السحيباني محامون ومستشارون
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

// ========== ثوابت المحرك ==========

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const QUESTIONS_FILE = path.join(DATA_DIR, 'mbti-questions.json');
const TYPES_DIR = path.join(DATA_DIR, 'mbti-types');

const AXES = ['EI', 'SN', 'TF', 'JP'];

// عتبات قوّة التفضيل (نسبة مئوية من 0 إلى 100)
const PREFERENCE_STRENGTH_LABELS = {
  SLIGHT:    { threshold: 60,  label_ar: 'طفيف',   description_ar: 'تفضيل غير حاسم — الموظف قريب من منتصف المحور' },
  MODERATE:  { threshold: 75,  label_ar: 'متوسط',  description_ar: 'تفضيل واضح ومستقر' },
  CLEAR:     { threshold: 90,  label_ar: 'واضح',   description_ar: 'تفضيل قوي يظهر في معظم المواقف' },
  VERY_CLEAR:{ threshold: 101, label_ar: 'قوي جداً', description_ar: 'تفضيل مهيمن يصعب على الموظف تعديله' }
};

// ========== تحميل البيانات (مرة واحدة عند تحميل المحرك) ==========

let _questionsCache = null;
let _axesCache = null;

function loadQuestions() {
  if (_questionsCache) return { questions: _questionsCache, axes: _axesCache };

  const raw = fs.readFileSync(QUESTIONS_FILE, 'utf8');
  const data = JSON.parse(raw);

  _questionsCache = data.questions;
  _axesCache = data.axes;

  return { questions: _questionsCache, axes: _axesCache };
}

/**
 * تحميل تفسير نمط MBTI من ملف JSON المناسب
 * @param {string} typeCode — كود النمط (مثال: "INTJ")
 * @returns {object} — بيانات النمط
 */
function loadTypeProfile(typeCode) {
  const filename = typeCode.toLowerCase() + '.json';
  const filepath = path.join(TYPES_DIR, filename);

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
 * يحسب درجات المحاور الأربعة بناءً على الإجابات
 * @param {Array<{id: number, answer: number}>} answers
 * @returns {object} — درجات كل محور
 */
function computeAxisScores(answers) {
  const { questions, axes } = loadQuestions();

  // فهرسة الأسئلة بالمعرّف لسرعة الوصول
  const questionById = {};
  for (const q of questions) {
    questionById[q.id] = q;
  }

  // تهيئة درجات كل محور
  const scores = {};
  for (const axisKey of AXES) {
    scores[axisKey] = {
      raw_score: 0,           // النتيجة الصافية (قد تكون سالبة أو موجبة)
      positive_pole: axes[axisKey].positive,   // حرف القطب الموجب (مثل E)
      negative_pole: axes[axisKey].negative,   // حرف القطب السالب (مثل I)
      axis_name_ar: axes[axisKey].name_ar,
      question_count: 0,
      max_possible: 0          // الحد الأقصى النظري (ستُحسب لاحقاً)
    };
  }

  // عدّ عدد الأسئلة في كل محور لحساب السقف
  for (const q of questions) {
    scores[q.axis].question_count += 1;
    scores[q.axis].max_possible += 2;  // كل سؤال يُساهم بحد أقصى ±2 نقطة
  }

  // معالجة كل إجابة
  for (const { id, answer } of answers) {
    const q = questionById[id];
    // إجابة 1..5 تُحوَّل إلى -2..+2
    const point = answer - 3;
    // السؤال إن كان اتّجاهه + يُضاف كما هو، وإن كان − يُعكس
    const signedPoint = (q.direction === '+') ? point : -point;
    scores[q.axis].raw_score += signedPoint;
  }

  return scores;
}

/**
 * يُحدّد التفضيل لكل محور (الحرف + قوّة التفضيل)
 * @param {object} axisScores — ناتج computeAxisScores
 * @returns {object} — تفضيلات تفصيلية
 */
function determinePreferences(axisScores) {
  const preferences = {};

  for (const axisKey of AXES) {
    const s = axisScores[axisKey];
    const rawScore = s.raw_score;
    const maxAbsolute = s.max_possible;

    // حساب قوّة التفضيل كنسبة مئوية من الحد الأقصى
    const strengthPercent = Math.round((Math.abs(rawScore) / maxAbsolute) * 100);

    // تحديد القطب المختار
    let chosenPole;
    let isTie = false;

    if (rawScore > 0) {
      chosenPole = s.positive_pole;
    } else if (rawScore < 0) {
      chosenPole = s.negative_pole;
    } else {
      // تعادل تام — نميل للقطب السالب بشكل افتراضي
      // (بحسب المقاييس الأكاديمية الأشهر: I/S/T/J هي الحيادية الافتراضية)
      chosenPole = s.negative_pole;
      isTie = true;
    }

    // تحديد وصف قوّة التفضيل
    let strengthInfo = null;
    for (const [key, info] of Object.entries(PREFERENCE_STRENGTH_LABELS)) {
      if (strengthPercent < info.threshold) {
        strengthInfo = {
          code: key,
          label_ar: info.label_ar,
          description_ar: info.description_ar
        };
        break;
      }
    }
    // في حال تجاوز جميع العتبات (نادر جداً)
    if (!strengthInfo) {
      const last = PREFERENCE_STRENGTH_LABELS.VERY_CLEAR;
      strengthInfo = { code: 'VERY_CLEAR', label_ar: last.label_ar, description_ar: last.description_ar };
    }

    preferences[axisKey] = {
      chosen_pole: chosenPole,
      is_tie: isTie,
      raw_score: rawScore,
      max_possible: maxAbsolute,
      strength_percent: strengthPercent,
      strength: strengthInfo,
      axis_name_ar: s.axis_name_ar,
      positive_pole: s.positive_pole,
      negative_pole: s.negative_pole
    };
  }

  return preferences;
}

/**
 * يُركّب كود النمط النهائي (مثال: INTJ) من التفضيلات
 * @param {object} preferences
 * @returns {string} — كود النمط من 4 أحرف
 */
function buildTypeCode(preferences) {
  return (
    preferences.EI.chosen_pole +
    preferences.SN.chosen_pole +
    preferences.TF.chosen_pole +
    preferences.JP.chosen_pole
  );
}

// ========== الواجهة الرئيسية ==========

/**
 * الدالة الرئيسية — تستقبل الإجابات وترجع تقريراً كاملاً
 *
 * @param {Array<{id: number, answer: number}>} answers — إجابات الموظف
 * @returns {object} — تقرير MBTI كامل
 *
 *  صيغة الإدخال:
 *    [
 *      { id: 1, answer: 4 },
 *      { id: 2, answer: 2 },
 *      ...
 *      { id: 70, answer: 3 }
 *    ]
 *
 *  صيغة الإخراج:
 *    {
 *      test_id: "mbti",
 *      type_code: "INTJ",
 *      preferences: { EI: {...}, SN: {...}, TF: {...}, JP: {...} },
 *      axis_scores: { ... },
 *      type_profile: { ... محتوى ملف intj.json ... },
 *      has_ties: boolean,
 *      computed_at: ISO timestamp
 *    }
 */
function analyzeMBTI(answers) {
  // 1) التحقّق من صحّة المدخلات
  validateAnswers(answers);

  // 2) حساب درجات المحاور
  const axisScores = computeAxisScores(answers);

  // 3) تحديد التفضيلات
  const preferences = determinePreferences(axisScores);

  // 4) تركيب كود النمط
  const typeCode = buildTypeCode(preferences);

  // 5) تحميل تفسير النمط
  const typeProfile = loadTypeProfile(typeCode);

  // 6) التحقّق من وجود تعادلات للتنبيه الإداري
  const hasTies = AXES.some(a => preferences[a].is_tie);
  const tiedAxes = AXES.filter(a => preferences[a].is_tie);

  return {
    test_id: 'mbti',
    test_name_ar: 'مؤشر مايرز-بريجز للأنماط (MBTI)',
    type_code: typeCode,
    preferences,
    axis_scores: axisScores,
    type_profile: typeProfile,
    has_ties: hasTies,
    tied_axes: tiedAxes,
    computed_at: new Date().toISOString()
  };
}

// ========== تصدير الدوال ==========

module.exports = {
  analyzeMBTI,
  // دوال مُساعِدة للاختبار والاستخدام المُتقدّم
  validateAnswers,
  computeAxisScores,
  determinePreferences,
  buildTypeCode,
  loadTypeProfile,
  // ثوابت
  AXES,
  PREFERENCE_STRENGTH_LABELS
};
