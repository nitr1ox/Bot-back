/**
 * AK-47 Bot Runner
 * Manages one discord.js Client per bot stored in Firestore.
 * Integrated into server.js — no separate process needed.
 */

const { Client, GatewayIntentBits, Partials, Collection, REST, Routes, ActivityType } = require('discord.js');
const { db } = require('../firebase');

// ── Active clients map: botId → { client, unsubscribe }
const clients = new Map();

// ── Module loaders
const MODULES = {
  ticket:     require('./modules/ticket'),
  automod:    require('./modules/automod'),
  moderation: require('./modules/moderation'),
  welcome:    require('./modules/welcome'),
  logs:       require('./modules/logs'),
  economy:    require('./modules/economy'),
  giveaway:   require('./modules/giveaway'),
  music:      require('./modules/music'),
};

// ── Intents needed by module
const MODULE_INTENTS = {
  ticket:     [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions],
  automod:    [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
  moderation: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
  welcome:    [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  logs:       [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessageReactions],
  economy:    [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  giveaway:   [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions],
  music:      [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates],
};

// ── Push a log entry to Firestore
async function pushLog(userId, botId, level, msg) {
  try {
    const ref = db.collection('bots').doc(userId).collection('items').doc(botId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const logs = snap.data().logs || [];
    logs.unshift({ t: new Date().toISOString(), level, msg });
    await ref.update({ logs: logs.slice(0, 40), lastSeen: new Date().toISOString() });
  } catch {}
}

// ── Increment command counter
async function incCmds(userId, botId) {
  try {
    const ref = db.collection('bots').doc(userId).collection('items').doc(botId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const d = snap.data();
    await ref.update({
      cmdCount:   (d.cmdCount  || 0) + 1,
      totalCmds:  (d.totalCmds || 0) + 1,
    });
  } catch {}
}

// ── Register slash commands for a bot
async function registerSlashCommands(token, clientId, commands) {
  try {
    const rest = new REST({ version: '10' }).setToken(token);
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log(`  ✅ Slash commands registered for ${clientId}`);
  } catch (e) {
    console.error(`  ⚠️  Slash register failed: ${e.message}`);
  }
}

// ── Start a single bot
async function startBot(userId, botData) {
  const { id: botId, token, types = [], slash, prefix, prefixChar = '!' } = botData;

  if (clients.has(botId)) return; // already running
  if (!token) return;

  // Collect intents for active modules
  const intentSet = new Set([GatewayIntentBits.Guilds]);
  for (const t of types) {
    (MODULE_INTENTS[t] || []).forEach(i => intentSet.add(i));
  }

  const client = new Client({
    intents: [...intentSet],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });

  // Commands registry
  client.commands       = new Collection(); // slash
  client.prefixCommands = new Collection(); // prefix
  client.botMeta        = { userId, botId, slash, prefix, prefixChar };

  // Load modules
  const slashDefs = [];
  for (const type of types) {
    const mod = MODULES[type];
    if (!mod) continue;
    if (mod.slashCommands) {
      for (const cmd of mod.slashCommands) {
        client.commands.set(cmd.data.name, { ...cmd, _module: type });
        slashDefs.push(cmd.data.toJSON ? cmd.data.toJSON() : cmd.data);
      }
    }
    if (mod.prefixCommands) {
      for (const cmd of mod.prefixCommands) {
        client.prefixCommands.set(cmd.name, { ...cmd, _module: type });
        // Also register aliases
        (cmd.aliases || []).forEach(a => client.prefixCommands.set(a, { ...cmd, _module: type }));
      }
    }
    if (mod.onReady) client.once('ready', () => mod.onReady(client));
    if (mod.register) mod.register(client);
  }

  // ── READY
  client.once('ready', async () => {
    console.log(`  🤖 [${botData.name}] connecté en tant que ${client.user.tag}`);

    // Rotating status
    const moduleLabel = types[0] || 'bot';
    const cmdLabel    = slash && prefix
      ? `/${prefixChar} ${moduleLabel}`
      : slash  ? `/ ${moduleLabel}`
      : prefix ? `${prefixChar} ${moduleLabel}`
      : moduleLabel;

    const statuses = [
      { text: 'bot.ak-47.fr',           type: ActivityType.Streaming, url: 'https://bot.ak-47.fr' },
      { text: 'Free bot — bot.ak-47.fr', type: ActivityType.Watching },
      { text: cmdLabel,                  type: ActivityType.Playing },
    ];

    let idx = 0;
    const rotate = () => {
      const s = statuses[idx % statuses.length];
      if (s.type === ActivityType.Streaming) {
        client.user.setActivity({ name: s.text, type: s.type, url: s.url });
      } else {
        client.user.setActivity({ name: s.text, type: s.type });
      }
      idx++;
    };
    rotate();
    client._rotateInterval = setInterval(rotate, 15_000);

    await db.collection('bots').doc(userId).collection('items').doc(botId).update({
      status:    'running',
      startedAt: new Date().toISOString(),
      clientId:  client.user.id,
    });
    await pushLog(userId, botId, 'ok', `Connecté en tant que ${client.user.tag}`);

    // Register slash commands if enabled
    if (slash && slashDefs.length > 0) {
      await registerSlashCommands(token, client.user.id, slashDefs);
      await pushLog(userId, botId, 'info', `${slashDefs.length} commandes slash enregistrées`);
    }
  });

  // ── SLASH COMMAND INTERACTION
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (!slash) return;

    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) return;

    try {
      await cmd.execute(interaction, client);
      await incCmds(userId, botId);
      await pushLog(userId, botId, 'info', `/${interaction.commandName} utilisé par ${interaction.user.tag}`);
    } catch (e) {
      console.error(e);
      await pushLog(userId, botId, 'err', `Erreur /${interaction.commandName}: ${e.message}`);
      const reply = { content: '❌ Une erreur est survenue.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
      else await interaction.reply(reply);
    }
  });

  // ── PREFIX COMMAND
  client.on('messageCreate', async message => {
    if (!prefix || message.author.bot) return;
    if (!message.content.startsWith(prefixChar)) return;

    const args    = message.content.slice(prefixChar.length).trim().split(/\s+/);
    const cmdName = args.shift().toLowerCase();
    const cmd     = client.prefixCommands.get(cmdName);
    if (!cmd) return;

    try {
      await cmd.execute(message, args, client);
      await incCmds(userId, botId);
      await pushLog(userId, botId, 'info', `${prefixChar}${cmdName} utilisé par ${message.author.tag}`);
    } catch (e) {
      console.error(e);
      await pushLog(userId, botId, 'err', `Erreur ${prefixChar}${cmdName}: ${e.message}`);
      message.reply('❌ Une erreur est survenue.').catch(() => {});
    }
  });

  // ── ERRORS
  client.on('error', async e => {
    console.error(`  ❌ [${botData.name}] ${e.message}`);
    await pushLog(userId, botId, 'err', e.message);
  });

  client.on('warn', async w => {
    await pushLog(userId, botId, 'warn', w);
  });

  // ── LOGIN
  try {
    await client.login(token);
    clients.set(botId, { client, userId });
  } catch (e) {
    console.error(`  ❌ [${botData.name}] Login failed: ${e.message}`);
    await pushLog(userId, botId, 'err', `Login échoué: ${e.message}`);
    await db.collection('bots').doc(userId).collection('items').doc(botId)
      .update({ status: 'stopped' }).catch(() => {});
  }
}

// ── Stop a single bot
async function stopBot(botId, userId) {
  const entry = clients.get(botId);
  if (!entry) return;
  try {
    if (entry.client._rotateInterval) clearInterval(entry.client._rotateInterval);
    entry.client.destroy();
  } catch {}
  clients.delete(botId);
  if (userId) {
    await pushLog(userId, botId, 'warn', 'Bot déconnecté');
    await db.collection('bots').doc(userId).collection('items').doc(botId)
      .update({ status: 'stopped' }).catch(() => {});
  }
  console.log(`  ⏹ Bot ${botId} arrêté`);
}

// ── Watch all users' bots via Firestore realtime listeners
async function watchAllBots() {
  // Get all user IDs first, then watch each user's bot subcollection
  const usersSnap = await db.collection('bots').get();
  for (const userDoc of usersSnap.docs) {
    watchUserBots(userDoc.id);
  }
  // Also watch for new users (new bot created by a user who had none before)
  db.collection('bots').onSnapshot(snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') watchUserBots(change.doc.id);
    });
  });
}

function watchUserBots(userId) {
  db.collection('bots').doc(userId).collection('items')
    .onSnapshot(snap => {
      snap.docChanges().forEach(async change => {
        const bot = change.doc.data();
        const botId = bot.id || change.doc.id;

        if (change.type === 'removed') {
          await stopBot(botId, userId);
          return;
        }

        const isRunning = clients.has(botId);
        const shouldRun = bot.status === 'running';

        if (shouldRun && !isRunning) {
          console.log(`  ▶ Démarrage bot [${bot.name}] (user: ${userId})`);
          await startBot(userId, { ...bot, id: botId });
        } else if (!shouldRun && isRunning) {
          console.log(`  ⏹ Arrêt bot [${bot.name}] (user: ${userId})`);
          await stopBot(botId, userId);
        }
      });
    }, err => {
      console.error(`  ⚠️  Watch error for user ${userId}:`, err.message);
    });
}

// ── Bootstrap: start all bots that are status=running
async function bootstrap() {
  console.log('\n  🔄 AK-47 Worker — chargement des bots...');
  try {
    const usersSnap = await db.collection('bots').get();
    let total = 0;
    for (const userDoc of usersSnap.docs) {
      const botsSnap = await db.collection('bots').doc(userDoc.id).collection('items')
        .where('status', '==', 'running').get();
      for (const botDoc of botsSnap.docs) {
        const bot = botDoc.data();
        await startBot(userDoc.id, { ...bot, id: botDoc.id });
        total++;
        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 500));
      }
    }
    console.log(`  ✅ ${total} bot(s) démarré(s)\n`);
    await watchAllBots();
  } catch (e) {
    console.error('  ❌ Bootstrap error:', e.message);
  }
}

// ── Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\n  🛑 Arrêt des bots...');
  for (const [botId, { client }] of clients) {
    try { client.destroy(); } catch {}
  }
  clients.clear();
});

module.exports = { bootstrap, startBot, stopBot, clients };
