const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 60,
  message: {
    error: 'تم تجاوز الحد المسموح من الطلبات. يرجى المحاولة لاحقاً.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    error: 'تم تجاوز الحد المسموح من محاولات تسجيل الدخول.'
  }
});

const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: {
    error: 'تم تجاوز الحد المسموح. يرجى الانتظار.'
  }
});

module.exports = { apiLimiter, authLimiter, strictLimiter };
