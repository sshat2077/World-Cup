/**
 *  مسارات الإدارة — /api/admin/*
 *  تتطلّب صلاحية founder أو admin
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../auth');

// كل المسارات هنا تتطلّب صلاحية إدارية
router.use(auth.requireAdmin);

// ========== إنشاء دعوة اختبار جديدة ==========

// POST /api/admin/invitations
// body: { candidate_name, candidate_email, candidate_phone?, test_id, allow_pause_resume? }
router.post('/invitations', (req, res) => {
  try {
    const {
      candidate_name,
      candidate_email,
      candidate_phone,
      candidate_notes,
      test_id,
      allow_pause_resume
    } = req.body || {};

    // تحقّق
    if (!candidate_name || !candidate_email || !test_id) {
      return res.status(400).json({ error: 'الاسم والبريد ونوع الاختبار مطلوبة' });
    }
    if (!['mbti', 'bigfive', 'disc'].includes(test_id)) {
      return res.status(400).json({ error: 'نوع اختبار غير مدعوم' });
    }

    // إنشاء candidate
    const candResult = db.run(
      `INSERT INTO candidates (full_name, email, phone, notes, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [candidate_name.trim(), candidate_email.trim().toLowerCase(), candidate_phone || null, candidate_notes || null, req.user.id]
    );

    // توليد token + تاريخ انتهاء (7 أيام)
    const token = db.generateToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const invResult = db.run(
      `INSERT INTO test_invitations
       (token, candidate_id, test_id, allow_pause_resume, created_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [token, candResult.lastId, test_id, allow_pause_resume ? 1 : 0, req.user.id, expiresAt]
    );

    auth.logAction(req.user.id, 'invitation_created', 'invitation', invResult.lastId,
      `candidate=${candidate_name}, test=${test_id}`, req.ip);

    // إنشاء الرابط الكامل
    const host = req.get('host');
    const protocol = req.protocol;
    const link = `${protocol}://${host}/t/${token}`;

    res.json({
      success: true,
      invitation: {
        id: invResult.lastId,
        token,
        link,
        candidate_name,
        candidate_email,
        test_id,
        allow_pause_resume: !!allow_pause_resume,
        expires_at: expiresAt,
        status: 'pending'
      }
    });
  } catch (err) {
    console.error('[create invitation]', err);
    res.status(500).json({ error: 'خطأ في إنشاء الدعوة', details: err.message });
  }
});

// ========== قائمة جميع الدعوات ==========

// GET /api/admin/invitations?status=pending&test_id=mbti
router.get('/invitations', (req, res) => {
  try {
    const filters = [];
    const params = [];

    if (req.query.status) {
      filters.push('i.status = ?');
      params.push(req.query.status);
    }
    if (req.query.test_id) {
      filters.push('i.test_id = ?');
      params.push(req.query.test_id);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const rows = db.all(
      `SELECT
         i.id, i.token, i.test_id, i.status, i.allow_pause_resume,
         i.created_at, i.expires_at, i.started_at, i.completed_at,
         c.full_name AS candidate_name, c.email AS candidate_email, c.phone AS candidate_phone,
         u.full_name AS created_by_name,
         i.result_id
       FROM test_invitations i
       JOIN candidates c ON c.id = i.candidate_id
       JOIN users u ON u.id = i.created_by
       ${where}
       ORDER BY i.created_at DESC`,
      params
    );

    // إضافة رابط كامل لكل صف
    const host = req.get('host');
    const protocol = req.protocol;
    for (const r of rows) {
      r.link = `${protocol}://${host}/t/${r.token}`;
      r.allow_pause_resume = !!r.allow_pause_resume;
    }

    res.json({ invitations: rows });
  } catch (err) {
    console.error('[list invitations]', err);
    res.status(500).json({ error: 'خطأ في جلب الدعوات' });
  }
});

// ========== إلغاء دعوة ==========

// POST /api/admin/invitations/:id/cancel
router.post('/invitations/:id/cancel', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const inv = db.get(`SELECT status FROM test_invitations WHERE id = ?`, [id]);
    if (!inv) return res.status(404).json({ error: 'دعوة غير موجودة' });
    if (inv.status === 'completed') {
      return res.status(400).json({ error: 'لا يمكن إلغاء اختبار مُكتمل' });
    }

    db.run(`UPDATE test_invitations SET status = 'cancelled' WHERE id = ?`, [id]);
    auth.logAction(req.user.id, 'invitation_cancelled', 'invitation', id, null, req.ip);
    res.json({ success: true });
  } catch (err) {
    console.error('[cancel]', err);
    res.status(500).json({ error: 'خطأ' });
  }
});

// ========== قائمة النتائج ==========

// GET /api/admin/results
router.get('/results', (req, res) => {
  try {
    // المؤسس يرى كل شيء. المدير يرى ما أنشأه هو + ما مُنح له صلاحية عليه
    let rows;
    if (req.user.role === 'founder') {
      rows = db.all(
        `SELECT
           r.id, r.test_id, r.short_code, r.computed_at,
           c.full_name AS candidate_name, c.email AS candidate_email,
           i.id AS invitation_id,
           u.full_name AS created_by_name
         FROM test_results r
         JOIN candidates c ON c.id = r.candidate_id
         JOIN test_invitations i ON i.id = r.invitation_id
         JOIN users u ON u.id = i.created_by
         ORDER BY r.computed_at DESC`
      );
    } else {
      // admin: ما أنشأه + ما مُنح له
      rows = db.all(
        `SELECT DISTINCT
           r.id, r.test_id, r.short_code, r.computed_at,
           c.full_name AS candidate_name, c.email AS candidate_email,
           i.id AS invitation_id,
           u.full_name AS created_by_name
         FROM test_results r
         JOIN candidates c ON c.id = r.candidate_id
         JOIN test_invitations i ON i.id = r.invitation_id
         JOIN users u ON u.id = i.created_by
         LEFT JOIN access_grants g ON g.result_id = r.id AND g.user_id = ?
         WHERE i.created_by = ? OR g.user_id = ?
         ORDER BY r.computed_at DESC`,
        [req.user.id, req.user.id, req.user.id]
      );
    }

    res.json({ results: rows });
  } catch (err) {
    console.error('[list results]', err);
    res.status(500).json({ error: 'خطأ في جلب النتائج' });
  }
});

// ========== عرض نتيجة كاملة ==========

// GET /api/admin/results/:id
router.get('/results/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = db.get(
      `SELECT r.*, c.full_name AS candidate_name, c.email AS candidate_email,
              i.created_by AS invitation_creator
       FROM test_results r
       JOIN candidates c ON c.id = r.candidate_id
       JOIN test_invitations i ON i.id = r.invitation_id
       WHERE r.id = ?`,
      [id]
    );

    if (!result) return res.status(404).json({ error: 'نتيجة غير موجودة' });

    // التحقّق من الصلاحية
    const isFounder = req.user.role === 'founder';
    const isCreator = result.invitation_creator === req.user.id;
    const grant = db.get(
      `SELECT id FROM access_grants WHERE result_id = ? AND user_id = ?`,
      [id, req.user.id]
    );

    if (!isFounder && !isCreator && !grant) {
      return res.status(403).json({ error: 'لا تملك صلاحية الاطلاع على هذه النتيجة' });
    }

    auth.logAction(req.user.id, 'result_viewed', 'result', id, null, req.ip);

    res.json({
      id: result.id,
      candidate_name: result.candidate_name,
      candidate_email: result.candidate_email,
      test_id: result.test_id,
      short_code: result.short_code,
      computed_at: result.computed_at,
      data: JSON.parse(result.result_json)
    });
  } catch (err) {
    console.error('[get result]', err);
    res.status(500).json({ error: 'خطأ' });
  }
});

// ========== منح صلاحية الاطلاع ==========

// POST /api/admin/results/:id/grant
// body: { user_id, notes? }
router.post('/results/:id/grant', (req, res) => {
  try {
    const resultId = parseInt(req.params.id);
    const { user_id, notes } = req.body || {};

    if (!user_id) return res.status(400).json({ error: 'user_id مطلوب' });

    // التحقّق أن النتيجة موجودة + المانح له صلاحية
    const result = db.get(
      `SELECT r.id, i.created_by FROM test_results r
       JOIN test_invitations i ON i.id = r.invitation_id
       WHERE r.id = ?`,
      [resultId]
    );
    if (!result) return res.status(404).json({ error: 'نتيجة غير موجودة' });

    // فقط المؤسس أو منشئ الدعوة يمنح
    if (req.user.role !== 'founder' && result.created_by !== req.user.id) {
      return res.status(403).json({ error: 'لا تملك صلاحية منح الاطلاع على هذه النتيجة' });
    }

    // التحقّق أن المستخدم المُمنَح موجود
    const grantee = db.get(`SELECT id FROM users WHERE id = ? AND is_active = 1`, [user_id]);
    if (!grantee) return res.status(404).json({ error: 'المستخدم غير موجود' });

    try {
      db.run(
        `INSERT INTO access_grants (result_id, user_id, granted_by, notes)
         VALUES (?, ?, ?, ?)`,
        [resultId, user_id, req.user.id, notes || null]
      );
      auth.logAction(req.user.id, 'access_granted', 'result', resultId,
        `to_user=${user_id}`, req.ip);
      res.json({ success: true });
    } catch (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'هذا المستخدم لديه الصلاحية مسبقاً' });
      }
      throw err;
    }
  } catch (err) {
    console.error('[grant]', err);
    res.status(500).json({ error: 'خطأ' });
  }
});

// ========== قائمة المستخدمين (لاختيار من يُمنح) ==========

// GET /api/admin/users
router.get('/users', (req, res) => {
  try {
    const rows = db.all(
      `SELECT id, email, full_name, role FROM users WHERE is_active = 1 ORDER BY role, full_name`
    );
    res.json({ users: rows });
  } catch (err) {
    console.error('[users]', err);
    res.status(500).json({ error: 'خطأ' });
  }
});

module.exports = router;
