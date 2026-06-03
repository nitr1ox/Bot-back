const express = require('express');
const { db }  = require('../firebase');

const router = express.Router();

// Collection path: bots/{userId}/items/{botId}
const col = (userId) => db.collection('bots').doc(userId).collection('items');

// ── GET ALL ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const snap = await col(req.user.id).orderBy('createdAt', 'desc').get();
  const bots = snap.docs.map(d => sanitize(d.data()));
  res.json(bots);
});

// ── CREATE ─────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, token, types, slash, prefix, prefixChar, logs, sparkData } = req.body;
  if (!token)              return res.status(400).json({ error: 'Token requis' });
  if (!types?.length)      return res.status(400).json({ error: 'Module requis' });

  const ref = col(req.user.id).doc();
  const bot = {
    id:         ref.id,
    name:       name || 'Bot#' + Math.floor(1000 + Math.random() * 9000),
    token,
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
    logs:       (logs || []).slice(0, 40),
    sparkData:  sparkData || Array.from({ length: 12 }, () => Math.floor(Math.random() * 30)),
    lastSeen:   new Date().toISOString(),
  };

  await ref.set(bot);
  res.status(201).json(sanitize(bot));
});

// ── GET ONE ────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const snap = await col(req.user.id).doc(req.params.id).get();
  if (!snap.exists) return res.status(404).json({ error: 'Bot introuvable' });
  res.json(sanitize(snap.data()));
});

// ── UPDATE ─────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const ref  = col(req.user.id).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Bot introuvable' });

  const allowed = ['name','types','slash','prefix','prefixChar','status',
                   'startedAt','cmdCount','totalCmds','logs','sparkData','lastSeen'];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  if (req.body.token) {
    updates.token  = req.body.token;
    updates.masked = req.body.token.slice(0,8) + '••••••' + req.body.token.slice(-4);
  }
  updates.lastSeen = new Date().toISOString();

  await ref.update(updates);
  const updated = (await ref.get()).data();
  res.json(sanitize(updated));
});

// ── DELETE ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const ref  = col(req.user.id).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Bot introuvable' });
  const name = snap.data().name;
  await ref.delete();
  res.json({ success: true, name });
});

// ── STATS ──────────────────────────────────────────────────
router.get('/meta/stats', async (req, res) => {
  const snap   = await col(req.user.id).get();
  const bots   = snap.docs.map(d => d.data());
  const running = bots.filter(b => b.status === 'running');
  const cmds   = bots.reduce((a, b) => a + (b.totalCmds || 0), 0);
  const freq   = {};
  bots.forEach(b => { if (b.types?.[0]) freq[b.types[0]] = (freq[b.types[0]] || 0) + 1; });
  const topModule = Object.entries(freq).sort((a,b) => b[1]-a[1])[0]?.[0] || null;
  res.json({ total: bots.length, running: running.length, cmds, topModule });
});

function sanitize(bot) {
  const { token, ...rest } = bot;
  return { ...rest, hasToken: !!token };
}

module.exports = router;
