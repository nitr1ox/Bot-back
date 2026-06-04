const express = require('express');
const { db }  = require('../firebase');
const { encryptToken, decryptToken } = require('./auth');

// Validate Discord bot token format (MTxxxxxx.xxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxx)
function isValidDiscordToken(token) {
  if (!token || typeof token !== 'string') return false;
  // Discord tokens: base64(user_id).base64(timestamp).hmac — 3 parts séparés par des points
  const parts = token.split('.');
  return parts.length === 3 && parts[0].length >= 10 && parts[1].length >= 6;
}

const router = express.Router();

// Collection path: bots/{userId}/items/{botId}
const col = (userId) => db.collection('bots').doc(userId).collection('items');

// ── GET ALL ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const snap = await col(req.user.id).get();
    const bots = snap.docs.map(d => sanitize(d.data()))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(bots);
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── CREATE ─────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, token, types, slash, prefix, prefixChar, logs, sparkData } = req.body;
  const VALID_MODULES = ['ticket','automod','moderation','welcome','logs','economy','giveaway','music'];
  if (!token)              return res.status(400).json({ error: 'Token requis' });
  if (!isValidDiscordToken(token)) return res.status(400).json({ error: 'Token Discord invalide' });
  if (!types?.length)      return res.status(400).json({ error: 'Module requis' });
  if (!types.every(t => VALID_MODULES.includes(t))) return res.status(400).json({ error: 'Module invalide' });
  if (prefixChar && prefixChar.length !== 1) return res.status(400).json({ error: 'prefixChar doit être 1 caractère' });

  // Validate name length
  const safeName = (name || 'Bot#' + Math.floor(1000 + Math.random() * 9000)).slice(0, 32);

  const ref = col(req.user.id).doc();
  const bot = {
    id:         ref.id,
    name:       safeName,
    token:      encryptToken(token),
    masked:     token.slice(0,8) + '••••••' + token.slice(-4),
    types:      types || [],
    slash:      slash  ?? true,
    prefix:     prefix ?? false,
    prefixChar: prefixChar || '!',
    status:     'running',
    startedAt:  new Date().toISOString(),
    createdAt:  new Date().toISOString(),
    cmdCount:   0,
    totalCmds:  0,
    logs:       [],
    sparkData:  Array(12).fill(0),
    lastSeen:   new Date().toISOString(),
  };

  await ref.set(bot);
  res.status(201).json(sanitize(bot));
});

// ── GET ONE ────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const snap = await col(req.user.id).doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: 'Bot introuvable' });
    res.json(sanitize(snap.data()));
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── UPDATE ─────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
  const ref  = col(req.user.id).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Bot introuvable' });

  if (req.body.name) req.body.name = req.body.name.slice(0, 32);
  // status ne peut pas être modifié directement par le client — le runner est la source de vérité
  const allowed = ['name','types','slash','prefix','prefixChar',
                   'cmdCount','totalCmds','logs','sparkData'];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  if (req.body.token) {
    if (!isValidDiscordToken(req.body.token)) return res.status(400).json({ error: 'Token Discord invalide' });
    updates.token  = encryptToken(req.body.token);
    updates.masked = req.body.token.slice(0,8) + '••••••' + req.body.token.slice(-4);
  }
  updates.lastSeen = new Date().toISOString();

    await ref.update(updates);
    const updated = (await ref.get()).data();
    res.json(sanitize(updated));
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── DELETE ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const ref  = col(req.user.id).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Bot introuvable' });
  const { name, id: botId } = snap.data();
  // Stopper le bot runner avant suppression
  try {
    const { stopBot } = require('../worker/runner');
    await stopBot(botId, req.user.id);
  } catch {}
  await ref.delete();
  res.json({ success: true, name });
});

// ── STATS ──────────────────────────────────────────────────
router.get('/meta/stats', async (req, res) => {
  try {
    const snap   = await col(req.user.id).get();
    const bots   = snap.docs.map(d => d.data());
    const running = bots.filter(b => b.status === 'running');
    const cmds   = bots.reduce((a, b) => a + (b.totalCmds || 0), 0);
    const freq   = {};
    bots.forEach(b => { if (b.types?.[0]) freq[b.types[0]] = (freq[b.types[0]] || 0) + 1; });
    const topModule = Object.entries(freq).sort((a,b) => b[1]-a[1])[0]?.[0] || null;
    res.json({ total: bots.length, running: running.length, cmds, topModule });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

function sanitize(bot) {
  const { token, ...rest } = bot;
  return { ...rest, hasToken: !!token };
}

module.exports = router;
