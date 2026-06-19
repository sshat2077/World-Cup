/**
 * ============================================================================
 *  طبقة قاعدة البيانات — db.js
 * ============================================================================
 *
 *  يستخدم sql.js (SQLite على WebAssembly) — يعمل في أي بيئة Node.js
 *  بدون الحاجة لـ native compile.
 *
 *  قاعدة البيانات تُخزَّن كملف واحد (database.sqlite) بجوار الكود.
 *
 *  الجداول الستّة:
 *    - users              : المؤسس والمدير الإداري
 *    - candidates         : الموظفون الذين يُختَبَرون
 *    - test_invitations   : روابط الاختبار (tokens)
 *    - test_sessions      : حفظ التقدّم (لو المدير وافق)
 *    - test_results       : النتائج النهائية
 *    - access_grants      : صلاحيات الاطلاع على نتيجة محدّدة
 * ============================================================================
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// مسار قاعدة البيانات — قابل للضبط عبر DATABASE_PATH لدعم أقراص التخزين الدائمة عند النشر
const DB_FILE = process.env.DATABASE_PATH || path.join(__dirname, '..', 'database.sqlite');

let db = null;          // مثيل SQL.js
let SQL = null;         // الوحدة نفسها
let saveTimer = null;   // لتأخير الحفظ (throttling)

// ========== التهيئة ==========

/**
 * تهيئة قاعدة البيانات:
 *   - إن وُجِد الملف، نُحمّله
 *   - إن لم يوجد، ننشئ قاعدة جديدة مع الجداول والـ seed data
 */
async function initDB() {
  if (db) return db;

  SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    const buffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(buffer);
    console.log('[DB] تمّ تحميل قاعدة البيانات من:', DB_FILE);
  } else {
    db = new SQL.Database();
    createSchema();
    await seedInitialData();
    persistDB();
    console.log('[DB] تمّ إنشاء قاعدة بيانات جديدة مع بيانات البداية');
  }

  return db;
}

/**
 * حفظ قاعدة البيانات إلى القرص
 * يُستدعى بعد كل تعديل — لكن مع throttle خفيف (50ms) لتجميع الكتابات المتتالية.
 */
function persistDB() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const data = db.export();
    fs.writeFileSync(DB_FILE, Buffer.from(data));
    saveTimer = null;
  }, 50);
}

/**
 * حفظ فوري ومتزامن — لحالات الإغلاق
 */
function persistDBSync() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (db) {
    const data = db.export();
    fs.writeFileSync(DB_FILE, Buffer.from(data));
  }
}

// ========== إنشاء الجداول ==========

function createSchema() {
  db.run(`
    -- جدول المستخدمين الإداريين (المؤسس + المدير الإداري)
    CREATE TABLE users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      email           TEXT NOT NULL UNIQUE,
      password_hash   TEXT NOT NULL,
      full_name       TEXT NOT NULL,
      role            TEXT NOT NULL CHECK(role IN ('founder', 'admin')),
      is_active       INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at   TEXT
    );

    -- المُرشّحون (الموظفون الذين يُختَبَرون)
    CREATE TABLE candidates (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name       TEXT NOT NULL,
      email           TEXT NOT NULL,
      phone           TEXT,
      notes           TEXT,
      created_by      INTEGER NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    -- دعوات الاختبار (الروابط المُولَّدة)
    CREATE TABLE test_invitations (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      token                 TEXT NOT NULL UNIQUE,
      candidate_id          INTEGER NOT NULL,
      test_id               TEXT NOT NULL CHECK(test_id IN ('mbti', 'bigfive', 'disc')),
      allow_pause_resume    INTEGER NOT NULL DEFAULT 0,
      created_by            INTEGER NOT NULL,
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at            TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'expired', 'cancelled')),
      started_at            TEXT,
      completed_at          TEXT,
      result_id             INTEGER,
      FOREIGN KEY (candidate_id) REFERENCES candidates(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (result_id) REFERENCES test_results(id)
    );

    -- حفظ التقدّم الجزئي (لو المدير سمح بالإيقاف والإكمال)
    CREATE TABLE test_sessions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      invitation_id     INTEGER NOT NULL UNIQUE,
      answers_json      TEXT NOT NULL DEFAULT '{}',
      current_index     INTEGER NOT NULL DEFAULT 0,
      updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (invitation_id) REFERENCES test_invitations(id)
    );

    -- النتائج النهائية
    CREATE TABLE test_results (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      invitation_id     INTEGER NOT NULL UNIQUE,
      candidate_id      INTEGER NOT NULL,
      test_id           TEXT NOT NULL,
      result_json       TEXT NOT NULL,
      short_code        TEXT NOT NULL,
      computed_at       TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (invitation_id) REFERENCES test_invitations(id),
      FOREIGN KEY (candidate_id) REFERENCES candidates(id)
    );

    -- صلاحيات الاطلاع على نتيجة معيّنة
    CREATE TABLE access_grants (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      result_id         INTEGER NOT NULL,
      user_id           INTEGER NOT NULL,
      granted_by        INTEGER NOT NULL,
      granted_at        TEXT NOT NULL DEFAULT (datetime('now')),
      notes             TEXT,
      UNIQUE (result_id, user_id),
      FOREIGN KEY (result_id) REFERENCES test_results(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (granted_by) REFERENCES users(id)
    );

    -- سجلّ الجلسات (لاحقاً للمرحلة 2)
    CREATE TABLE audit_log (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER,
      action            TEXT NOT NULL,
      target_type       TEXT,
      target_id         INTEGER,
      details           TEXT,
      ip_address        TEXT,
      occurred_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- فهارس للأداء
    CREATE INDEX idx_invitations_token ON test_invitations(token);
    CREATE INDEX idx_invitations_status ON test_invitations(status);
    CREATE INDEX idx_invitations_candidate ON test_invitations(candidate_id);
    CREATE INDEX idx_results_candidate ON test_results(candidate_id);
    CREATE INDEX idx_access_grants_user ON access_grants(user_id);
  `);
}

// ========== بيانات البداية (Seed) ==========

async function seedInitialData() {
  const bcrypt = require('bcryptjs');

  // حساب المؤسس الافتراضي — يجب تغيير كلمة المرور عند أول تسجيل دخول
  const founderHash = await bcrypt.hash('Founder@2026', 10);
  const adminHash = await bcrypt.hash('Admin@2026', 10);

  db.run(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES (?, ?, ?, ?)`,
    ['founder@harith-law.sa', founderHash, 'الحارث السحيباني', 'founder']
  );

  db.run(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES (?, ?, ?, ?)`,
    ['admin@harith-law.sa', adminHash, 'المدير الإداري', 'admin']
  );

  console.log('[DB] حسابان افتراضيان أُنشِئا:');
  console.log('     المؤسس: founder@harith-law.sa / Founder@2026');
  console.log('     المدير: admin@harith-law.sa / Admin@2026');
  console.log('     ⚠️  غيّر كلمات المرور عند أول تسجيل دخول!');
}

// ========== دوال استعلام عامة ==========

/**
 * تشغيل استعلام بلا نتيجة (INSERT/UPDATE/DELETE) + persist
 */
function run(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.run(params);
    stmt.free();
    const lastId = getLastInsertId();
    persistDB();
    return { lastId };
  } catch (err) {
    stmt.free();
    throw err;
  }
}

/**
 * جلب صفّ واحد — يُعيد object أو null
 */
function get(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  } catch (err) {
    stmt.free();
    throw err;
  }
}

/**
 * جلب كل الصفوف — يُعيد مصفوفة من objects
 */
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    stmt.bind(params);
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  } catch (err) {
    stmt.free();
    throw err;
  }
}

/**
 * الحصول على آخر معرّف مُدخَل (INSERT)
 */
function getLastInsertId() {
  const result = db.exec('SELECT last_insert_rowid() AS id');
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0];
  }
  return null;
}

// ========== مساعدات محدّدة ==========

/**
 * توليد token عشوائي للرابط (32 حرفاً — آمن crypto grade)
 */
function generateToken() {
  return crypto.randomBytes(24).toString('base64url');  // 32 حرف URL-safe
}

/**
 * توليد short_code قصير للنتيجة (8 أحرف — للعرض)
 */
function generateShortCode() {
  return crypto.randomBytes(6).toString('base64url');  // 8 أحرف
}

// ========== إغلاق نظيف عند الخروج ==========

process.on('SIGINT', () => {
  console.log('\n[DB] إيقاف — يتم الحفظ...');
  persistDBSync();
  process.exit(0);
});
process.on('SIGTERM', () => {
  persistDBSync();
  process.exit(0);
});

// ========== التصدير ==========

module.exports = {
  initDB,
  run,
  get,
  all,
  persistDB,
  persistDBSync,
  generateToken,
  generateShortCode,
  getDBInstance: () => db
};
