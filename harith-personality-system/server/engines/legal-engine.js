/**
 * ============================================================================
 *  محرّك الاختبار المعرفي (القانوني) — legal-engine.js
 * ============================================================================
 *  اختبار حُكم ظرفي: لكل سؤال خيارات بدرجات 0–3.
 *  المخرجات: كفاءة مئوية + مستوى + تحليل لكل كفاية + أداء الأسئلة الصعبة
 *            + علم أحمر للأخلاقيات + تقرير إداري مفصّل.
 *
 *  لا يكشف المحرّك الإجابات الصحيحة في النتيجة المُعادة.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const QUESTIONS_FILE = path.join(DATA_DIR, 'legal-trainee-questions.json');

function loadData() {
  return JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
}

/** يحدّد المستوى المطابق لنسبة مئوية من قائمة المستويات (مرتّبة تنازلياً بـ min_percent) */
function levelFor(percent, levels) {
  const sorted = [...levels].sort((a, b) => b.min_percent - a.min_percent);
  for (const lvl of sorted) {
    if (percent >= lvl.min_percent) return lvl;
  }
  return sorted[sorted.length - 1];
}

/** يحوّل answers (مصفوفة {id, answer} أو كائن {id: answer}) إلى خريطة id→optionId */
function toAnswerMap(answers) {
  const map = {};
  if (Array.isArray(answers)) {
    for (const a of answers) {
      if (a && a.id != null) map[a.id] = a.answer;
    }
  } else if (answers && typeof answers === 'object') {
    Object.assign(map, answers);
  }
  return map;
}

/**
 * التحليل الرئيسي
 * @param {Array|Object} answers — [{id, answer:'a'}] أو {id:'a'}
 * @returns {object} نتيجة كاملة
 */
function analyzeLegal(answers) {
  const data = loadData();
  const questions = data.questions;
  const domainsMeta = data.domains;
  const levels = data.scoring.levels;
  const MAX = data.scoring.max_per_question; // 3
  const answerMap = toAnswerMap(answers);

  // تجميع الدرجات
  let totalScore = 0;
  let totalMax = 0;
  const domainAgg = {};   // code → {score, max}
  const hardAgg = { score: 0, max: 0 };

  for (const q of questions) {
    const chosen = answerMap[q.id];
    const opt = q.options.find(o => o.id === chosen);
    const score = opt ? opt.score : 0;

    totalScore += score;
    totalMax += MAX;

    if (!domainAgg[q.domain]) domainAgg[q.domain] = { score: 0, max: 0 };
    domainAgg[q.domain].score += score;
    domainAgg[q.domain].max += MAX;

    if (q.difficulty === 'hard') {
      hardAgg.score += score;
      hardAgg.max += MAX;
    }
  }

  const pct = (s, m) => (m > 0 ? Math.round((s / m) * 100) : 0);
  const totalPercent = pct(totalScore, totalMax);
  const overallLevel = levelFor(totalPercent, levels);

  // تقارير الكفايات
  const domainReports = Object.keys(domainsMeta).map(code => {
    const agg = domainAgg[code] || { score: 0, max: 0 };
    const percent = pct(agg.score, agg.max);
    const lvl = levelFor(percent, levels);
    return {
      domain_code: code,
      domain_name_ar: domainsMeta[code].name_ar,
      domain_desc_ar: domainsMeta[code].desc_ar,
      score: agg.score,
      max: agg.max,
      percent,
      level_label_ar: lvl.label_ar,
      note_ar: domainNote(domainsMeta[code].name_ar, percent)
    };
  }).sort((a, b) => b.percent - a.percent);

  // أداء الأسئلة الصعبة
  const hardPercent = pct(hardAgg.score, hardAgg.max);
  const hardPerformance = {
    score: hardAgg.score,
    max: hardAgg.max,
    percent: hardPercent,
    label_ar: hardLabel(hardPercent),
    note_ar: hardNote(hardPercent)
  };

  // علم الأخلاقيات
  const ethicsReport = domainReports.find(d => d.domain_code === 'ethics');
  const ethicsThreshold = (data.scoring.ethics_red_flag || {}).min_percent || 50;
  const ethicsRedFlag = !!ethicsReport && ethicsReport.percent < ethicsThreshold;

  // نقاط القوة والفجوات
  const strengths = domainReports.filter(d => d.percent >= 70).map(d => d.domain_name_ar);
  const gaps = domainReports.filter(d => d.percent < 50).map(d => d.domain_name_ar);

  // التوصية
  const recommendation = recommendationFor(overallLevel.code, totalPercent);

  // خطة التطوير
  const developmentPlan = domainReports
    .filter(d => d.percent < 70)
    .map(d => `تعزيز كفاية «${d.domain_name_ar}» (${d.percent}%) عبر تدريب موجّه وحالات عملية.`);
  if (!developmentPlan.length) {
    developmentPlan.push('المستوى متقدّم في جميع الكفايات — يُكتفى بالإشراف الخفيف وإسناد مهام أكثر استقلالية تدريجياً.');
  }

  // الأعلام الحمراء
  const redFlags = [];
  if (ethicsRedFlag) {
    redFlags.push('ضعف في كفاية الأخلاقيات المهنية — يستوجب انتباهاً خاصاً قبل إسناد ملفات حسّاسة.');
  }
  if (hardPercent < 40) {
    redFlags.push('ضعف ملحوظ في الأسئلة الصعبة يدل على صعوبة في التعامل مع المسائل المعقّدة.');
  }

  // الملخّص التنفيذي
  const execSummary =
    `حقّق المرشّح ${totalPercent}% (مستوى «${overallLevel.label_ar}»). ` +
    (strengths.length ? `أبرز قوّته في: ${strengths.join('، ')}. ` : '') +
    (gaps.length ? `وأبرز فجواته في: ${gaps.join('، ')}. ` : '') +
    `أداؤه في الأسئلة الصعبة ${hardPercent}% (${hardPerformance.label_ar}).`;

  return {
    test_id: 'legal',
    test_name_ar: data.test_name_ar,
    total_score: totalScore,
    max_score: totalMax,
    total_percent: totalPercent,
    level: { code: overallLevel.code, label_ar: overallLevel.label_ar, desc_ar: overallLevel.desc_ar },
    domain_reports: domainReports,
    hard_performance: hardPerformance,
    ethics_red_flag: ethicsRedFlag,

    summary_for_employee: {
      headline_ar: `مستواك: ${overallLevel.label_ar}`,
      level_label_ar: overallLevel.label_ar,
      total_percent: totalPercent,
      short_description_ar: 'شكراً لإكمالك الاختبار المعرفي. النتيجة التفصيلية متاحة للإدارة.',
      domains: domainReports.map(d => ({ name_ar: d.domain_name_ar, percent: d.percent }))
    },

    detailed_report_for_admin: {
      executive_summary_ar: execSummary,
      overall_ar: { total_percent: totalPercent, level_label_ar: overallLevel.label_ar, level_desc_ar: overallLevel.desc_ar },
      domain_analysis_ar: domainReports.map(d => ({
        name_ar: d.domain_name_ar, percent: d.percent, level_label_ar: d.level_label_ar, note_ar: d.note_ar
      })),
      hard_questions_ar: { percent: hardPercent, label_ar: hardPerformance.label_ar, note_ar: hardPerformance.note_ar },
      strengths_ar: strengths.length ? strengths : ['لا توجد كفاية بلغت مستوى القوة (70%+).'],
      gaps_ar: gaps.length ? gaps : ['لا توجد فجوات جوهرية (دون 50%).'],
      recommendation_ar: recommendation,
      development_recommendations_ar: developmentPlan,
      red_flags_ar: redFlags.length ? redFlags : ['لا أعلام حمراء.']
    },

    computed_at: new Date().toISOString()
  };
}

// ========== نصوص مساعدة ==========

function domainNote(name, percent) {
  if (percent >= 85) return `إتقان لافت في «${name}».`;
  if (percent >= 70) return `كفاءة جيّدة في «${name}».`;
  if (percent >= 50) return `أداء متوسط في «${name}» يحتمل التطوير.`;
  return `فجوة واضحة في «${name}» تحتاج تأهيلاً.`;
}

function hardLabel(percent) {
  if (percent >= 70) return 'قوي';
  if (percent >= 50) return 'متوسط';
  return 'ضعيف';
}

function hardNote(percent) {
  if (percent >= 70) return 'أداء قوي في المسائل المعقّدة يدل على تفكير قانوني ناضج — مؤشر كفاءة عالية.';
  if (percent >= 50) return 'أداء متوسط في المسائل المعقّدة — قابل للتطوير بالخبرة والإشراف.';
  return 'ضعف في المسائل المعقّدة — يفضّل إسناد مهام متدرّجة الصعوبة مع إشراف لصيق.';
}

function recommendationFor(levelCode, percent) {
  const map = {
    advanced: {
      decision_ar: 'يُوصى بقبوله متدرّباً بثقة',
      intro_ar: 'كفاءة قانونية أساسية لافتة لمستوى متدرّب.',
      items_ar: [
        'أسند له مهاماً أكثر استقلالية مبكراً مع مراجعة المخرجات.',
        'وفّر له تحدّيات نوعية تحفظ دافعيته (قضايا متنوّعة).'
      ]
    },
    competent: {
      decision_ar: 'يُوصى بقبوله متدرّباً',
      intro_ar: 'أساس قانوني جيّد يصلح للبناء عليه.',
      items_ar: [
        'إشراف معتاد مع تغذية راجعة دورية.',
        'ركّز التطوير على الكفايات الأقلّ في تقريره.'
      ]
    },
    promising: {
      decision_ar: 'يُوصى بقبوله مشروطاً ببرنامج تدريبي',
      intro_ar: 'إمكانات واعدة مع فجوات تحتاج معالجة منظّمة.',
      items_ar: [
        'ضع خطة تدريب 60–90 يوماً تستهدف الفجوات المحدّدة.',
        'إشراف لصيق في بداية المهام وتقييم متكرّر.'
      ]
    },
    foundational: {
      decision_ar: 'لا يُوصى بقبوله حالياً قبل تأهيل',
      intro_ar: 'فجوات جوهرية في الأساسيات القانونية.',
      items_ar: [
        'يحتاج تأهيلاً أساسياً قبل إسناد مهام فعلية.',
        'أعد التقييم بعد فترة تدريب مكثّفة إن رغبت في إعطائه فرصة.'
      ]
    }
  };
  return map[levelCode] || map.foundational;
}

module.exports = { analyzeLegal };
