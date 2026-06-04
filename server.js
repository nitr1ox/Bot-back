const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security headers
app.use(helmet({
  crossOriginEmbedderPolicy: false, // évite de casser les embeds Discord
}));

// ── CORS
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

// ── Body parser
app.use(express.json({ limit: '2mb' }));

// ── Rate limiting : auth (anti brute force)
app.use('/api/auth/login',    rateLimit({ windowMs: 15 * 60 * 1000, max: 10,  message: { error: 'Trop de tentatives, réessaie dans 15 min.' } }));
app.use('/api/auth/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 5,   message: { error: 'Trop d\'inscriptions depuis cette IP.' } }));
app.use('/api',               rateLimit({ windowMs: 60 * 1000,       max: 120, message: { error: 'Trop de requêtes.' } }));

// ── Routes
app.use('/api/auth', require('./routes/auth').router);
app.use('/api/bots', require('./middleware/auth').authMiddleware, require('./routes/bots'));
app.get('/api/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.get('/api/worker/status', require('./middleware/auth').authMiddleware, (req, res) => {
  const { clients } = require('./worker/runner');
  const running = [];
  for (const [botId, { client }] of clients) {
    running.push({ botId, tag: client.user?.tag || '?', guilds: client.guilds.cache.size });
  }
  res.json({ active: running.length, bots: running });
});

app.get('/', (_, res) => res.json({ status: 'AK-47 Bot API', version: '1.0.0' }));

// ── Global error handler (évite crash du process)
app.use((err, req, res, next) => {
  console.error('  ❌ Unhandled error:', err.message);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

// ── Uncaught exceptions (évite crash qui tuerait tous les bots)
process.on('uncaughtException', err => {
  console.error('  ❌ uncaughtException:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('  ❌ unhandledRejection:', reason);
});

app.listen(PORT, async () => {
  console.log(`\n  ⚡ AK-47 Bot API → http://localhost:${PORT}\n`);
  const { bootstrap } = require('./worker/runner');
  await bootstrap();
});
