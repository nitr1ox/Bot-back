const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

// Static frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/bots', require('./middleware/auth').authMiddleware, require('./routes/bots'));
app.get('/api/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Worker status endpoint
app.get('/api/worker/status', require('./middleware/auth').authMiddleware, (req, res) => {
  const { clients } = require('./worker/runner');
  const running = [];
  for (const [botId, { client }] of clients) {
    running.push({ botId, tag: client.user?.tag || '?', guilds: client.guilds.cache.size });
  }
  res.json({ active: running.length, bots: running });
});

// SPA fallback
app.get('*', (req, res) => {
  const known = ['/dashboard.html', '/index.html', '/'];
  if (known.includes(req.path)) {
    const file = req.path === '/dashboard.html' ? 'dashboard.html' : 'index.html';
    return res.sendFile(path.join(__dirname, '../frontend', file));
  }
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, async () => {
  console.log(`\n  ⚡ AK-47 Bot Manager → http://localhost:${PORT}\n`);
  // Start bot runner after server is up
  const { bootstrap } = require('./worker/runner');
  await bootstrap();
});
