const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const { db }   = require('../firebase');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();
const USERS  = 'users';

// ── REGISTER ───────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)      return res.status(400).json({ error: 'Champs manquants' });
  if (username.length < 3)         return res.status(400).json({ error: 'Username trop court (min 3)' });
  if (password.length < 6)         return res.status(400).json({ error: 'Mot de passe trop court (min 6)' });

  // Check username unique (stored as doc ID for fast lookup)
  const existing = await db.collection(USERS).doc(username).get();
  if (existing.exists) return res.status(409).json({ error: 'Nom d\'utilisateur déjà pris' });

  const hash = await bcrypt.hash(password, 10);
  const user = {
    id: username,          // use username as doc ID
    username,
    password: hash,
    createdAt: new Date().toISOString(),
  };
  await db.collection(USERS).doc(username).set(user);

  const token = jwt.sign({ id: username, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username, id: username });
});

// ── LOGIN ──────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Champs manquants' });

  const snap = await db.collection(USERS).doc(username).get();
  if (!snap.exists) return res.status(401).json({ error: 'Identifiants incorrects' });

  const user = snap.data();
  const ok   = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Identifiants incorrects' });

  const token = jwt.sign({ id: username, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username, id: username });
});

// ── ME ─────────────────────────────────────────────────────
router.get('/me', authMiddleware, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username });
});

module.exports = router;
