/**
 * ============================================================================
 *  الخادم الرئيسي — app.js (المرحلة 1)
 * ============================================================================
 *
 *  يُقدّم:
 *    1. نظام مصادقة كامل (المؤسس + المدير الإداري)
 *    2. قاعدة بيانات SQLite
 *    3. مسارات الإدارة (إنشاء الاختبارات، النتائج، الصلاحيات)
 *    4. رحلة الموظف بـ token
 *    5. الملفّات الثابتة (HTML/CSS/JS)
 *
 *  Node.js + Express + sql.js + bcryptjs
 * ============================================================================
 */

const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');

const db = require('./db');

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PORT = parseInt(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

async function main() {
  await db.initDB();

  const app = express();

  // ثقة بـ proxy (ضروري عند النشر خلف Nginx/Railway)
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '1mb' }));

  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000       // 8 ساعات
    }
  }));

  // فحص صحّة الخادم
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'harith-personality-system',
      version: '1.0.0-phase1',
      timestamp: new Date().toISOString()
    });
  });

  // المسارات
  app.use('/api/auth', require('./routes/auth-routes'));
  app.use('/api/admin', require('./routes/admin-routes'));
  app.use('/api/take', require('./routes/candidate-routes'));

  // الملفّات الثابتة
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // الرابط القصير للموظف
  app.get('/t/:token', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'take.html'));
  });

  // الإدارة
  app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
  });

  // الرئيسية
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'home.html'));
  });

  // معالج الأخطاء
  app.use((err, req, res, next) => {
    console.error('[خطأ]', err);
    res.status(500).json({ error: 'خطأ داخلي في الخادم' });
  });

  // 404
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'مسار غير موجود', path: req.path });
    }
    res.status(404).send('<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>غير موجود</title><style>body{font-family:Arial;text-align:center;padding:50px;background:#F5F3EF}</style></head><body><h1 style="color:#0A5778">الصفحة غير موجودة</h1><p><a href="/">العودة للرئيسية</a></p></body></html>');
  });

  app.listen(PORT, () => {
    console.log('');
    console.log('='.repeat(66));
    console.log('  نظام تحليل شخصية الموظفين — المرحلة 1');
    console.log('  الحارث السحيباني محامون ومستشارون');
    console.log('='.repeat(66));
    console.log(`  الخادم يعمل على:        http://localhost:${PORT}`);
    console.log(`  الصفحة الرئيسية:         /`);
    console.log(`  لوحة الإدارة:           /admin`);
    console.log(`  رابط الموظف (مثال):     /t/:token`);
    console.log('='.repeat(66));
    console.log('');
    console.log('  بيانات الدخول الافتراضية:');
    console.log('    المؤسس: founder@harith-law.sa / Founder@2026');
    console.log('    المدير: admin@harith-law.sa / Admin@2026');
    console.log('='.repeat(66));
  });
}

main().catch(err => {
  console.error('فشل بدء الخادم:', err);
  process.exit(1);
});
