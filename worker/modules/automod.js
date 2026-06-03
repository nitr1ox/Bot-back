/**
 * Module: AutoMod
 * Protection automatique du serveur.
 *
 * Fonctionnalités:
 *  - Anti-spam        : détecte les messages répétés rapidement
 *  - Anti-liens       : bloque les URLs (sauf whitelist)
 *  - Filtre mots      : censure les mots interdits
 *  - Anti-caps        : bloque les messages en majuscules excessives
 *  - Anti-mentions    : bloque les mass-mentions (@everyone, many @user)
 *  - Système de warns : 3 warns → mute 10min, 5 warns → ban temporaire
 *
 * Commandes:
 *  /automod config <règle> <on|off>
 *  /automod warns @user
 *  /automod clearwarns @user
 *  /automod addword <mot>
 *  /automod removeword <mot>
 *  /automod whitelist <domaine>
 *
 *  Préfix: !automod ...
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');

// ── In-memory state (per client) — survives restarts via DB si besoin
// Structure: guildId → { spam: Map<userId, {msgs, timer}>, warns: Map<userId, count>, config, badwords, whitelist }
const guildState = new Map();

function getState(guildId) {
  if (!guildState.has(guildId)) {
    guildState.set(guildId, {
      spam:      new Map(),  // userId → { msgs: [], timer }
      warns:     new Map(),  // userId → count
      muted:     new Set(),  // userId (currently muted by automod)
      config: {
        antiSpam:      true,
        antiLinks:     true,
        antiCaps:      true,
        antiMentions:  true,
        badWords:      true,
      },
      badWords:   new Set(['spam','insulte','hate']),
      whitelist:  new Set(['discord.com','discord.gg','tenor.com','giphy.com','imgur.com']),
    });
  }
  return guildState.get(guildId);
}

// ── URL regex
const URL_REGEX = /https?:\/\/[^\s]+|discord\.gg\/[^\s]+/gi;

// ── Caps check (>70% majuscules sur 10+ chars)
function isCapsAbuse(content) {
  const letters = content.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 10) return false;
  const upper = letters.replace(/[^A-Z]/g, '');
  return upper.length / letters.length > 0.7;
}

// ── Check if URL is whitelisted
function isWhitelisted(url, whitelist) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return whitelist.has(hostname);
  } catch {
    return false;
  }
}

// ── Send mod log to a #mod-logs or #automod-logs channel if exists
async function modLog(guild, embed) {
  const logChannel = guild.channels.cache.find(c =>
    c.type === ChannelType.GuildText &&
    ['mod-logs', 'modlogs', 'automod-logs', 'automod', 'logs'].includes(c.name.toLowerCase())
  );
  if (logChannel) logChannel.send({ embeds: [embed] }).catch(() => {});
}

// ── Warn a user
async function warnUser(message, reason) {
  const state = getState(message.guild.id);
  const userId = message.author.id;
  const warns = (state.warns.get(userId) || 0) + 1;
  state.warns.set(userId, warns);

  // Delete offending message
  message.delete().catch(() => {});

  // Notify
  message.channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0xf5c518)
      .setTitle('⚠️ Avertissement AutoMod')
      .setDescription(`${message.author} a été averti.\n**Raison :** ${reason}\n**Total :** ${warns} avertissement(s)`)
      .setTimestamp()],
  }).then(m => setTimeout(() => m.delete().catch(() => {}), 8000));

  await modLog(message.guild, new EmbedBuilder()
    .setColor(0xf5c518)
    .setTitle('⚠️ AutoMod — Avertissement')
    .addFields(
      { name: 'Utilisateur', value: `${message.author.tag} (${userId})`, inline: true },
      { name: 'Raison', value: reason, inline: true },
      { name: 'Warns total', value: String(warns), inline: true },
      { name: 'Channel', value: String(message.channel), inline: true },
    )
    .setTimestamp()
  );

  // Escalation
  if (warns >= 5) {
    try {
      await message.member.ban({ reason: `AutoMod: ${warns} avertissements`, deleteMessageSeconds: 60 });
      message.channel.send(`🔨 ${message.author.tag} a été banni automatiquement (${warns} warns).`)
        .then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
      await modLog(message.guild, new EmbedBuilder()
        .setColor(0xe5484d)
        .setTitle('🔨 AutoMod — Ban automatique')
        .setDescription(`${message.author.tag} banni après ${warns} avertissements.`)
        .setTimestamp()
      );
    } catch {}
  } else if (warns >= 3 && !state.muted.has(userId)) {
    try {
      state.muted.add(userId);
      await message.member.timeout(10 * 60 * 1000, `AutoMod: ${warns} avertissements`);
      message.channel.send(`🔇 ${message.author.tag} a été muté 10 minutes (${warns} warns).`)
        .then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
      setTimeout(() => state.muted.delete(userId), 10 * 60 * 1000);
      await modLog(message.guild, new EmbedBuilder()
        .setColor(0xe040a0)
        .setTitle('🔇 AutoMod — Mute')
        .setDescription(`${message.author.tag} muté 10min après ${warns} avertissements.`)
        .setTimestamp()
      );
    } catch {}
  }
}

// ── Core message handler
async function handleMessage(message) {
  if (!message.guild) return;
  if (message.author.bot) return;
  if (!message.member) return;

  // Skip staff/admins
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  const state = getState(message.guild.id);
  const content = message.content;

  // 1. Anti-spam (5 messages en 5 secondes)
  if (state.config.antiSpam) {
    const now = Date.now();
    if (!state.spam.has(message.author.id)) {
      state.spam.set(message.author.id, { msgs: [], timer: null });
    }
    const entry = state.spam.get(message.author.id);
    entry.msgs.push(now);
    entry.msgs = entry.msgs.filter(t => now - t < 5000);
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => state.spam.delete(message.author.id), 6000);
    if (entry.msgs.length >= 5) {
      state.spam.delete(message.author.id);
      return warnUser(message, `Spam détecté (${entry.msgs.length} messages en 5s)`);
    }
  }

  // 2. Anti-liens
  if (state.config.antiLinks) {
    const matches = content.match(URL_REGEX);
    if (matches) {
      const blocked = matches.filter(url => !isWhitelisted(url, state.whitelist));
      if (blocked.length > 0) {
        return warnUser(message, `Lien non autorisé: ${blocked[0]}`);
      }
    }
  }

  // 3. Bad words
  if (state.config.badWords) {
    const lower = content.toLowerCase();
    for (const word of state.badWords) {
      if (lower.includes(word.toLowerCase())) {
        return warnUser(message, `Mot interdit détecté`);
      }
    }
  }

  // 4. Anti-caps
  if (state.config.antiCaps && isCapsAbuse(content)) {
    return warnUser(message, 'Trop de majuscules');
  }

  // 5. Anti mass-mentions
  if (state.config.antiMentions) {
    const mentionCount = message.mentions.users.size + (message.mentions.everyone ? 1 : 0);
    if (mentionCount >= 5 || message.mentions.everyone) {
      return warnUser(message, `Mass-mention détectée (${mentionCount} mentions)`);
    }
  }
}

// ── Slash commands ─────────────────────────────────────────────────────────

const slashCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('automod')
      .setDescription('Gestion de l\'AutoMod')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addSubcommand(sub => sub
        .setName('config')
        .setDescription('Active/désactive une règle AutoMod')
        .addStringOption(opt => opt
          .setName('règle')
          .setDescription('Règle à modifier')
          .setRequired(true)
          .addChoices(
            { name: 'Anti-Spam', value: 'antiSpam' },
            { name: 'Anti-Liens', value: 'antiLinks' },
            { name: 'Anti-Caps', value: 'antiCaps' },
            { name: 'Anti-Mentions', value: 'antiMentions' },
            { name: 'Mots interdits', value: 'badWords' },
          ))
        .addStringOption(opt => opt
          .setName('état')
          .setDescription('on ou off')
          .setRequired(true)
          .addChoices({ name: 'Activer', value: 'on' }, { name: 'Désactiver', value: 'off' })))
      .addSubcommand(sub => sub
        .setName('warns')
        .setDescription('Voir les avertissements d\'un utilisateur')
        .addUserOption(opt => opt.setName('utilisateur').setDescription('Utilisateur').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('clearwarns')
        .setDescription('Effacer les avertissements d\'un utilisateur')
        .addUserOption(opt => opt.setName('utilisateur').setDescription('Utilisateur').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('addword')
        .setDescription('Ajouter un mot interdit')
        .addStringOption(opt => opt.setName('mot').setDescription('Mot à bloquer').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('removeword')
        .setDescription('Retirer un mot interdit')
        .addStringOption(opt => opt.setName('mot').setDescription('Mot à débloquer').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('whitelist')
        .setDescription('Ajouter un domaine à la whitelist liens')
        .addStringOption(opt => opt.setName('domaine').setDescription('ex: youtube.com').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('status')
        .setDescription('Voir la configuration AutoMod')),

    async execute(interaction) {
      const sub   = interaction.options.getSubcommand();
      const state = getState(interaction.guild.id);

      if (sub === 'config') {
        const rule  = interaction.options.getString('règle');
        const value = interaction.options.getString('état') === 'on';
        state.config[rule] = value;
        await interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(value ? 0x3ecf8e : 0xe5484d)
            .setDescription(`**${rule}** : ${value ? '✅ Activé' : '❌ Désactivé'}`)],
          ephemeral: true,
        });
      }

      else if (sub === 'warns') {
        const user  = interaction.options.getUser('utilisateur');
        const warns = state.warns.get(user.id) || 0;
        await interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(0xf5c518)
            .setTitle(`⚠️ Avertissements — ${user.tag}`)
            .setDescription(`**${warns}** avertissement(s)`)],
          ephemeral: true,
        });
      }

      else if (sub === 'clearwarns') {
        const user = interaction.options.getUser('utilisateur');
        state.warns.delete(user.id);
        await interaction.reply({ content: `✅ Avertissements de ${user.tag} effacés.`, ephemeral: true });
      }

      else if (sub === 'addword') {
        const word = interaction.options.getString('mot').toLowerCase();
        state.badWords.add(word);
        await interaction.reply({ content: `✅ Mot \`${word}\` ajouté à la liste.`, ephemeral: true });
      }

      else if (sub === 'removeword') {
        const word = interaction.options.getString('mot').toLowerCase();
        state.badWords.delete(word);
        await interaction.reply({ content: `✅ Mot \`${word}\` retiré de la liste.`, ephemeral: true });
      }

      else if (sub === 'whitelist') {
        const domain = interaction.options.getString('domaine').replace(/^www\./, '').toLowerCase();
        state.whitelist.add(domain);
        await interaction.reply({ content: `✅ Domaine \`${domain}\` ajouté à la whitelist.`, ephemeral: true });
      }

      else if (sub === 'status') {
        const cfg = state.config;
        const lines = Object.entries(cfg).map(([k, v]) => `${v ? '✅' : '❌'} **${k}**`).join('\n');
        await interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🤖 AutoMod — Configuration')
            .setDescription(lines)
            .addFields(
              { name: 'Mots interdits', value: state.badWords.size + ' mots', inline: true },
              { name: 'Whitelist liens', value: state.whitelist.size + ' domaines', inline: true },
            )],
          ephemeral: true,
        });
      }
    },
  },
];

// ── Prefix commands ────────────────────────────────────────────────────────

const prefixCommands = [
  {
    name: 'automod',
    aliases: ['am'],
    description: 'Gestion AutoMod',
    async execute(message, args) {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return message.reply('❌ Permission insuffisante.');
      }
      const state = getState(message.guild.id);
      const sub   = args[0]?.toLowerCase();

      if (sub === 'config') {
        const rule  = args[1];
        const value = args[2]?.toLowerCase() === 'on';
        if (!rule || !state.config.hasOwnProperty(rule)) {
          return message.reply(`Règles disponibles : ${Object.keys(state.config).join(', ')}`);
        }
        state.config[rule] = value;
        message.reply(`**${rule}** : ${value ? '✅ Activé' : '❌ Désactivé'}`);
      }
      else if (sub === 'warns') {
        const target = message.mentions.users.first();
        if (!target) return message.reply('❌ Mentionne un utilisateur.');
        const warns = state.warns.get(target.id) || 0;
        message.reply(`⚠️ ${target.tag} : **${warns}** avertissement(s)`);
      }
      else if (sub === 'clearwarns') {
        const target = message.mentions.users.first();
        if (!target) return message.reply('❌ Mentionne un utilisateur.');
        state.warns.delete(target.id);
        message.reply(`✅ Warns de ${target.tag} effacés.`);
      }
      else if (sub === 'addword') {
        const word = args[1]?.toLowerCase();
        if (!word) return message.reply('❌ Donne un mot.');
        state.badWords.add(word);
        message.reply(`✅ \`${word}\` ajouté.`);
      }
      else if (sub === 'removeword') {
        const word = args[1]?.toLowerCase();
        if (!word) return message.reply('❌ Donne un mot.');
        state.badWords.delete(word);
        message.reply(`✅ \`${word}\` retiré.`);
      }
      else if (sub === 'whitelist') {
        const domain = args[1]?.replace(/^www\./, '').toLowerCase();
        if (!domain) return message.reply('❌ Donne un domaine.');
        state.whitelist.add(domain);
        message.reply(`✅ \`${domain}\` en whitelist.`);
      }
      else if (sub === 'status') {
        const lines = Object.entries(state.config).map(([k, v]) => `${v ? '✅' : '❌'} ${k}`).join('\n');
        message.reply(`**AutoMod config:**\n${lines}`);
      }
      else {
        message.reply('Usage: `!automod <config|warns|clearwarns|addword|removeword|whitelist|status>`');
      }
    },
  },
];

// ── Register event listener ───────────────────────────────────────────────

function register(client) {
  client.on('messageCreate', handleMessage);
}

module.exports = { slashCommands, prefixCommands, register };
