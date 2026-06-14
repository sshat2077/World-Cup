/* ============================================================
   الإعداد الوحيد الذي تملؤه لتشغيل اللوحات الحيّة (Firebase).

   خطوات سريعة (مرّة واحدة):
   1) ادخل console.firebase.google.com وأنشئ مشروعًا مجّانيًّا.
   2) Build → Firestore Database → Create database (ابدأ بوضع Production).
   3) Project settings (⚙️) → Your apps → Web (</>) → سجّل تطبيقًا،
      وانسخ كائن firebaseConfig والصقه مكان القيم أدناه.
   4) في Firestore → Rules، الصق القواعد المذكورة في رسالة المساعد، ثم Publish.

   ملاحظة: مفاتيح firebaseConfig عامّة بطبيعتها (آمنة في صفحات الويب) —
   الحماية تأتي من قواعد Firestore، لا من إخفاء المفاتيح.
   ============================================================ */
window.LIVE_CONFIG = {
  firebaseConfig: {
    apiKey:            "YOUR_API_KEY",
    authDomain:        "YOUR_PROJECT.firebaseapp.com",
    projectId:         "YOUR_PROJECT_ID",
    storageBucket:     "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId:             "YOUR_APP_ID"
  },

  /* غرفة الجلسة: شارك نفس ?room=CODE في كل الروابط ليجتمع الفريق في لوحة واحدة.
     الافتراضي "main". لتشغيل جلسات متعددة، غيّر الكود في الروابط مثل ?room=team-a */
  room: (new URLSearchParams(location.search).get('room') || 'main'),

  /* (اختياري) رابط الاستضافة العام بعد النشر — يُستخدم لتوليد رمز QR في العرض.
     مثال: "https://your-project.web.app". اتركه فارغًا قبل النشر. */
  publicBaseUrl: ""
};

/* تهيئة مشتركة: تُستدعى من كل صفحة. ترجع {db, ready, room}. */
window.LIVE_INIT = function () {
  var cfg = window.LIVE_CONFIG || {};
  var out = { db: null, ready: false, room: (cfg.room || 'main') };
  try {
    var pid = cfg.firebaseConfig && cfg.firebaseConfig.projectId;
    if (pid && pid.indexOf('YOUR_') !== 0 && window.firebase) {
      if (!firebase.apps.length) firebase.initializeApp(cfg.firebaseConfig);
      out.db = firebase.firestore();
      out.ready = true;
    }
  } catch (e) { console.error('Firebase init failed:', e); }
  return out;
};
