const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET non défini — configure la variable d\'environnement sur Render !');
  process.exit(1);
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Non autorisé — token manquant' });

  const token = header.split(' ')[1];

  // Vérifier blacklist logout (cache mémoire d'abord, puis Firestore)
  try {
    const { isTokenRevoked } = require('../routes/auth');
    if (isTokenRevoked && await isTokenRevoked(token)) {
      return res.status(401).json({ error: 'Token révoqué' });
    }
  } catch {}

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    const msg = e.name === 'TokenExpiredError' ? 'Token expiré' : 'Token invalide';
    return res.status(401).json({ error: msg });
  }
}

module.exports = { authMiddleware, JWT_SECRET };
