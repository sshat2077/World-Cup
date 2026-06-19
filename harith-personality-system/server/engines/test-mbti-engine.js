/**
 * ============================================================================
 *  اختبار محرك MBTI  —  test-mbti-engine.js
 * ============================================================================
 *
 *  يشغّل أربعة سيناريوهات اختبار للتأكّد من صحّة عمل المحرك:
 *    1. موظف INTJ واضح (إجابات قوية في اتّجاه واحد لكل محور)
 *    2. موظف ESFP واضح (إجابات معاكسة تماماً للسيناريو الأول)
 *    3. موظف متوازن (إجابات قريبة من منتصف كل محور)
 *    4. فحص التحقّق من المدخلات الخاطئة
 * ============================================================================
 */

const path = require('path');
const { analyzeMBTI, AXES } = require('./mbti-engine');

// تحميل الأسئلة لمعرفة ما نستجيب له
const questionsData = require(path.join(__dirname, '..', '..', 'data', 'mbti-questions.json'));
const QUESTIONS = questionsData.questions;

// ========== أدوات توليد إجابات اختبارية ==========

/**
 * يُولّد إجابات "مثالية" لنمط معيّن
 * مثال: لتوليد إجابات INTJ:
 *   - EI: نريد I (سالب) → إجابات السؤال ذي اتجاه + = 1 (ضد E)، وذي اتجاه - = 5 (مع I)
 *   - SN: نريد N (موجب) → إجابات السؤال + = 5، و - = 1
 *   - TF: نريد T (سالب) → + = 1، و - = 5
 *   - JP: نريد J (سالب) → + = 1، و - = 5
 *
 * @param {string} targetType — كود النمط المطلوب (مثال: "INTJ")
 * @param {number} strength — قوّة الإجابة (1 = إجابة متطرّفة، 0.5 = معتدلة، 0 = محايد)
 */
function generateAnswersForType(targetType, strength = 1.0) {
  const [ei, sn, tf, jp] = targetType.split('');
  const targets = { EI: ei, SN: sn, TF: tf, JP: jp };

  const answers = [];
  for (const q of QUESTIONS) {
    const axis = questionsData.axes[q.axis];
    const target = targets[q.axis];

    // هل القطب الموجب هو المطلوب؟
    const wantPositive = (target === axis.positive);

    // الإجابة الأساسية
    // wantPositive && direction '+'  →  5  (يشبهني تماماً)
    // wantPositive && direction '-'  →  1  (لا يشبهني إطلاقاً)
    // !wantPositive && direction '+' →  1
    // !wantPositive && direction '-' →  5
    let baseAnswer;
    if ((wantPositive && q.direction === '+') || (!wantPositive && q.direction === '-')) {
      baseAnswer = 5;
    } else {
      baseAnswer = 1;
    }

    // تطبيق درجة القوّة (strength): كلما قلّت، اقتربت الإجابة من 3
    // strength 1.0 → 5 أو 1
    // strength 0.5 → 4 أو 2
    // strength 0.0 → 3 (محايد)
    const center = 3;
    const diff = baseAnswer - center;
    const scaled = Math.round(center + diff * strength);

    answers.push({ id: q.id, answer: Math.max(1, Math.min(5, scaled)) });
  }

  return answers;
}

/**
 * يُولّد إجابات محايدة (كلها = 3) — لاختبار التعادل
 */
function generateNeutralAnswers() {
  return QUESTIONS.map(q => ({ id: q.id, answer: 3 }));
}

// ========== أدوات طباعة التقارير ==========

function printSeparator(title) {
  console.log('\n' + '='.repeat(70));
  console.log('  ' + title);
  console.log('='.repeat(70));
}

function printSubSeparator(title) {
  console.log('\n' + '-'.repeat(70));
  console.log('  ' + title);
  console.log('-'.repeat(70));
}

function printResult(result, label) {
  printSubSeparator(label);
  console.log(`النمط الناتج:  ${result.type_code}`);
  console.log(`اسم النمط:    ${result.type_profile.type_name_ar || result.type_profile.style_name_ar || '-'}`);
  console.log(`تعادلات:     ${result.has_ties ? 'نعم — ' + result.tied_axes.join(', ') : 'لا'}`);
  console.log('');
  console.log('تفصيل التفضيلات:');
  for (const axis of AXES) {
    const p = result.preferences[axis];
    const tie = p.is_tie ? ' ⚠️ تعادل' : '';
    console.log(
      `  ${axis}: ${p.chosen_pole}  ` +
      `(خام: ${String(p.raw_score).padStart(4)}/${p.max_possible}، ` +
      `قوّة: ${String(p.strength_percent).padStart(3)}% — ${p.strength.label_ar})${tie}`
    );
  }
}

// ========== السيناريوهات ==========

printSeparator('اختبار شامل لمحرك MBTI');
console.log(`عدد الأسئلة في قاعدة البيانات: ${QUESTIONS.length}`);
console.log(`المحاور الأربعة: ${AXES.join(', ')}`);

// ---- السيناريو 1: INTJ واضح ----
printSeparator('السيناريو 1: موظف INTJ واضح (إجابات متطرفة)');
const intjAnswers = generateAnswersForType('INTJ', 1.0);
const intjResult = analyzeMBTI(intjAnswers);
printResult(intjResult, 'النتيجة');

if (intjResult.type_code !== 'INTJ') {
  console.error('❌ فشل: النتيجة ' + intjResult.type_code + ' بينما المتوقع INTJ');
  process.exit(1);
}
console.log('\n✅ نجح — النتيجة مطابقة للمتوقع INTJ');

// ---- السيناريو 2: ESFP واضح ----
printSeparator('السيناريو 2: موظف ESFP واضح (معاكس تماماً للسيناريو 1)');
const esfpAnswers = generateAnswersForType('ESFP', 1.0);
const esfpResult = analyzeMBTI(esfpAnswers);
printResult(esfpResult, 'النتيجة');

if (esfpResult.type_code !== 'ESFP') {
  console.error('❌ فشل: النتيجة ' + esfpResult.type_code + ' بينما المتوقع ESFP');
  process.exit(1);
}
console.log('\n✅ نجح — النتيجة مطابقة للمتوقع ESFP');

// ---- السيناريو 3: موظف معتدل ENFJ ----
printSeparator('السيناريو 3: موظف ENFJ بقوّة إجابات متوسطة (50%)');
const enfjAnswers = generateAnswersForType('ENFJ', 0.5);
const enfjResult = analyzeMBTI(enfjAnswers);
printResult(enfjResult, 'النتيجة');

if (enfjResult.type_code !== 'ENFJ') {
  console.error('❌ فشل: النتيجة ' + enfjResult.type_code + ' بينما المتوقع ENFJ');
  process.exit(1);
}
console.log('\n✅ نجح — النتيجة مطابقة للمتوقع ENFJ (قوّة التفضيلات أقل من السيناريو 1)');

// ---- السيناريو 4: إجابات محايدة (كلها 3) ----
printSeparator('السيناريو 4: موظف محايد تماماً (كل الإجابات = 3)');
const neutralAnswers = generateNeutralAnswers();
const neutralResult = analyzeMBTI(neutralAnswers);
printResult(neutralResult, 'النتيجة');

// توقع: تعادل في جميع المحاور، والنمط الافتراضي ISTJ (أقطاب سالبة لكل المحاور)
const expectedNeutralType = 'ISTJ';
if (neutralResult.type_code !== expectedNeutralType) {
  console.error(`❌ فشل: النتيجة ${neutralResult.type_code} بينما المتوقع ${expectedNeutralType} (تعادل كامل)`);
  process.exit(1);
}
if (!neutralResult.has_ties || neutralResult.tied_axes.length !== 4) {
  console.error('❌ فشل: كان متوقعاً تعادل في جميع المحاور الأربعة');
  process.exit(1);
}
console.log('\n✅ نجح — تعادل في جميع المحاور واستخدم القطب الافتراضي (ISTJ)');

// ---- السيناريو 5: فحص المدخلات الخاطئة ----
printSeparator('السيناريو 5: فحص التحقّق من المدخلات (validation)');

function expectError(fn, description) {
  try {
    fn();
    console.error(`❌ كان متوقّعاً خطأ: ${description}`);
    process.exit(1);
  } catch (err) {
    console.log(`✅ ${description}`);
    console.log(`    → الرسالة: ${err.message}`);
  }
}

// 5.1: عدد إجابات غير صحيح
expectError(
  () => analyzeMBTI([{ id: 1, answer: 3 }]),
  'رفض مصفوفة إجابات ناقصة'
);

// 5.2: قيمة إجابة خارج النطاق
expectError(
  () => {
    const bad = generateNeutralAnswers();
    bad[0].answer = 10;
    analyzeMBTI(bad);
  },
  'رفض قيمة إجابة خارج النطاق (10)'
);

// 5.3: قيمة إجابة عشرية
expectError(
  () => {
    const bad = generateNeutralAnswers();
    bad[0].answer = 2.5;
    analyzeMBTI(bad);
  },
  'رفض قيمة عشرية للإجابة'
);

// 5.4: معرّف سؤال غير موجود
expectError(
  () => {
    const bad = generateNeutralAnswers();
    bad[0].id = 999;
    analyzeMBTI(bad);
  },
  'رفض معرّف سؤال غير موجود'
);

// 5.5: إدخال ليس مصفوفة
expectError(
  () => analyzeMBTI('not an array'),
  'رفض مُدخَل ليس مصفوفة'
);

// ---- السيناريو 6: فحص تفسير النمط ----
printSeparator('السيناريو 6: التحقّق من تحميل تفسير النمط');
console.log(`نمط INTJ: لديه عنوان = "${intjResult.type_profile.type_name_ar || '—'}"`);
console.log(`نمط ESFP: لديه عنوان = "${esfpResult.type_profile.type_name_ar || '—'}"`);
console.log(`أوّل 3 حقول في تفسير INTJ:`);
console.log('  ', Object.keys(intjResult.type_profile).slice(0, 6).join(', '));

// ---- السيناريو 7: عيّنة تقرير كامل للمراجعة ----
printSeparator('السيناريو 7: تقرير إداري مختصر (INTJ)');
const report = intjResult;
console.log(`  Test ID:      ${report.test_id}`);
console.log(`  النمط:          ${report.type_code}`);
console.log(`  تاريخ الحساب:   ${report.computed_at}`);
console.log(`  تعادلات:        ${report.has_ties ? 'نعم' : 'لا'}`);
console.log(`  المحاور:`);
for (const axis of AXES) {
  const p = report.preferences[axis];
  console.log(
    `    ${axis}: ${p.chosen_pole} — قوّة ${p.strength.label_ar} (${p.strength_percent}%)`
  );
}

// ---- النهاية ----
printSeparator('🎉 جميع السيناريوهات نجحت!');
console.log('المحرك جاهز للاستخدام مع الواجهة الأمامية أو REST API.\n');
