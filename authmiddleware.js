const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'Token não fornecido' });
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'daily_secret_key');
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

function optionalAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) { req.user = null; return next(); }
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  try { req.user = jwt.verify(token, process.env.JWT_SECRET || 'daily_secret_key'); }
  catch { req.user = null; }
  next();
}

module.exports = { authMiddleware, optionalAuth };
