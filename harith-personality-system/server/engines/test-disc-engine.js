/**
 * ============================================================================
 *  اختبار محرك DISC  —  test-disc-engine.js
 * ============================================================================
 *
 *  يشغّل سيناريوهات اختبار شاملة للتأكّد من صحّة عمل المحرك:
 *    1. موظف D خالص (مؤسس/قائد حاسم)
 *    2. موظف I خالص (مطور أعمال)
 *    3. موظف S خالص (داعم مُستقر)
 *    4. موظف C خالص (محلّل دقيق)
 *    5. موظف بنمط مركّب DI (قائد كاريزماتي)
 *    6. موظف متوازن (كل الأنماط متقاربة)
 *    7. تعادل في المركز الأول
 *    8. موظف واقعي (إجابات متنوّعة)
 *    9. فحص التحقّق من المدخلات الخاطئة
 * ============================================================================
 */

const path = require('path');
const { analyzeDISC, STYLES } = require('./disc-engine');

const questionsData = require(path.join(__dirname, '..', '..', 'data', 'disc-questions.json'));
const QUESTIONS = questionsData.questions;

// ========== أدوات توليد إجابات اختبارية ==========

/**
 * يُولّد إجابات "مثالية" لنمط أساسي واحد
 * @param {string} targetStyle — D, I, S, أو C
 * @param {number} strength — 1.0 = متطرّف، 0.5 = معتدل، 0 = محايد
 */
function generateAnswersForStyle(targetStyle, strength = 1.0) {
  const answers = [];
  for (const q of QUESTIONS) {
    // أسئلة النمط المطلوب → 5، والبقية → 1
    const baseAnswer = (q.style === targetStyle) ? 5 : 1;
    const center = 3;
    const diff = baseAnswer - center;
    const scaled = Math.round(center + diff * strength);
    answers.push({ id: q.id, answer: Math.max(1, Math.min(5, scaled)) });
  }
  return answers;
}

/**
 * يُولّد إجابات بنمط مركّب (أساسي + ثانوي)
 * مثال: primary=D, secondary=I → أسئلة D تأخذ 5، أسئلة I تأخذ 4، والبقية 1
 */
function generateCompoundAnswers(primaryStyle, secondaryStyle) {
  const answers = [];
  for (const q of QUESTIONS) {
    let answer;
    if (q.style === primaryStyle) {
      answer = 5;
    } else if (q.style === secondaryStyle) {
      answer = 4;
    } else {
      answer = 1;
    }
    answers.push({ id: q.id, answer });
  }
  return answers;
}

/**
 * يُولّد إجابات متوازنة (كل الأنماط متقاربة)
 */
function generateBalancedAnswers() {
  return QUESTIONS.map(q => ({ id: q.id, answer: 3 }));
}

/**
 * يُولّد إجابات متعادلة تماماً بين نمطين (لاختبار primary_tie)
 */
function generateTiedAnswers(style1, style2) {
  const answers = [];
  for (const q of QUESTIONS) {
    let answer;
    if (q.style === style1 || q.style === style2) {
      answer = 5;
    } else {
      answer = 1;
    }
    answers.push({ id: q.id, answer });
  }
  return answers;
}

/**
 * يُولّد إجابات واقعية لموظف نمطه D مع لمسات من I
 * (محاكاة لإجابات بشرية فعلية متنوّعة)
 */
function generateRealisticAnswers() {
  const answers = [];
  for (const q of QUESTIONS) {
    let answer;
    // موظف D رئيسياً: أسئلة D تُقيَّم 4-5
    if (q.style === 'D') {
      answer = (q.id % 3 === 0) ? 4 : 5;
    }
    // لديه حضور اجتماعي: I تُقيَّم 3-4
    else if (q.style === 'I') {
      answer = (q.id % 2 === 0) ? 4 : 3;
    }
    // محدود الصبر: S تُقيَّم 2
    else if (q.style === 'S') {
      answer = 2;
    }
    // لديه اهتمام معتدل بالتفاصيل: C تُقيَّم 3
    else {
      answer = 3;
    }
    answers.push({ id: q.id, answer });
  }
  return answers;
}

// ========== أدوات طباعة التقارير ==========

function printSeparator(title) {
  console.log('\n' + '='.repeat(72));
  console.log('  ' + title);
  console.log('='.repeat(72));
}

function printSubSeparator(title) {
  console.log('\n' + '-'.repeat(72));
  console.log('  ' + title);
  console.log('-'.repeat(72));
}

function printResult(result, label) {
  printSubSeparator(label);
  console.log(`النمط الأساسي:  ${result.primary_style} — ${result.primary_profile.style_name_ar} (${result.primary_info.percent}%)`);
  if (result.secondary_style) {
    console.log(`النمط الثانوي:  ${result.secondary_style} — ${result.secondary_profile.style_name_ar} (${result.secondary_info.percent}%)`);
    console.log(`الكود المركّب:  ${result.compound_code}`);
  } else {
    console.log(`النمط الثانوي:  (لا يوجد — النمط الأساسي مهيمن)`);
    console.log(`الكود المركّب:  ${result.compound_code}`);
  }
  console.log(`هيمنة النمط:   ${result.dominance.label_ar} (فارق ${result.dominance.gap_value} من بقية الأنماط)`);
  console.log(`تعادل أول:      ${result.primary_tie ? 'نعم ⚠️' : 'لا'}`);
  console.log('');
  console.log('ترتيب الأنماط:');
  result.ranking.forEach((r, idx) => {
    const bar = '█'.repeat(Math.round(r.percent / 5));
    console.log(
      `  ${idx + 1}. ${r.style_code} (${String(r.percent).padStart(3)}%): ${bar} — ${r.style_name_ar}`
    );
  });
}

// ========== السيناريوهات ==========

printSeparator('اختبار شامل لمحرك DISC');
console.log(`عدد الأسئلة في قاعدة البيانات: ${QUESTIONS.length}`);
console.log(`الأنماط الأربعة: ${STYLES.join(', ')}`);

let passCount = 0;
let failCount = 0;

function assertEqual(actual, expected, testName) {
  if (actual === expected) {
    console.log(`  ✅ ${testName}`);
    passCount++;
  } else {
    console.log(`  ❌ ${testName} — توقّع: ${expected}، حصل: ${actual}`);
    failCount++;
  }
}

// ---- 1-4: الأنماط الأربعة الأصيلة ----
for (const style of STYLES) {
  printSeparator(`السيناريو: موظف ${style} خالص (متطرّف)`);
  const answers = generateAnswersForStyle(style, 1.0);
  const result = analyzeDISC(answers);
  printResult(result, 'النتيجة');
  assertEqual(result.primary_style, style, `النمط الأساسي هو ${style}`);
  assertEqual(result.primary_info.percent, 100, 'النسبة المئوية = 100%');
  assertEqual(result.dominance.code, 'DOMINANT', 'قوّة الهيمنة = مُهيمن');
}

// ---- 5: نمط مركّب DI ----
printSeparator('السيناريو: نمط مركّب DI (قائد كاريزماتي)');
const diAnswers = generateCompoundAnswers('D', 'I');
const diResult = analyzeDISC(diAnswers);
printResult(diResult, 'النتيجة');
assertEqual(diResult.primary_style, 'D', 'النمط الأساسي = D');
assertEqual(diResult.secondary_style, 'I', 'النمط الثانوي = I');
assertEqual(diResult.compound_code, 'DI', 'الكود المركّب = DI');

// ---- 5b: نمط مركّب SC ----
printSeparator('السيناريو: نمط مركّب SC (مساند منهجي)');
const scAnswers = generateCompoundAnswers('S', 'C');
const scResult = analyzeDISC(scAnswers);
printResult(scResult, 'النتيجة');
assertEqual(scResult.primary_style, 'S', 'النمط الأساسي = S');
assertEqual(scResult.secondary_style, 'C', 'النمط الثانوي = C');

// ---- 6: موظف متوازن ----
printSeparator('السيناريو: موظف متوازن تماماً (كل الإجابات = 3)');
const balancedResult = analyzeDISC(generateBalancedAnswers());
printResult(balancedResult, 'النتيجة');
// كل الأنماط ستأخذ 50%، والترتيب سيكون أبجدياً تقريباً
assertEqual(balancedResult.primary_info.percent, 50, 'كل نمط = 50%');
assertEqual(balancedResult.dominance.code, 'BALANCED', 'الهيمنة = متوازن');
assertEqual(balancedResult.primary_tie, true, 'تعادل في المركز الأول');
assertEqual(balancedResult.secondary_style !== null, true, 'يوجد نمط ثانوي (الفارق 0%)');

// ---- 7: تعادل تام بين D و I ----
printSeparator('السيناريو: تعادل تام بين D و I');
const tiedResult = analyzeDISC(generateTiedAnswers('D', 'I'));
printResult(tiedResult, 'النتيجة');
assertEqual(tiedResult.primary_tie, true, 'تعادل في المركز الأول');
const primaryCode = tiedResult.primary_style;
assertEqual(['D', 'I'].includes(primaryCode), true, 'الأساسي هو D أو I');
assertEqual(tiedResult.primary_info.percent, 100, 'الأساسي = 100%');
assertEqual(tiedResult.secondary_info.percent, 100, 'الثانوي = 100%');

// ---- 8: إجابات واقعية لموظف D-I ----
printSeparator('السيناريو: موظف بإجابات واقعية متنوّعة (نمط D مع لمسات I)');
const realisticResult = analyzeDISC(generateRealisticAnswers());
printResult(realisticResult, 'النتيجة');
assertEqual(realisticResult.primary_style, 'D', 'النمط الأساسي = D');

// ---- 9: فحص التحقّق من المدخلات ----
printSeparator('السيناريو: فحص التحقّق من المدخلات الخاطئة');

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
  () => analyzeDISC([{ id: 1, answer: 3 }]),
  'رفض مصفوفة إجابات ناقصة'
);

expectError(
  () => {
    const bad = generateBalancedAnswers();
    bad[0].answer = 7;
    analyzeDISC(bad);
  },
  'رفض قيمة إجابة خارج النطاق (7)'
);

expectError(
  () => {
    const bad = generateBalancedAnswers();
    bad[0].answer = 0;
    analyzeDISC(bad);
  },
  'رفض قيمة صفر'
);

expectError(
  () => {
    const bad = generateBalancedAnswers();
    bad[0].id = 999;
    analyzeDISC(bad);
  },
  'رفض معرّف سؤال غير موجود'
);

expectError(
  () => {
    const bad = generateBalancedAnswers();
    bad[5].id = bad[0].id;
    analyzeDISC(bad);
  },
  'رفض إجابة مُكرّرة'
);

expectError(
  () => analyzeDISC(null),
  'رفض قيمة null'
);

// ---- 10: فحص تحميل جميع الأنماط الأربعة ----
printSeparator('فحص تحميل ملفات التفسير للأنماط الأربعة');
for (const style of STYLES) {
  const answers = generateAnswersForStyle(style, 1.0);
  const result = analyzeDISC(answers);
  const profile = result.primary_profile;
  const hasBasicFields = !!(profile.style_code && profile.style_name_ar && profile.tagline_ar);
  console.log(`  ${style}: ${profile.style_name_ar} — ${profile.tagline_ar}`);
  assertEqual(hasBasicFields, true, `تحميل ملف ${style} بالحقول الأساسية`);
}

// ---- 11: تقرير إداري نموذجي ----
printSeparator('تقرير إداري نموذجي (موظف D-I)');
const adminReport = diResult;
console.log(`  Test ID:        ${adminReport.test_id}`);
console.log(`  الاختبار:        ${adminReport.test_name_ar}`);
console.log(`  النمط الأساسي:   ${adminReport.primary_style} — ${adminReport.primary_profile.style_name_ar}`);
console.log(`  التاجلاين:       ${adminReport.primary_profile.tagline_ar}`);
console.log(`  النمط الثانوي:   ${adminReport.secondary_style}`);
console.log(`  الكود المركّب:   ${adminReport.compound_code}`);
console.log(`  الهيمنة:        ${adminReport.dominance.label_ar} (${adminReport.dominance.description_ar})`);
console.log(`  نقاط القوّة الأساسية:`);
adminReport.primary_profile.summary_for_employee.top_strengths_ar.slice(0, 3).forEach(s => {
  console.log(`    • ${s}`);
});
console.log(`  وقت الحساب:     ${adminReport.computed_at}`);

// ---- النهاية ----
printSeparator('خلاصة نتائج الاختبار');
console.log(`  ✅ ناجح: ${passCount}`);
console.log(`  ❌ فاشل: ${failCount}`);
console.log(`  المجموع: ${passCount + failCount}`);

if (failCount === 0) {
  console.log('\n🎉 جميع الاختبارات نجحت! المحرك جاهز للاستخدام.\n');
  process.exit(0);
} else {
  console.log('\n⚠️ بعض الاختبارات فشلت — يحتاج الكود لمراجعة.\n');
  process.exit(1);
}
