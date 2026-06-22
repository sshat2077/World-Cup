/**
 *  اختبار وحدة — المحرّك العامّ لاختبارات السيناريوهات (مصادر الالتزام)
 */
const { analyzeScenario } = require('./scenario-engine');
const { selectServed } = require('../lib/sampling');
const fs = require('fs');
const path = require('path');

const bank = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'obligations-questions.json'), 'utf8'));
const byId = {}; bank.questions.forEach(q => byId[q.id] = q);

let pass = 0, fail = 0;
const A = (c, n) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n)); };

const TOKEN = 'OBLIG_TEST_TOKEN_123';

// المجموعة المخدومة لهذا الـtoken
const served = selectServed(bank, TOKEN);
const bestId = q => q.options.reduce((a, b) => (b.score > a.score ? b : a)).id;
const worstId = q => q.options.reduce((a, b) => (b.score < a.score ? b : a)).id;

console.log('\n──── 1. الاختيار الطبقي 10/30 ────');
A(served.length === 10, 'يُخدَم 10 أسئلة (كان ' + served.length + ')');
const domCount = {};
served.forEach(q => domCount[q.domain] = (domCount[q.domain] || 0) + 1);
A(Object.keys(domCount).length === 5 && Object.values(domCount).every(c => c === 2), 'سؤالان من كل مصدر (طبقي): ' + JSON.stringify(domCount));

console.log('\n──── 2. حتمية الاختيار لنفس الـtoken ────');
const served2 = selectServed(bank, TOKEN);
A(JSON.stringify(served.map(q => q.id)) === JSON.stringify(served2.map(q => q.id)), 'نفس الأسئلة لنفس الـtoken');
const servedOther = selectServed(bank, 'DIFFERENT_TOKEN_999');
A(JSON.stringify(served.map(q => q.id)) !== JSON.stringify(servedOther.map(q => q.id)), 'مجموعة مختلفة لـtoken آخر');

console.log('\n──── 3. إجابات مثالية → 100% متميّز ────');
let r = analyzeScenario('obligations', served.map(q => ({ id: q.id, answer: bestId(byId[q.id]) })), TOKEN);
A(r.total_percent === 100, 'النسبة 100% (كان ' + r.total_percent + ')');
A(r.level.code === 'distinguished', 'المستوى = متميّز');
A(r.served_count === 10 && r.bank_size === 30, 'served=10 و bank=30');
A(r.domain_reports.length === 5, '5 مصادر في التقرير');

console.log('\n──── 4. أسوأ إجابات → 0% دون المستوى ────');
r = analyzeScenario('obligations', served.map(q => ({ id: q.id, answer: worstId(byId[q.id]) })), TOKEN);
A(r.total_percent === 0, 'النسبة 0%');
A(r.level.code === 'below', 'المستوى = دون المستوى');

console.log('\n──── 5. الخصوصية: لا كشف للإجابات ────');
r = analyzeScenario('obligations', served.map(q => ({ id: q.id, answer: bestId(byId[q.id]) })), TOKEN);
A(!JSON.stringify(r).includes('rationale') && !JSON.stringify(r).includes('legal_ref'), 'النتيجة لا تكشف التعليلات/المراجع');

console.log('\n──── 6. التصحيح يعتمد المُعرّف لا الموضع (token آخر) ────');
const T2 = 'ANOTHER_TOKEN_ABC';
const s2 = selectServed(bank, T2);
r = analyzeScenario('obligations', s2.map(q => ({ id: q.id, answer: bestId(byId[q.id]) })), T2);
A(r.total_percent === 100, 'إجابات مثالية بـtoken مختلف = 100% أيضاً');

console.log('\n======================================================================');
console.log('  الخلاصة: ✅ ' + pass + ' ناجح   ❌ ' + fail + ' فاشل');
console.log('======================================================================');
process.exit(fail ? 1 : 0);
