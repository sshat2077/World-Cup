/**
 * ============================================================================
 *  طبقة المصادقة — auth.js
 * ============================================================================
 *
 *  يُقدّم:
 *    - hashPassword  : تشفير كلمة المرور بـ bcrypt (10 rounds)
 *    - verifyLogin   : التحقّق من البريد + كلمة المرور
 *    - middlewares:
 *        * requireAuth       : تحقّق أن المستخدم مُسجَّل الدخول
 *        * requireFounder    : تحقّق أن المستخدم مؤسّس
 *        * requireAdmin      : تحقّق أن المستخدم مؤسّس أو مدير
 * ============================================================================
 */

const bcrypt = require('bcryptjs');
const db = require('./db');

const BCRYPT_ROUNDS = 10;

/**
 * تشفير كلمة مرور جديدة
 */
async function hashPassword(plain) {
  return await bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * التحقّق من كلمة مرور ضدّ هاش محفوظ
 */
async function verifyPassword(plain, hash) {
  return await bcrypt.compare(plain, hash);
}

/**
 * التحقّق من بيانات الدخول
 * @returns {object|null} — بيانات المستخدم بلا password_hash، أو null للفشل
 */
async function verifyLogin(email, password) {
  const user = db.get(
    `SELECT * FROM users WHERE email = ? AND is_active = 1`,
    [email.toLowerCase().trim()]
  );

  if (!user) return null;

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return null;

  // تحديث وقت آخر دخول
  db.run(
    `UPDATE users SET last_login_at = datetime('now') WHERE id = ?`,
    [user.id]
  );

  // إرجاع بيانات المستخدم بدون الهاش
  const { password_hash, ...safeUser } = user;
  return safeUser;
}

// ========== Middlewares ==========

/**
 * يتطلّب تسجيل الدخول — يُرجع 401 عند الفشل
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'يتطلّب تسجيل الدخول' });
  }

  const user = db.get(
    `SELECT id, email, full_name, role FROM users WHERE id = ? AND is_active = 1`,
    [req.session.userId]
  );

  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'جلسة غير صالحة' });
  }

  req.user = user;
  next();
}

/**
 * يتطلّب أن يكون المستخدم مؤسّساً (founder)
 */
function requireFounder(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'founder') {
      return res.status(403).json({ error: 'هذه العملية تتطلّب صلاحيات المؤسس' });
    }
    next();
  });
}

/**
 * يتطلّب أن يكون المستخدم مؤسّساً أو مديراً (admin/founder)
 */
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'founder' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'هذه العملية تتطلّب صلاحيات إدارية' });
    }
    next();
  });
}

// ========== تسجيل الأحداث ==========

function logAction(userId, action, targetType, targetId, details, ipAddress) {
  try {
    db.run(
      `INSERT INTO audit_log (user_id, action, target_type, target_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId || null, action, targetType || null, targetId || null, details || null, ipAddress || null]
    );
  } catch (err) {
    console.error('[audit] فشل تسجيل:', err.message);
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  verifyLogin,
  requireAuth,
  requireFounder,
  requireAdmin,
  logAction
};
