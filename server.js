const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));

// Static frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/bots', require('./middleware/auth').authMiddleware, require('./routes/bots'));
app.get('/api/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// SPA fallback — ne pas écraser les fichiers HTML connus
app.get('*', (req, res) => {
  const knownPages = ['/dashboard.html', '/index.html', '/'];
  if (knownPages.includes(req.path)) {
    const file = req.path === '/dashboard.html' ? 'dashboard.html' : 'index.html';
    return res.sendFile(path.join(__dirname, '../frontend', file));
  }
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => console.log(`\n  ⚡ AK-47 Bot Manager → http://localhost:${PORT}\n`));
