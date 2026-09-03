const isAuthenticated = (req, res, next) => {
  if (req.user) {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  return res.redirect('/auth/login');
};

const isAdmin = (req, res, next) => {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login');
  }
  if (req.user.role === 'admin') {
    return next();
  }
  return res.status(403).render('pages/error', {
    title: 'غير مصرح',
    error: 'ليس لديك صلاحية للوصول لهذه الصفحة'
  });
};

module.exports = { isAuthenticated, isAdmin };
