const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'ak47-secret-change-in-prod';

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Non autorisé — token manquant' });

  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

module.exports = { authMiddleware, JWT_SECRET };
