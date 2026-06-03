const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

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

app.get('/', (_, res) => res.json({ status: 'AK-47 Bot API', version: '1.0.0' }));

app.listen(PORT, async () => {
  console.log(`\n  ⚡ AK-47 Bot API → http://localhost:${PORT}\n`);
  const { bootstrap } = require('./worker/runner');
  await bootstrap();
});
