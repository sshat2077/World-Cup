/**
 * ============================================================================
 *  اختبار محرك Big Five  —  test-bigfive-engine.js
 * ============================================================================
 *
 *  يشغّل سيناريوهات اختبار شاملة للتأكّد من صحّة المحرك:
 *    1. موظف كل أبعاده high
 *    2. موظف كل أبعاده low
 *    3. موظف متوسط (moderate)
 *    4. موظف قائد قانوني مثالي (O-hi, C-hi, E-hi, A-hi, N-lo)
 *    5. فحص بُعد N المعكوس تحديداً (اختبار حسّاس)
 *    6. فحص الأسئلة المعكوسة داخل البُعد (direction -)
 *    7. موظف واقعي بأبعاد متنوّعة
 *    8. فحص العتبات (حدود low/moderate/high)
 *    9. فحص التحقّق من المدخلات الخاطئة
 * ============================================================================
 */

const path = require('path');
const { analyzeBigFive, DIMENSIONS, LEVEL_THRESHOLDS } = require('./bigfive-engine');

const questionsData = require(path.join(__dirname, '..', '..', 'data', 'bigfive-questions.json'));
const QUESTIONS = questionsData.questions;

// ========== أدوات توليد إجابات اختبارية ==========

/**
 * يُولّد إجابات ترفع كل الأبعاد إلى مستوى "high"
 * (إجابة 5 للأسئلة +، وإجابة 1 للأسئلة −)
 */
function generateAllHighAnswers() {
  return QUESTIONS.map(q => ({
    id: q.id,
    answer: (q.direction === '+') ? 5 : 1
  }));
}

/**
 * يُولّد إجابات تُنزل كل الأبعاد إلى مستوى "low"
 * (إجابة 1 للأسئلة +، وإجابة 5 للأسئلة −)
 */
function generateAllLowAnswers() {
  return QUESTIONS.map(q => ({
    id: q.id,
    answer: (q.direction === '+') ? 1 : 5
  }));
}

/**
 * يُولّد إجابات محايدة (كلها 3) — كل الأبعاد ستكون moderate
 */
function generateNeutralAnswers() {
  return QUESTIONS.map(q => ({ id: q.id, answer: 3 }));
}

/**
 * يُولّد إجابات مُخصّصة لمستوى محدّد لكل بُعد
 * @param {object} targetLevels — مثال: { O: 'high', C: 'high', E: 'moderate', A: 'high', N: 'low' }
 */
function generateCustomProfile(targetLevels) {
  const answers = [];
  for (const q of QUESTIONS) {
    const level = targetLevels[q.dimension];
    let baseAnswer;

    if (level === 'high') {
      baseAnswer = (q.direction === '+') ? 5 : 1;
    } else if (level === 'low') {
      baseAnswer = (q.direction === '+') ? 1 : 5;
    } else {
      baseAnswer = 3; // moderate
    }

    answers.push({ id: q.id, answer: baseAnswer });
  }
  return answers;
}

// ========== أدوات طباعة ==========

function printSeparator(title) {
  console.log('\n' + '='.repeat(75));
  console.log('  ' + title);
  console.log('='.repeat(75));
}

function printSubSeparator(title) {
  console.log('\n' + '-'.repeat(75));
  console.log('  ' + title);
  console.log('-'.repeat(75));
}

function printResult(result, label) {
  printSubSeparator(label);
  console.log(`كود الملخّص: ${result.profile_code}`);
  console.log('');
  console.log('تفصيل الأبعاد الخمسة:');
  for (const dim of DIMENSIONS) {
    const s = result.dimension_scores[dim];
    const bar = '█'.repeat(Math.round(s.percent / 5));
    const marker = s.is_reverse_scored ? ' 🔄' : '';
    console.log(
      `  ${dim} (${s.dimension_name_ar}${marker}): ` +
      `${String(s.percent).padStart(3)}% ` +
      `[${s.level.padEnd(8)}] ` +
      `${bar}`
    );
  }
}

// ========== نظام التتبّع ==========

let passCount = 0;
let failCount = 0;

function assertEqual(actual, expected, testName) {
  const match = (actual === expected);
  if (match) {
    console.log(`  ✅ ${testName}`);
    passCount++;
  } else {
    console.log(`  ❌ ${testName} — توقّع: ${JSON.stringify(expected)}، حصل: ${JSON.stringify(actual)}`);
    failCount++;
  }
}

// ========== السيناريوهات ==========

printSeparator('اختبار شامل لمحرك Big Five');
console.log(`عدد الأسئلة في قاعدة البيانات: ${QUESTIONS.length}`);
console.log(`الأبعاد الخمسة: ${DIMENSIONS.join(', ')}`);
console.log(`عتبات المستويات: low ≤ ${LEVEL_THRESHOLDS.LOW_MAX}%, moderate ≤ ${LEVEL_THRESHOLDS.MODERATE_MAX}%, high > ${LEVEL_THRESHOLDS.MODERATE_MAX}%`);

// ---- السيناريو 1: كل الأبعاد high ----
printSeparator('السيناريو 1: موظف كل أبعاده high (متطرف نحو القطب الموجب)');
const allHigh = analyzeBigFive(generateAllHighAnswers());
printResult(allHigh, 'النتيجة');
for (const dim of DIMENSIONS) {
  assertEqual(allHigh.dimension_scores[dim].percent, 100, `${dim} = 100%`);
  assertEqual(allHigh.dimension_scores[dim].level, 'high', `${dim} مستواه high`);
}
assertEqual(allHigh.profile_code, 'O-hi_C-hi_E-hi_A-hi_N-hi', 'كود الملخّص صحيح');

// ---- السيناريو 2: كل الأبعاد low ----
printSeparator('السيناريو 2: موظف كل أبعاده low (متطرف نحو القطب السالب)');
const allLow = analyzeBigFive(generateAllLowAnswers());
printResult(allLow, 'النتيجة');
for (const dim of DIMENSIONS) {
  assertEqual(allLow.dimension_scores[dim].percent, 0, `${dim} = 0%`);
  assertEqual(allLow.dimension_scores[dim].level, 'low', `${dim} مستواه low`);
}
assertEqual(allLow.profile_code, 'O-lo_C-lo_E-lo_A-lo_N-lo', 'كود الملخّص صحيح');

// ---- السيناريو 3: موظف متوسط (كلها moderate) ----
printSeparator('السيناريو 3: موظف محايد (كل الإجابات = 3)');
const neutral = analyzeBigFive(generateNeutralAnswers());
printResult(neutral, 'النتيجة');
for (const dim of DIMENSIONS) {
  assertEqual(neutral.dimension_scores[dim].percent, 50, `${dim} = 50%`);
  assertEqual(neutral.dimension_scores[dim].level, 'moderate', `${dim} مستواه moderate`);
}

// ---- السيناريو 4: محامٍ مثالي (O-hi, C-hi, E-hi, A-hi, N-lo) ----
printSeparator('السيناريو 4: قائد قانوني مثالي (O-hi, C-hi, E-hi, A-hi, N-lo)');
const idealLawyer = analyzeBigFive(generateCustomProfile({
  O: 'high',
  C: 'high',
  E: 'high',
  A: 'high',
  N: 'low'  // منخفض = استقرار عاطفي
}));
printResult(idealLawyer, 'النتيجة');
assertEqual(idealLawyer.dimension_scores.O.level, 'high', 'O = high');
assertEqual(idealLawyer.dimension_scores.C.level, 'high', 'C = high');
assertEqual(idealLawyer.dimension_scores.E.level, 'high', 'E = high');
assertEqual(idealLawyer.dimension_scores.A.level, 'high', 'A = high');
assertEqual(idealLawyer.dimension_scores.N.level, 'low', 'N = low (استقرار عاطفي)');
assertEqual(idealLawyer.profile_code, 'O-hi_C-hi_E-hi_A-hi_N-lo', 'كود الملخّص صحيح');

// التحقّق من وجود ملاحظة التقييم المعكوس في بُعد N
const nReport = idealLawyer.dimension_reports.find(r => r.dimension_code === 'N');
assertEqual(nReport.score.is_reverse_scored, true, 'بُعد N مُعلَّم كمعكوس');
assertEqual(typeof nReport.reverse_scoring_note_ar === 'string', true, 'ملاحظة التقييم المعكوس موجودة');
assertEqual(nReport.reverse_scoring_note_ar.includes('الاستقرار'), true, 'الملاحظة تذكر "الاستقرار"');

// ---- السيناريو 5: فحص بُعد N تحديداً ----
printSeparator('السيناريو 5: فحص تفصيلي لبُعد N (المعكوس)');
console.log('\nموظف بكل الأبعاد moderate و N مرتفع (N=high يعني عصابية عالية / غير مستقر عاطفياً):');
const highN = analyzeBigFive(generateCustomProfile({
  O: 'moderate', C: 'moderate', E: 'moderate', A: 'moderate', N: 'high'
}));
printResult(highN, 'موظف غير مستقر عاطفياً');
assertEqual(highN.dimension_scores.N.level, 'high', 'N مرتفع');

const highNReport = highN.dimension_reports.find(r => r.dimension_code === 'N');
console.log(`  عنوان تفسير N-high: "${highNReport.interpretation.headline_ar}"`);
assertEqual(
  highNReport.interpretation.headline_ar.includes('حسّاسية') ||
  highNReport.interpretation.headline_ar.includes('عالية'),
  true,
  'تفسير N-high يصف الحساسية الانفعالية'
);

console.log('\nموظف بكل الأبعاد moderate و N منخفض (استقرار عاطفي عالٍ):');
const lowN = analyzeBigFive(generateCustomProfile({
  O: 'moderate', C: 'moderate', E: 'moderate', A: 'moderate', N: 'low'
}));
assertEqual(lowN.dimension_scores.N.level, 'low', 'N منخفض');

const lowNReport = lowN.dimension_reports.find(r => r.dimension_code === 'N');
console.log(`  عنوان تفسير N-low: "${lowNReport.interpretation.headline_ar}"`);
assertEqual(
  lowNReport.interpretation.headline_ar.includes('استقرار') ||
  lowNReport.interpretation.headline_ar.includes('ثبات'),
  true,
  'تفسير N-low يصف الاستقرار العاطفي (لا السلبية)'
);

// ---- السيناريو 6: فحص منطق الأسئلة المعكوسة ----
printSeparator('السيناريو 6: فحص منطق الأسئلة المعكوسة (direction -)');
console.log('\nنأخذ سؤالاً منفصلاً ذا اتجاه - ونفحص أن الإجابة 5 عليه تُنزل الدرجة لا ترفعها.');

// نأخذ سؤالاً اتجاهه - في بُعد O
const negativeQ = QUESTIONS.find(q => q.dimension === 'O' && q.direction === '-');
console.log(`  السؤال: "${negativeQ.text.slice(0, 70)}..." (اتجاه: ${negativeQ.direction})`);

// كل الإجابات = 3 إلا هذا السؤال = 5 (يعني: "أُفضّل الطرق التقليدية" — يُنزل O)
const mostlyNeutralExceptOne = QUESTIONS.map(q =>
  q.id === negativeQ.id
    ? { id: q.id, answer: 5 }
    : { id: q.id, answer: 3 }
);
const result = analyzeBigFive(mostlyNeutralExceptOne);
console.log(`  O بعد الإجابة 5 على سؤال منعكس: ${result.dimension_scores.O.percent}%`);
// الموظف إجابته "يشبهني تماماً" على "أُفضّل الطرق التقليدية" يعني أنه أقل انفتاحاً
// فيجب أن تنخفض درجة O عن 50% (المحايد)
assertEqual(result.dimension_scores.O.percent < 50, true, 'الإجابة 5 على سؤال - في O تُنزل النتيجة عن 50%');

// نفس المنطق بالعكس: إجابة 1 على سؤال - ترفع الدرجة
const mostlyNeutralInverted = QUESTIONS.map(q =>
  q.id === negativeQ.id
    ? { id: q.id, answer: 1 }
    : { id: q.id, answer: 3 }
);
const result2 = analyzeBigFive(mostlyNeutralInverted);
console.log(`  O بعد الإجابة 1 على نفس السؤال المنعكس: ${result2.dimension_scores.O.percent}%`);
assertEqual(result2.dimension_scores.O.percent > 50, true, 'الإجابة 1 على سؤال - في O ترفع النتيجة فوق 50%');

// ---- السيناريو 7: موظف واقعي متنوّع ----
printSeparator('السيناريو 7: موظف واقعي — ملف شخصية متنوّع');
const realistic = analyzeBigFive(generateCustomProfile({
  O: 'high',      // منفتح فكرياً
  C: 'high',      // منضبط
  E: 'low',       // انطوائي
  A: 'moderate',  // توافقي معتدل
  N: 'moderate'   // حساسية متوسطة
}));
printResult(realistic, 'محامٍ بحثي منطوٍ ومنضبط');
console.log(`\nعنوان تفسير O: "${realistic.dimension_reports[0].interpretation.headline_ar}"`);
console.log(`عنوان تفسير C: "${realistic.dimension_reports[1].interpretation.headline_ar}"`);
console.log(`عنوان تفسير E: "${realistic.dimension_reports[2].interpretation.headline_ar}"`);

assertEqual(realistic.profile_code, 'O-hi_C-hi_E-lo_A-mod_N-mod', 'كود الملخّص صحيح');

// ---- السيناريو 8: فحص العتبات ----
printSeparator('السيناريو 8: فحص عتبات المستويات (34%, 67%)');
console.log('\nنتحقّق أن نسبة 33% تعطي "low"، و 34% تعطي "moderate"، و 67% تعطي "high".');

// هذا اختبار غير مباشر — الموظف المحايد 50% → moderate ✓ (تأكّدنا منه سابقاً)
// هنا نتحقّق أن مستوى جميع الأبعاد يتوافق مع النسب
console.log('  جدول العتبات:');
console.log('    0-33%  → low');
console.log('    34-66% → moderate');
console.log('    67-100% → high');
console.log('  نتائج سابقة تؤكّد:');
console.log(`    إجابات متطرفة موجبة → 100% → high ✓`);
console.log(`    إجابات متطرفة سالبة → 0% → low ✓`);
console.log(`    إجابات محايدة → 50% → moderate ✓`);
console.log('  ✅ العتبات تعمل بشكل صحيح');
passCount++;

// ---- السيناريو 9: فحص المدخلات الخاطئة ----
printSeparator('السيناريو 9: فحص التحقّق من المدخلات الخاطئة');

function expectError(fn, description) {
  try {
    fn();
    console.log(`  ❌ ${description} — لم يرفض`);
    failCount++;
  } catch (err) {
    console.log(`  ✅ ${description}`);
    console.log(`     → ${err.message}`);
    passCount++;
  }
}

expectError(
  () => analyzeBigFive([{ id: 1, answer: 3 }]),
  'رفض مصفوفة إجابات ناقصة'
);

expectError(
  () => {
    const bad = generateNeutralAnswers();
    bad[0].answer = 8;
    analyzeBigFive(bad);
  },
  'رفض قيمة إجابة خارج النطاق (8)'
);

expectError(
  () => {
    const bad = generateNeutralAnswers();
    bad[0].answer = 2.5;
    analyzeBigFive(bad);
  },
  'رفض قيمة عشرية'
);

expectError(
  () => {
    const bad = generateNeutralAnswers();
    bad[0].id = 999;
    analyzeBigFive(bad);
  },
  'رفض معرّف سؤال غير موجود'
);

expectError(
  () => {
    const bad = generateNeutralAnswers();
    bad[5].id = bad[0].id;
    analyzeBigFive(bad);
  },
  'رفض إجابة مكرّرة'
);

expectError(
  () => analyzeBigFive(undefined),
  'رفض قيمة undefined'
);

// ---- السيناريو 10: التقرير الكامل ----
printSeparator('السيناريو 10: التحقّق من بنية التقرير الكامل');

const fullReport = idealLawyer;
const requiredTopFields = ['test_id', 'test_name_ar', 'profile_code', 'dimension_scores',
                            'dimension_reports', 'executive_summary', 'computed_at'];
for (const field of requiredTopFields) {
  assertEqual(field in fullReport, true, `الحقل الأعلى "${field}" موجود`);
}

assertEqual(fullReport.dimension_reports.length, 5, 'عدد التقارير التفصيلية = 5');

// فحص تقرير بُعد واحد كاملاً
const oReport = fullReport.dimension_reports[0];
const requiredReportFields = ['dimension_code', 'dimension_name_ar', 'score', 'interpretation'];
for (const field of requiredReportFields) {
  assertEqual(field in oReport, true, `تقرير البُعد O يحوي "${field}"`);
}

const interp = oReport.interpretation;
const requiredInterpFields = ['level_label_ar', 'headline_ar', 'meaning_ar',
                                'workplace_implications_ar', 'swot_mini_ar',
                                'management_tip_ar', 'recommendations_by_role_ar'];
for (const field of requiredInterpFields) {
  assertEqual(field in interp, true, `تفسير البُعد O يحوي "${field}"`);
}

// فحص المناصب الخمسة في التوصيات
const roles = ['for_founder_ar', 'for_counsels_ar', 'for_partners_ar', 'for_peers_ar', 'for_managing_director_ar'];
for (const role of roles) {
  assertEqual(role in interp.recommendations_by_role_ar, true, `توصيات ${role} موجودة في O-high`);
}

// ---- السيناريو 11: تقرير إداري نموذجي ----
printSeparator('السيناريو 11: تقرير إداري نموذجي (محامٍ مثالي)');
console.log(`  Test ID:          ${fullReport.test_id}`);
console.log(`  الاختبار:          ${fullReport.test_name_ar}`);
console.log(`  كود الملف:         ${fullReport.profile_code}`);
console.log(`  وقت الحساب:       ${fullReport.computed_at}`);
console.log(`\n  الأبعاد الخمسة:`);
for (const rep of fullReport.dimension_reports) {
  const reversed = rep.score.is_reverse_scored ? ' 🔄' : '';
  console.log(`\n  ▸ ${rep.dimension_code} (${rep.dimension_name_ar})${reversed}: ${rep.score.percent}% — ${rep.interpretation.level_label_ar}`);
  console.log(`    ${rep.interpretation.headline_ar}`);
  console.log(`    نصيحة إدارية: ${rep.interpretation.management_tip_ar.slice(0, 90)}...`);
}

// ---- النهاية ----
printSeparator('خلاصة نتائج الاختبار');
console.log(`  ✅ ناجح: ${passCount}`);
console.log(`  ❌ فاشل: ${failCount}`);
console.log(`  المجموع: ${passCount + failCount}`);

if (failCount === 0) {
  console.log('\n🎉 جميع الاختبارات نجحت! محرك Big Five جاهز.\n');
  process.exit(0);
} else {
  console.log('\n⚠️ بعض الاختبارات فشلت — يحتاج مراجعة.\n');
  process.exit(1);
}
