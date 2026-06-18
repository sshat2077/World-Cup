/* ============================================================
   إعداد اللوحات الحيّة (Firebase) — مملوء وجاهز.
   غرفة الجلسة الافتراضية "main". لجلسات متعددة استخدم ?room=CODE
   في كل الروابط (predict.html / games.html / العرض) ليجتمعوا في لوحة واحدة.
   ============================================================ */
window.LIVE_CONFIG = {
  firebaseConfig: {
    apiKey:            "AIzaSyALaGaHbCGP67AlVfIr1RVdIkDJGBcJpdc",
    authDomain:        "world-cup-2026-4c3db.firebaseapp.com",
    projectId:         "world-cup-2026-4c3db",
    storageBucket:     "world-cup-2026-4c3db.firebasestorage.app",
    messagingSenderId: "794181294293",
    appId:             "1:794181294293:web:9078f340816c46e5452a5c"
  },

  room: (new URLSearchParams(location.search).get('room') || 'main'),

  /* رابط الاستضافة العام — يُستخدم لتوليد رمز QR في شرائح العرض. */
  publicBaseUrl: "https://world-cup-games.onrender.com",

  /* لوحة الاحتمالات الحيّة في العرض (محليّ فقط — لا تُرفع هذه القيمة للنشر العام).
     احصل على مفتاح مجّاني من the-odds-api.com والصقه هنا. */
  oddsApiKey: "YOUR_ODDS_API_KEY",
  oddsRegions: "uk",          // uk فيها bet365 / William Hill / Betfair…
  oddsSport: "soccer_fifa_world_cup_winner",
  oddsProxy: ""               // يُملأ فقط لو احتجنا تجاوز CORS عبر وسيط
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
