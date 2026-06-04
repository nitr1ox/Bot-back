/**
 * Module: Économie
 * Système de monnaie virtuelle avec shop, inventaire, classement.
 * Commandes: /balance /daily /work /pay /shop /buy /inventory /leaderboard /addmoney /removemoney
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { loadData, saveData } = require('./persist');

// Economy store: in-memory cache backed by Firestore
const economy = new Map();

function getEco(guildId, userId) {
  if (!economy.has(guildId)) economy.set(guildId, new Map());
  const guild = economy.get(guildId);
  if (!guild.has(userId)) guild.set(userId, { balance: 0, inventory: [], lastDaily: 0, lastWork: 0 });
  return guild.get(userId);
}

async function loadEco(guildId, userId, botId) {
  const data = await loadData(botId || 'global', `${guildId}_${userId}`, 'eco').catch(() => null);
  if (data) {
    if (!economy.has(guildId)) economy.set(guildId, new Map());
    economy.get(guildId).set(userId, data);
  }
  return getEco(guildId, userId);
}

function saveEco(guildId, userId, botId) {
  const eco = getEco(guildId, userId);
  saveData(botId || 'global', `${guildId}_${userId}`, 'eco', eco).catch(() => {});
}

function getLeaderboard(guildId, limit = 10) {
  if (!economy.has(guildId)) return [];
  return [...economy.get(guildId).entries()]
    .sort((a, b) => b[1].balance - a[1].balance)
    .slice(0, limit);
}

// Per-guild shop
const shops = new Map();
function getShop(guildId) {
  if (!shops.has(guildId)) shops.set(guildId, [
    { id: 1, name: '🎭 Rôle VIP', price: 5000, description: 'Un rôle exclusif' },
    { id: 2, name: '🌟 Badge Or', price: 2500, description: 'Un badge brillant' },
    { id: 3, name: '🎪 Accès Salon', price: 1000, description: 'Accès salon privé' },
  ]);
  return shops.get(guildId);
}

const CURRENCY = '💰';
const DAILY_AMOUNT = 500;
const WORK_COOLDOWN = 3600000; // 1h
const DAILY_COOLDOWN = 86400000; // 24h
const WORK_AMOUNTS = [50, 100, 150, 200, 250, 300];
const WORK_MESSAGES = [
  'Tu as livré des pizzas', 'Tu as codé toute la nuit', 'Tu as streamé sur Twitch',
  'Tu as vendu des NFTs', 'Tu as bossé au McDo', 'Tu as fait du freelance',
];

function formatBalance(n) { return `${n.toLocaleString('fr-FR')} ${CURRENCY}`; }

// ── Slash
const slashCommands = [
  {
    data: new SlashCommandBuilder().setName('balance').setDescription('Voir votre solde ou celui d\'un membre')
      .addUserOption(o => o.setName('membre').setDescription('Membre (optionnel)')),
    async execute(i) {
      const target = i.options.getUser('membre') || i.user;
      const eco    = getEco(i.guild.id, target.id);
      await i.reply({ embeds: [new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle(`${CURRENCY} Solde — ${target.username}`)
        .setDescription(`**${formatBalance(eco.balance)}**`)
        .setThumbnail(target.displayAvatarURL({ size: 64 }))
        .setTimestamp()
      ]});
    },
  },
  {
    data: new SlashCommandBuilder().setName('daily').setDescription('Récupérer votre récompense quotidienne'),
    async execute(i) {
      const eco  = getEco(i.guild.id, i.user.id);
      const now  = Date.now();
      const left = DAILY_COOLDOWN - (now - eco.lastDaily);
      if (left > 0) {
        const h = Math.floor(left / 3600000);
        const m = Math.floor((left % 3600000) / 60000);
        return i.reply({ content: `⏳ Prochain daily dans **${h}h ${m}m**.`, ephemeral: true });
      }
      eco.balance   += DAILY_AMOUNT;
      eco.lastDaily  = now;
      await i.reply({ embeds: [new EmbedBuilder()
        .setColor(0x3ecf8e)
        .setTitle('🎁 Daily collecté !')
        .setDescription(`Tu as reçu **${formatBalance(DAILY_AMOUNT)}**\nSolde total : **${formatBalance(eco.balance)}**`)
        .setTimestamp()
      ]});
    },
  },
  {
    data: new SlashCommandBuilder().setName('work').setDescription('Travailler pour gagner des coins'),
    async execute(i) {
      const eco  = getEco(i.guild.id, i.user.id);
      const now  = Date.now();
      const left = WORK_COOLDOWN - (now - eco.lastWork);
      if (left > 0) {
        const m = Math.floor(left / 60000);
        return i.reply({ content: `⏳ Tu peux retravailler dans **${m} min**.`, ephemeral: true });
      }
      const amount  = WORK_AMOUNTS[Math.floor(Math.random() * WORK_AMOUNTS.length)];
      const message = WORK_MESSAGES[Math.floor(Math.random() * WORK_MESSAGES.length)];
      eco.balance  += amount;
      eco.lastWork  = now;
      await i.reply({ embeds: [new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('💼 Travail effectué !')
        .setDescription(`${message} et tu as gagné **${formatBalance(amount)}**\nSolde : **${formatBalance(eco.balance)}**`)
        .setTimestamp()
      ]});
    },
  },
  {
    data: new SlashCommandBuilder().setName('pay').setDescription('Envoyer des coins à un membre')
      .addUserOption(o => o.setName('membre').setDescription('Destinataire').setRequired(true))
      .addIntegerOption(o => o.setName('montant').setDescription('Montant').setMinValue(1).setRequired(true)),
    async execute(i) {
      const target  = i.options.getUser('membre');
      const amount  = i.options.getInteger('montant');
      const senderEco = getEco(i.guild.id, i.user.id);
      if (target.id === i.user.id) return i.reply({ content: '❌ Tu ne peux pas te payer toi-même.', ephemeral: true });
      if (senderEco.balance < amount) return i.reply({ content: `❌ Solde insuffisant (${formatBalance(senderEco.balance)}).`, ephemeral: true });
      senderEco.balance -= amount;
      getEco(i.guild.id, target.id).balance += amount;
      await i.reply({ embeds: [new EmbedBuilder()
        .setColor(0x3ecf8e)
        .setTitle('💸 Transfert effectué')
        .setDescription(`${i.user} → ${target}\n**Montant :** ${formatBalance(amount)}`)
        .setTimestamp()
      ]});
    },
  },
  {
    data: new SlashCommandBuilder().setName('shop').setDescription('Voir le shop'),
    async execute(i) {
      const shop  = getShop(i.guild.id);
      const lines = shop.map(item => `**${item.id}.** ${item.name} — ${formatBalance(item.price)}\n*${item.description}*`).join('\n\n');
      await i.reply({ embeds: [new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('🛒 Shop')
        .setDescription(lines || 'Le shop est vide.')
        .setFooter({ text: 'Utilise /buy <id> pour acheter' })
      ]});
    },
  },
  {
    data: new SlashCommandBuilder().setName('buy').setDescription('Acheter un article du shop')
      .addIntegerOption(o => o.setName('id').setDescription('ID de l\'article').setMinValue(1).setRequired(true)),
    async execute(i) {
      const id   = i.options.getInteger('id');
      const shop = getShop(i.guild.id);
      const item = shop.find(s => s.id === id);
      if (!item) return i.reply({ content: '❌ Article introuvable.', ephemeral: true });
      const eco = getEco(i.guild.id, i.user.id);
      if (eco.balance < item.price) return i.reply({ content: `❌ Solde insuffisant. Il te manque **${formatBalance(item.price - eco.balance)}**.`, ephemeral: true });
      eco.balance -= item.price;
      if (eco.inventory.length >= 50) return i.reply({ content: '❌ Inventaire plein (max 50 articles).', ephemeral: true });
      eco.inventory.push({ id: item.id, name: item.name, boughtAt: new Date().toISOString() });
      await i.reply({ embeds: [new EmbedBuilder()
        .setColor(0x3ecf8e)
        .setTitle('✅ Achat réussi !')
        .setDescription(`Tu as acheté **${item.name}** pour ${formatBalance(item.price)}\nSolde restant : **${formatBalance(eco.balance)}**`)
        .setTimestamp()
      ]});
    },
  },
  {
    data: new SlashCommandBuilder().setName('inventory').setDescription('Voir votre inventaire')
      .addUserOption(o => o.setName('membre').setDescription('Membre (optionnel)')),
    async execute(i) {
      const target = i.options.getUser('membre') || i.user;
      const eco    = getEco(i.guild.id, target.id);
      const lines  = eco.inventory.length
        ? eco.inventory.map((item, idx) => `**${idx+1}.** ${item.name}`).join('\n')
        : '*Inventaire vide.*';
      await i.reply({ embeds: [new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🎒 Inventaire — ${target.username}`)
        .setDescription(lines)
      ]});
    },
  },
  {
    data: new SlashCommandBuilder().setName('leaderboard').setDescription('Classement économie'),
    async execute(i) {
      await i.deferReply();
      const lb = getLeaderboard(i.guild.id);
      if (!lb.length) return i.editReply('Aucune donnée.');
      const medals = ['🥇','🥈','🥉'];
      const lines  = lb.map(([userId, data], idx) => {
        const medal = medals[idx] || `**${idx+1}.**`;
        return `${medal} <@${userId}> — ${formatBalance(data.balance)}`;
      }).join('\n');
      await i.editReply({ embeds: [new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('🏆 Classement')
        .setDescription(lines)
        .setTimestamp()
      ]});
    },
  },
  {
    data: new SlashCommandBuilder().setName('addmoney').setDescription('Ajouter des coins à un membre (admin)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
      .addIntegerOption(o => o.setName('montant').setDescription('Montant').setMinValue(1).setRequired(true)),
    async execute(i) {
      const target = i.options.getUser('membre');
      const amount = i.options.getInteger('montant');
      getEco(i.guild.id, target.id).balance += amount;
      await i.reply({ content: `✅ **+${formatBalance(amount)}** ajoutés à ${target.tag}.`, ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder().setName('removemoney').setDescription('Retirer des coins à un membre (admin)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
      .addIntegerOption(o => o.setName('montant').setDescription('Montant').setMinValue(1).setRequired(true)),
    async execute(i) {
      const target = i.options.getUser('membre');
      const amount = i.options.getInteger('montant');
      const eco    = getEco(i.guild.id, target.id);
      eco.balance  = Math.max(0, eco.balance - amount);
    eco.balance  = Math.min(eco.balance, 10_000_000);
      await i.reply({ content: `✅ **-${formatBalance(amount)}** retirés à ${target.tag}.`, ephemeral: true });
    },
  },
];

// ── Prefix
const prefixCommands = [
  { name: 'balance', aliases: ['bal','$'],
    async execute(msg, args) {
      const target = msg.mentions.users.first() || msg.author;
      const eco    = getEco(msg.guild.id, target.id);
      msg.reply({ embeds: [new EmbedBuilder().setColor(0xf5c518).setTitle(`${CURRENCY} Solde — ${target.username}`).setDescription(`**${formatBalance(eco.balance)}**`)] });
    }},
  { name: 'daily',
    async execute(msg) {
      const eco = getEco(msg.guild.id, msg.author.id);
      const now = Date.now();
      const left = DAILY_COOLDOWN - (now - eco.lastDaily);
      if (left > 0) { const h=Math.floor(left/3600000),m=Math.floor((left%3600000)/60000); return msg.reply(`⏳ Daily dans **${h}h ${m}m**.`); }
      eco.balance += DAILY_AMOUNT; eco.lastDaily = now;
      msg.reply({ embeds: [new EmbedBuilder().setColor(0x3ecf8e).setTitle('🎁 Daily!').setDescription(`+${formatBalance(DAILY_AMOUNT)} → **${formatBalance(eco.balance)}**`)] });
    }},
  { name: 'work', aliases: ['travailler'],
    async execute(msg) {
      const eco = getEco(msg.guild.id, msg.author.id);
      const now = Date.now();
      const left = WORK_COOLDOWN - (now - eco.lastWork);
      if (left > 0) { const m=Math.floor(left/60000); return msg.reply(`⏳ Retravaille dans **${m} min**.`); }
      const amount = WORK_AMOUNTS[Math.floor(Math.random()*WORK_AMOUNTS.length)];
      const message = WORK_MESSAGES[Math.floor(Math.random()*WORK_MESSAGES.length)];
      eco.balance += amount; eco.lastWork = now;
      msg.reply(`💼 ${message} → **+${formatBalance(amount)}** (total: ${formatBalance(eco.balance)})`);
    }},
  { name: 'pay', aliases: ['give'],
    async execute(msg, args) {
      const target = msg.mentions.users.first(); const amount = parseInt(args[1]);
      if (!target || !amount) return msg.reply('Usage: `!pay @membre montant`');
      const s = getEco(msg.guild.id, msg.author.id);
      if (s.balance < amount) return msg.reply('❌ Solde insuffisant.');
      s.balance -= amount; getEco(msg.guild.id, target.id).balance += amount;
      msg.reply(`✅ **${formatBalance(amount)}** envoyés à ${target.tag}.`);
    }},
  { name: 'shop',
    async execute(msg) {
      const shop = getShop(msg.guild.id);
      const lines = shop.map(i => `**${i.id}.** ${i.name} — ${formatBalance(i.price)}`).join('\n');
      msg.reply({ embeds: [new EmbedBuilder().setColor(0xf5c518).setTitle('🛒 Shop').setDescription(lines)] });
    }},
  { name: 'buy', aliases: ['acheter'],
    async execute(msg, args) {
      const id = parseInt(args[0]); const shop = getShop(msg.guild.id);
      const item = shop.find(s => s.id === id);
      if (!item) return msg.reply('❌ Article introuvable.');
      const eco = getEco(msg.guild.id, msg.author.id);
      if (eco.balance < item.price) return msg.reply(`❌ Solde insuffisant.`);
      if (eco.inventory.length >= 50) return msg.reply('❌ Inventaire plein (max 50 articles).');
      eco.balance -= item.price; eco.inventory.push({ id: item.id, name: item.name });
      msg.reply(`✅ **${item.name}** acheté ! Solde : ${formatBalance(eco.balance)}`);
    }},
  { name: 'leaderboard', aliases: ['lb','top'],
    async execute(msg) {
      const lb = getLeaderboard(msg.guild.id);
      if (!lb.length) return msg.reply('Aucune donnée.');
      const lines = lb.map(([uid, d], i) => `**${i+1}.** <@${uid}> — ${formatBalance(d.balance)}`).join('\n');
      msg.reply({ embeds: [new EmbedBuilder().setColor(0xf5c518).setTitle('🏆 Classement').setDescription(lines)] });
    }},
];

module.exports = { slashCommands, prefixCommands };
