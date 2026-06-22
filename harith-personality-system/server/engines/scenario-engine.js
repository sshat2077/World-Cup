/**
 * ============================================================================
 *  المحرّك العامّ لاختبارات السيناريوهات — scenario-engine.js
 * ============================================================================
 *  مُوجَّه بالإعدادات: يقرأ المحاور/المستويات/عدد المخدوم من ملف البنك نفسه.
 *  يصحّح فقط الأسئلة المخدومة لهذا المختبَر (subset من البنك) حسب token.
 *  يُستخدم لاختبار «مصادر الالتزام» وأي اختبار سيناريوهات قادم (باب جديد = ملف بنك جديد).
 *
 *  لا يكشف الإجابات الصحيحة في النتيجة المُعادة.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { selectServed } = require('../lib/sampling');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// خريطة الاختبارات السيناريوية → ملفّ البنك (لإضافة باب جديد: أضف سطراً)
const BANK_FILES = {
  obligations: 'obligations-questions.json'
};

function loadBank(testId) {
  const file = BANK_FILES[testId];
  if (!file) throw new Error('اختبار سيناريوهات غير معروف: ' + testId);
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
}

function levelFor(percent, levels) {
  const sorted = [...levels].sort((a, b) => b.min_percent - a.min_percent);
  for (const lvl of sorted) if (percent >= lvl.min_percent) return lvl;
  return sorted[sorted.length - 1];
}

function toAnswerMap(answers) {
  const map = {};
  if (Array.isArray(answers)) {
    for (const a of answers) if (a && a.id != null) map[a.id] = a.answer;
  } else if (answers && typeof answers === 'object') {
    Object.assign(map, answers);
  }
  return map;
}

/**
 * تحليل اختبار سيناريوهات
 * @param {string} testId  — مثل 'obligations'
 * @param {Array|Object} answers — [{id, answer:'a'}]
 * @param {string} token — لإعادة حساب نفس المجموعة المخدومة
 */
function analyzeScenario(testId, answers, token) {
  const bank = loadBank(testId);
  const MAX = bank.scoring.max_per_question;
  const levels = bank.scoring.levels;
  const domainsMeta = bank.domains;

  const served = selectServed(bank, token);     // نفس المجموعة المخدومة وقت العرض
  const servedIds = served.map(q => q.id);
  const qById = {};
  bank.questions.forEach(q => { qById[q.id] = q; });
  const answerMap = toAnswerMap(answers);

  let totalScore = 0, totalMax = 0;
  const domainAgg = {};

  for (const id of servedIds) {
    const q = qById[id];
    if (!q) continue;
    const opt = q.options.find(o => o.id === answerMap[id]);
    const score = opt ? opt.score : 0;
    totalScore += score;
    totalMax += MAX;
    if (!domainAgg[q.domain]) domainAgg[q.domain] = { score: 0, max: 0 };
    domainAgg[q.domain].score += score;
    domainAgg[q.domain].max += MAX;
  }

  const pct = (s, m) => (m > 0 ? Math.round((s / m) * 100) : 0);
  const totalPercent = pct(totalScore, totalMax);
  const overallLevel = levelFor(totalPercent, levels);

  const domainReports = Object.keys(domainAgg).map(code => {
    const agg = domainAgg[code];
    const percent = pct(agg.score, agg.max);
    const meta = domainsMeta[code] || { name_ar: code };
    return {
      domain_code: code,
      domain_name_ar: meta.name_ar,
      score: agg.score,
      max: agg.max,
      percent,
      level_label_ar: levelFor(percent, levels).label_ar,
      note_ar: domainNote(meta.name_ar, percent)
    };
  }).sort((a, b) => b.percent - a.percent);

  const strengths = domainReports.filter(d => d.percent >= 75).map(d => d.domain_name_ar);
  const gaps = domainReports.filter(d => d.percent < 60).map(d => d.domain_name_ar);
  const recommendation = recommendationFor(overallLevel.code);

  const developmentPlan = domainReports
    .filter(d => d.percent < 75)
    .map(d => `تعميق التطبيق في «${d.domain_name_ar}» (${d.percent}%) عبر حالات مركّبة وتكييف دقيق.`);
  if (!developmentPlan.length) {
    developmentPlan.push('أداء متقدّم في جميع المصادر — يُنتقَل به إلى حالات أعقد وأبواب أخرى.');
  }

  const execSummary =
    `حقّق المختبَر ${totalPercent}% (مستوى «${overallLevel.label_ar}») في ${servedIds.length} سؤالاً مخدوماً من بنك ${bank.questions.length}. ` +
    (strengths.length ? `أقوى المصادر: ${strengths.join('، ')}. ` : '') +
    (gaps.length ? `وأضعفها: ${gaps.join('، ')}.` : 'دون فجوات جوهرية.');

  return {
    test_id: testId,
    test_name_ar: bank.test_name_ar,
    open_book: !!bank.open_book,
    served_count: servedIds.length,
    bank_size: bank.questions.length,
    total_score: totalScore,
    max_score: totalMax,
    total_percent: totalPercent,
    level: { code: overallLevel.code, label_ar: overallLevel.label_ar, desc_ar: overallLevel.desc_ar },
    domain_reports: domainReports,

    summary_for_employee: {
      headline_ar: 'تمّ إكمال الاختبار',
      short_description_ar: 'تمّ استلام إجاباتك بنجاح. النتيجة التفصيلية متاحة للإدارة.'
    },

    detailed_report_for_admin: {
      executive_summary_ar: execSummary,
      overall_ar: { total_percent: totalPercent, level_label_ar: overallLevel.label_ar, level_desc_ar: overallLevel.desc_ar },
      domain_analysis_ar: domainReports.map(d => ({
        name_ar: d.domain_name_ar, percent: d.percent, level_label_ar: d.level_label_ar, note_ar: d.note_ar
      })),
      strengths_ar: strengths.length ? strengths : ['لا يوجد مصدر بلغ مستوى القوة (75%+).'],
      gaps_ar: gaps.length ? gaps : ['لا فجوات جوهرية (دون 60%).'],
      recommendation_ar: recommendation,
      development_recommendations_ar: developmentPlan
    },

    computed_at: new Date().toISOString()
  };
}

function domainNote(name, percent) {
  if (percent >= 90) return `تكييف دقيق ومتقدّم في «${name}».`;
  if (percent >= 75) return `استدلال قوي في «${name}».`;
  if (percent >= 60) return `فهم سليم في «${name}» يحتمل الصقل.`;
  return `ضعف في «${name}» رغم إتاحة المرجع.`;
}

function recommendationFor(levelCode) {
  const map = {
    distinguished: {
      decision_ar: 'كفاءة متميّزة في مصادر الالتزام',
      intro_ar: 'تكييف قانوني دقيق في اختبارٍ مفتوح المرجع.',
      items_ar: ['أسند له حالات تحليلية أعقد ومسائل تكييف متعدّدة المصادر.', 'مرشّح قوي للمهام النوعية في صياغة وتحليل الالتزامات.']
    },
    advanced: {
      decision_ar: 'مستوى متقدّم',
      intro_ar: 'استدلال قوي مع هفوات محدودة.',
      items_ar: ['صقلٌ في الحالات المركّبة والتمييز بين المصادر المتقاربة.', 'إشراف خفيف مع تغذية راجعة على التكييف.']
    },
    competent: {
      decision_ar: 'مستوى كفؤ',
      intro_ar: 'أساس سليم يحتاج تطويراً في الحالات الدقيقة.',
      items_ar: ['تدريب موجّه على المصادر الأضعف في تقريره.', 'مراجعة تطبيقية على وقائع متنوّعة.']
    },
    below: {
      decision_ar: 'دون المستوى المطلوب',
      intro_ar: 'ضعف في التكييف رغم إتاحة المرجع.',
      items_ar: ['تأهيل تطبيقي مكثّف في مصادر الالتزام قبل إسناد مهام تحليلية.', 'إعادة التقييم بعد فترة تدريب.']
    }
  };
  return map[levelCode] || map.below;
}

module.exports = { analyzeScenario, BANK_FILES };
