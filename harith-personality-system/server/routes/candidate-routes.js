/**
 *  مسارات رحلة الموظف (المُختَبَر) — /api/take/*
 *  الدخول عن طريق token فقط، لا مصادقة بكلمة مرور.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');

const { analyzeMBTI } = require('../engines/mbti-engine');
const { analyzeBigFive } = require('../engines/bigfive-engine');
const { analyzeDISC } = require('../engines/disc-engine');

const ANALYZERS = {
  mbti: analyzeMBTI,
  bigfive: analyzeBigFive,
  disc: analyzeDISC
};

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const QUESTIONS_FILES = {
  mbti: 'mbti-questions.json',
  bigfive: 'bigfive-questions.json',
  disc: 'disc-questions.json'
};

// ========== مُساعِد: التحقّق من صلاحية token ==========

/**
 * يتحقّق من token ويُعيد الدعوة مع حالتها الحالية
 * @returns {object} { invitation, candidate, error }
 */
function validateToken(token) {
  if (!token || typeof token !== 'string') {
    return { error: 'رابط غير صالح' };
  }

  const inv = db.get(
    `SELECT i.*, c.full_name AS candidate_name, c.email AS candidate_email
     FROM test_invitations i
     JOIN candidates c ON c.id = i.candidate_id
     WHERE i.token = ?`,
    [token]
  );

  if (!inv) return { error: 'الرابط غير موجود' };

  // انتهاء الصلاحية
  if (new Date(inv.expires_at) < new Date()) {
    // نُحدّث الحالة
    if (inv.status === 'pending' || inv.status === 'in_progress') {
      db.run(`UPDATE test_invitations SET status = 'expired' WHERE id = ?`, [inv.id]);
    }
    return { error: 'انتهت صلاحية الرابط' };
  }

  if (inv.status === 'cancelled') return { error: 'تمّ إلغاء هذا الاختبار' };
  if (inv.status === 'expired') return { error: 'انتهت صلاحية الرابط' };
  if (inv.status === 'completed') return { error: 'تمّ إكمال هذا الاختبار من قبل' };

  return { invitation: inv };
}

// ========== GET /api/take/:token/info — بدء الرحلة ==========

router.get('/:token/info', (req, res) => {
  const { token } = req.params;
  const { invitation, error } = validateToken(token);
  if (error) return res.status(400).json({ error });

  // تحميل وصف الاختبار من ملف الأسئلة
  const questionsFile = QUESTIONS_FILES[invitation.test_id];
  const filepath = path.join(DATA_DIR, questionsFile);
  const raw = JSON.parse(fs.readFileSync(filepath, 'utf8'));

  res.json({
    token,
    candidate_name: invitation.candidate_name,
    test_id: invitation.test_id,
    test_name_ar: raw.test_name_ar,
    description_ar: raw.description_ar,
    instructions_ar: raw.instructions_ar,
    estimated_time_minutes: raw.estimated_time_minutes,
    total_questions: raw.questions.length,
    allow_pause_resume: !!invitation.allow_pause_resume,
    status: invitation.status,
    expires_at: invitation.expires_at
  });
});

// ========== GET /api/take/:token/questions — الأسئلة ==========

router.get('/:token/questions', (req, res) => {
  const { token } = req.params;
  const { invitation, error } = validateToken(token);
  if (error) return res.status(400).json({ error });

  // تحديث الحالة إلى in_progress إذا كانت pending
  if (invitation.status === 'pending') {
    db.run(
      `UPDATE test_invitations
       SET status = 'in_progress', started_at = datetime('now')
       WHERE id = ?`,
      [invitation.id]
    );
  }

  const questionsFile = QUESTIONS_FILES[invitation.test_id];
  const filepath = path.join(DATA_DIR, questionsFile);
  const raw = JSON.parse(fs.readFileSync(filepath, 'utf8'));

  // استرجاع التقدّم المحفوظ إن وُجد
  let savedProgress = null;
  if (invitation.allow_pause_resume) {
    const session = db.get(
      `SELECT answers_json, current_index FROM test_sessions WHERE invitation_id = ?`,
      [invitation.id]
    );
    if (session) {
      savedProgress = {
        answers: JSON.parse(session.answers_json),
        current_index: session.current_index
      };
    }
  }

  res.json({
    test_id: raw.test_id,
    test_name_ar: raw.test_name_ar,
    instructions_ar: raw.instructions_ar,
    scale_ar: raw.scale_ar,
    total_questions: raw.questions.length,
    questions: raw.questions.map(q => ({ id: q.id, text: q.text })),
    saved_progress: savedProgress,
    allow_pause_resume: !!invitation.allow_pause_resume
  });
});

// ========== POST /api/take/:token/save — حفظ جزئي ==========

router.post('/:token/save', (req, res) => {
  const { token } = req.params;
  const { invitation, error } = validateToken(token);
  if (error) return res.status(400).json({ error });

  if (!invitation.allow_pause_resume) {
    return res.status(403).json({ error: 'لم يُسمح بإيقاف هذا الاختبار' });
  }

  const { answers, current_index } = req.body || {};

  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'الإجابات غير صحيحة' });
  }

  const answersJson = JSON.stringify(answers);
  const idx = parseInt(current_index) || 0;

  // هل الجلسة موجودة؟
  const existing = db.get(
    `SELECT id FROM test_sessions WHERE invitation_id = ?`,
    [invitation.id]
  );

  if (existing) {
    db.run(
      `UPDATE test_sessions
       SET answers_json = ?, current_index = ?, updated_at = datetime('now')
       WHERE invitation_id = ?`,
      [answersJson, idx, invitation.id]
    );
  } else {
    db.run(
      `INSERT INTO test_sessions (invitation_id, answers_json, current_index)
       VALUES (?, ?, ?)`,
      [invitation.id, answersJson, idx]
    );
  }

  res.json({ success: true, saved_at: new Date().toISOString() });
});

// ========== POST /api/take/:token/submit — التسليم النهائي ==========

router.post('/:token/submit', (req, res) => {
  const { token } = req.params;
  const { invitation, error } = validateToken(token);
  if (error) return res.status(400).json({ error });

  const { answers } = req.body || {};
  if (!answers) return res.status(400).json({ error: 'answers مفقودة' });

  try {
    const analyzer = ANALYZERS[invitation.test_id];
    if (!analyzer) return res.status(400).json({ error: 'محرك غير معروف' });

    const result = analyzer(answers);

    // حفظ النتيجة
    const shortCode = db.generateShortCode();
    const insertRes = db.run(
      `INSERT INTO test_results
       (invitation_id, candidate_id, test_id, result_json, short_code)
       VALUES (?, ?, ?, ?, ?)`,
      [invitation.id, invitation.candidate_id, invitation.test_id, JSON.stringify(result), shortCode]
    );

    // تحديث حالة الدعوة
    db.run(
      `UPDATE test_invitations
       SET status = 'completed', completed_at = datetime('now'), result_id = ?
       WHERE id = ?`,
      [insertRes.lastId, invitation.id]
    );

    // حذف الجلسة الجزئية (لم تعد مُحتاجة)
    db.run(`DELETE FROM test_sessions WHERE invitation_id = ?`, [invitation.id]);

    // إرجاع النتيجة المختصرة فقط للموظف
    const shortResult = buildShortResult(result);

    res.json({
      success: true,
      short_result: shortResult,
      message: 'تمّ إكمال الاختبار بنجاح. سيطّلع المسؤول على النتيجة التفصيلية.'
    });
  } catch (err) {
    console.error('[submit]', err);
    res.status(400).json({ error: err.message });
  }
});

// ========== مُساعِد: بناء نتيجة مختصرة للموظف ==========

function buildShortResult(fullResult) {
  if (fullResult.test_id === 'mbti') {
    return {
      test_id: 'mbti',
      type_code: fullResult.type_code,
      type_name_ar: fullResult.type_profile.type_name_ar,
      tagline_ar: fullResult.type_profile.type_tagline_ar,
      short_description: fullResult.type_profile.summary_for_employee?.short_description_ar || '',
      top_strengths: fullResult.type_profile.summary_for_employee?.top_strengths_ar || [],
      preferences: Object.fromEntries(
        Object.entries(fullResult.preferences).map(([axis, p]) => [
          axis,
          { pole: p.chosen_pole, percent: p.strength_percent, label: p.strength.label_ar }
        ])
      )
    };
  }

  if (fullResult.test_id === 'disc') {
    return {
      test_id: 'disc',
      primary_style: fullResult.primary_style,
      secondary_style: fullResult.secondary_style,
      compound_code: fullResult.compound_code,
      style_name_ar: fullResult.primary_profile.style_name_ar,
      tagline_ar: fullResult.primary_profile.tagline_ar,
      short_description: fullResult.primary_profile.summary_for_employee?.short_description_ar || '',
      top_strengths: fullResult.primary_profile.summary_for_employee?.top_strengths_ar || [],
      ranking: fullResult.ranking.map(r => ({
        style: r.style_code,
        name: r.style_name_ar,
        percent: r.percent
      }))
    };
  }

  if (fullResult.test_id === 'bigfive') {
    return {
      test_id: 'bigfive',
      profile_code: fullResult.profile_code,
      dimensions: fullResult.dimension_reports.map(r => ({
        code: r.dimension_code,
        name: r.dimension_name_ar,
        percent: r.score.percent,
        level: r.score.level,
        level_label: r.interpretation.level_label_ar,
        headline: r.interpretation.headline_ar,
        short_description: r.interpretation.short_description_ar,
        is_reverse_scored: r.score.is_reverse_scored
      }))
    };
  }

  return { test_id: fullResult.test_id, error: 'نوع غير معروف' };
}

module.exports = router;
