/**
 *  اختبار وحدة — محرّك الاختبار المعرفي
 */
const { analyzeLegal } = require('./legal-engine');
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'legal-trainee-questions.json'), 'utf8'));
const Q = data.questions;

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg); }
}

// مساعد: يبني إجابات تختار الخيار ذا الدرجة المطلوبة لكل سؤال
function answersByScore(targetScore) {
  return Q.map(q => {
    // اختر الخيار الأقرب للدرجة المطلوبة
    let best = q.options[0];
    for (const o of q.options) {
      if (Math.abs(o.score - targetScore) < Math.abs(best.score - targetScore)) best = o;
    }
    return { id: q.id, answer: best.id };
  });
}
// إجابات مثالية (أعلى درجة لكل سؤال)
function perfectAnswers() {
  return Q.map(q => ({ id: q.id, answer: q.options.reduce((a, b) => (b.score > a.score ? b : a)).id }));
}
// أسوأ إجابات (أدنى درجة)
function worstAnswers() {
  return Q.map(q => ({ id: q.id, answer: q.options.reduce((a, b) => (b.score < a.score ? b : a)).id }));
}

console.log('\n──── 1. إجابات مثالية → 100% متقدّم ────');
let r = analyzeLegal(perfectAnswers());
assert(r.total_percent === 100, 'النسبة = 100% (كانت ' + r.total_percent + ')');
assert(r.level.code === 'advanced', 'المستوى = متقدّم');
assert(r.ethics_red_flag === false, 'لا علم أحمر للأخلاقيات');
assert(r.hard_performance.percent === 100, 'أداء الأسئلة الصعبة = 100%');
assert(r.recommendation_check === undefined && r.detailed_report_for_admin.recommendation_ar.decision_ar.includes('بثقة'), 'التوصية: قبول بثقة');

console.log('\n──── 2. أسوأ إجابات → يحتاج أساسات + أعلام ────');
r = analyzeLegal(worstAnswers());
assert(r.total_percent < 50, 'النسبة < 50% (' + r.total_percent + ')');
assert(r.level.code === 'foundational', 'المستوى = يحتاج أساسات');
assert(r.ethics_red_flag === true, 'علم أحمر للأخلاقيات مُفعّل');
assert(r.detailed_report_for_admin.red_flags_ar.length >= 1, 'توجد أعلام حمراء');

console.log('\n──── 3. بنية النتيجة ────');
r = analyzeLegal(perfectAnswers());
assert(r.test_id === 'legal', 'test_id = legal');
assert(r.test_name_ar === 'الاختبار المعرفي', 'الاسم = الاختبار المعرفي');
assert(Array.isArray(r.domain_reports) && r.domain_reports.length === 5, '5 كفايات في التقرير');
assert(r.domain_reports.every(d => 'percent' in d && 'level_label_ar' in d), 'كل كفاية فيها نسبة ومستوى');
assert(r.summary_for_employee && r.summary_for_employee.domains.length === 5, 'ملخّص الموظف فيه 5 كفايات');
assert(!JSON.stringify(r).includes('rationale'), 'النتيجة لا تكشف التعليلات (rationale)');
assert(!JSON.stringify(r).includes('legal_ref'), 'النتيجة لا تكشف المراجع (legal_ref)');

console.log('\n──── 4. أسئلة بلا إجابة → صفر دون انهيار ────');
r = analyzeLegal([]);
assert(r.total_percent === 0, 'نسبة 0% عند عدم الإجابة');
assert(r.level.code === 'foundational', 'المستوى = يحتاج أساسات');

console.log('\n──── 5. أخلاقيات ممتازة وبقية ضعيفة → لا علم أخلاقيات ────');
const mixed = Q.map(q => {
  if (q.domain === 'ethics') return { id: q.id, answer: q.options.reduce((a, b) => (b.score > a.score ? b : a)).id };
  return { id: q.id, answer: q.options.reduce((a, b) => (b.score < a.score ? b : a)).id };
});
r = analyzeLegal(mixed);
assert(r.ethics_red_flag === false, 'لا علم أحمر عند تفوّق الأخلاقيات');

console.log('\n======================================================================');
console.log('  الخلاصة: ✅ ' + pass + ' ناجح   ❌ ' + fail + ' فاشل');
console.log('======================================================================');
process.exit(fail ? 1 : 0);
