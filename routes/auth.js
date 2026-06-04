const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
const { db }   = require('../firebase');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();
const USERS  = 'users';

// ── Validation
const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,32}$/;
const PASSWORD_MIN   = 8;
const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/; // min 8 chars, 1 lettre + 1 chiffre

// ── Content-Type guard
function requireJSON(req, res, next) {
  if (!req.is('application/json')) return res.status(415).json({ error: 'Content-Type doit être application/json' });
  next();
}

// ── Encrypt Discord token (AES-256-GCM)
const ENCRYPT_KEY = process.env.TOKEN_ENCRYPT_KEY;
if (!ENCRYPT_KEY) {
  console.error('⚠️  TOKEN_ENCRYPT_KEY non défini — les tokens Discord seront stockés en clair !');
}

function encryptToken(plaintext) {
  if (!ENCRYPT_KEY) return plaintext; // fallback si pas de clé
  const key = Buffer.from(ENCRYPT_KEY, 'hex');
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptToken(ciphertext) {
  if (!ENCRYPT_KEY) return ciphertext;
  try {
    const [ivHex, tagHex, encHex] = ciphertext.split(':');
    const key     = Buffer.from(ENCRYPT_KEY, 'hex');
    const iv      = Buffer.from(ivHex, 'hex');
    const tag     = Buffer.from(tagHex, 'hex');
    const enc     = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(enc) + decipher.final('utf8');
  } catch { return null; }
}

// ── REGISTER
router.post('/register', requireJSON, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)          return res.status(400).json({ error: 'Champs manquants' });
  if (!USERNAME_REGEX.test(username))  return res.status(400).json({ error: 'Username invalide (3-32 chars, lettres/chiffres/_/-)' });
  if (!PASSWORD_REGEX.test(password))  return res.status(400).json({ error: 'Mot de passe trop faible (min 8 chars, 1 lettre + 1 chiffre)' });

  const existing = await db.collection(USERS).doc(username).get();
  if (existing.exists) return res.status(409).json({ error: 'Nom d\'utilisateur déjà pris' });

  const hash = await bcrypt.hash(password, 12); // 12 rounds
  const id   = crypto.randomUUID();              // UUID réel, pas le username
  const user = { id, username, password: hash, createdAt: new Date().toISOString() };

  await db.collection(USERS).doc(username).set(user);

  const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username, id });
});

// ── LOGIN
router.post('/login', requireJSON, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Champs manquants' });
  if (!USERNAME_REGEX.test(username)) return res.status(400).json({ error: 'Identifiants incorrects' });

  const snap = await db.collection(USERS).doc(username).get();
  // Timing-safe: toujours faire le bcrypt compare même si user inexistant
  const hash = snap.exists ? snap.data().password : '$2a$12$invalidhashpaddingtosavetiming000000000000000000000000';
  const ok   = await bcrypt.compare(password, hash);
  if (!snap.exists || !ok) return res.status(401).json({ error: 'Identifiants incorrects' });

  const user  = snap.data();
  const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username, id: user.id });
});

// ── LOGOUT (blacklist token — Firestore persisté)
const tokenBlacklist = new Set(); // cache mémoire pour perf
async function revokeToken(token) {
  tokenBlacklist.add(token);
  try {
    // Stocker en Firestore avec TTL basé sur expiry JWT (7j)
    const payload = require('jsonwebtoken').decode(token);
    const exp = payload?.exp ? new Date(payload.exp * 1000).toISOString() : null;
    await db.collection('revoked_tokens').doc(
      require('crypto').createHash('sha256').update(token).digest('hex').slice(0, 20)
    ).set({ revokedAt: new Date().toISOString(), exp });
  } catch {}
}
// Cache négatif : tokens vérifiés et NON révoqués — évite hit Firestore à chaque requête
const notRevokedCache = new Map(); // token_hash → expiry timestamp
const NOT_REVOKED_TTL = 60_000; // 60s

async function isTokenRevoked(token) {
  if (tokenBlacklist.has(token)) return true;
  const hash = require('crypto').createHash('sha256').update(token).digest('hex').slice(0, 20);
  // Check negative cache
  const cached = notRevokedCache.get(hash);
  if (cached && Date.now() < cached) return false;
  try {
    const snap = await db.collection('revoked_tokens').doc(hash).get();
    if (snap.exists) { tokenBlacklist.add(token); return true; }
    // Token non révoqué — mettre en cache négatif
    notRevokedCache.set(hash, Date.now() + NOT_REVOKED_TTL);
  } catch {}
  return false;
}
router.post('/logout', authMiddleware, async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) await revokeToken(token);
  res.json({ success: true });
});

// ── ME
router.get('/me', authMiddleware, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username });
});

// ── CHANGE PASSWORD
router.post('/change-password', requireJSON, authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Champs manquants' });
  if (!PASSWORD_REGEX.test(newPassword)) return res.status(400).json({ error: 'Nouveau mot de passe trop faible' });

  const snap = await db.collection(USERS).doc(req.user.username).get();
  if (!snap.exists) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const ok = await bcrypt.compare(currentPassword, snap.data().password);
  if (!ok) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });

  const hash = await bcrypt.hash(newPassword, 12);
  await db.collection(USERS).doc(req.user.username).update({ password: hash });
  res.json({ success: true });
});

// ── Cleanup expired revoked tokens (run once at startup)
async function cleanupRevokedTokens() {
  try {
    const now  = new Date().toISOString();
    const snap = await db.collection('revoked_tokens').where('exp', '<', now).get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    if (!snap.empty) await batch.commit();
    console.log(`  🧹 ${snap.size} token(s) révoqué(s) expiré(s) supprimé(s)`);
  } catch {}
}
// Run cleanup at startup + every 24h
cleanupRevokedTokens();
setInterval(cleanupRevokedTokens, 24 * 60 * 60 * 1000);

module.exports = { router, encryptToken, decryptToken, tokenBlacklist, isTokenRevoked };
