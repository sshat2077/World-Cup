/**
 *  مسارات المصادقة — /api/auth/*
 */

const express = require('express');
const router = express.Router();
const auth = require('../auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'البريد وكلمة المرور مطلوبان' });
    }

    const user = await auth.verifyLogin(email, password);
    if (!user) {
      auth.logAction(null, 'login_failed', 'user', null, `email=${email}`, req.ip);
      return res.status(401).json({ error: 'بريد أو كلمة مرور غير صحيحة' });
    }

    req.session.userId = user.id;
    req.session.userRole = user.role;

    auth.logAction(user.id, 'login_success', 'user', user.id, null, req.ip);

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role
      }
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'خطأ داخلي في الخادم' });
  }
});

// POST /api/auth/logout
router.post('/logout', auth.requireAuth, (req, res) => {
  const userId = req.user.id;
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'خطأ في تسجيل الخروج' });
    auth.logAction(userId, 'logout', 'user', userId, null, req.ip);
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// GET /api/auth/me — المستخدم الحالي
router.get('/me', auth.requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/change-password
router.post('/change-password', auth.requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'كلمة المرور الحالية والجديدة مطلوبتان' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل' });
    }

    const db = require('../db');
    const user = db.get(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]);
    const ok = await auth.verifyPassword(current_password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }

    const newHash = await auth.hashPassword(new_password);
    db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [newHash, req.user.id]);

    auth.logAction(req.user.id, 'password_changed', 'user', req.user.id, null, req.ip);
    res.json({ success: true });
  } catch (err) {
    console.error('[change-password]', err);
    res.status(500).json({ error: 'خطأ داخلي' });
  }
});

module.exports = router;
