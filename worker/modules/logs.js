/**
 * Module: Logs
 * Enregistre les événements du serveur dans un channel de logs.
 * Événements: messages edit/delete, member join/leave/ban/kick, role changes, channel changes, voice moves
 * Commandes: /logs setchannel /logs disable /logs status
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, AuditLogEvent, ChannelType } = require('discord.js');

const configs = new Map();
function getCfg(guildId) {
  if (!configs.has(guildId)) configs.set(guildId, { channelId: null, enabled: false, events: {
    messageDelete: true, messageUpdate: true,
    memberJoin: true, memberLeave: true, memberBan: true,
    roleUpdate: true, channelCreate: true, channelDelete: true,
    voiceMove: true,
  }});
  return configs.get(guildId);
}

async function logEvent(guild, embed) {
  const cfg = getCfg(guild.id);
  if (!cfg.enabled || !cfg.channelId) return;
  const ch = guild.channels.cache.get(cfg.channelId);
  if (ch) ch.send({ embeds: [embed] }).catch(() => {});
}

function e(color, title, desc, fields = []) {
  const emb = new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc).setTimestamp();
  fields.forEach(f => emb.addFields(f));
  return emb;
}

function onReady(client) {
  // Message delete
  client.on('messageDelete', async msg => {
    if (!msg.guild || msg.author?.bot) return;
    const cfg = getCfg(msg.guild.id);
    if (!cfg.events.messageDelete) return;
    await logEvent(msg.guild, e(0xe5484d, '🗑️ Message supprimé',
      `**Auteur :** ${msg.author?.tag || 'Inconnu'}\n**Channel :** ${msg.channel}\n**Contenu :** ${msg.content?.slice(0, 500) || '*vide*'}`
    ));
  });

  // Message edit
  client.on('messageUpdate', async (oldMsg, newMsg) => {
    if (!newMsg.guild || newMsg.author?.bot) return;
    if (oldMsg.content === newMsg.content) return;
    const cfg = getCfg(newMsg.guild.id);
    if (!cfg.events.messageUpdate) return;
    await logEvent(newMsg.guild, e(0xf5c518, '✏️ Message modifié',
      `**Auteur :** ${newMsg.author?.tag}\n**Channel :** ${newMsg.channel}\n[Voir le message](${newMsg.url})`,
      [
        { name: 'Avant', value: oldMsg.content?.slice(0, 400) || '*vide*', inline: false },
        { name: 'Après', value: newMsg.content?.slice(0, 400) || '*vide*', inline: false },
      ]
    ));
  });

  // Member join
  client.on('guildMemberAdd', async member => {
    const cfg = getCfg(member.guild.id);
    if (!cfg.events.memberJoin) return;
    const created = Math.floor(member.user.createdTimestamp / 1000);
    await logEvent(member.guild, e(0x3ecf8e, '📥 Membre rejoint',
      `${member.user.tag} (${member.id})`,
      [
        { name: 'Compte créé', value: `<t:${created}:R>`, inline: true },
        { name: 'Membres', value: String(member.guild.memberCount), inline: true },
      ]
    ));
  });

  // Member leave
  client.on('guildMemberRemove', async member => {
    const cfg = getCfg(member.guild.id);
    if (!cfg.events.memberLeave) return;
    await logEvent(member.guild, e(0xe5484d, '📤 Membre parti',
      `${member.user.tag} (${member.id})`,
      [{ name: 'Membres restants', value: String(member.guild.memberCount), inline: true }]
    ));
  });

  // Ban
  client.on('guildBanAdd', async ban => {
    const cfg = getCfg(ban.guild.id);
    if (!cfg.events.memberBan) return;
    await logEvent(ban.guild, e(0xe5484d, '🔨 Membre banni',
      `${ban.user.tag} (${ban.user.id})\n**Raison :** ${ban.reason || 'Aucune'}`
    ));
  });

  // Unban
  client.on('guildBanRemove', async ban => {
    const cfg = getCfg(ban.guild.id);
    if (!cfg.events.memberBan) return;
    await logEvent(ban.guild, e(0x3ecf8e, '🔓 Membre débanni', `${ban.user.tag} (${ban.user.id})`));
  });

  // Role update on member
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const cfg = getCfg(newMember.guild.id);
    if (!cfg.events.roleUpdate) return;
    const added   = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
    if (!added.size && !removed.size) return;
    const fields = [];
    if (added.size)   fields.push({ name: '➕ Rôles ajoutés',   value: added.map(r => r.toString()).join(', ') });
    if (removed.size) fields.push({ name: '➖ Rôles retirés',   value: removed.map(r => r.toString()).join(', ') });
    await logEvent(newMember.guild, e(0x5865f2, '🎭 Rôles modifiés', `**Membre :** ${newMember.user.tag}`, fields));
  });

  // Channel create
  client.on('channelCreate', async channel => {
    if (!channel.guild) return;
    const cfg = getCfg(channel.guild.id);
    if (!cfg.events.channelCreate) return;
    await logEvent(channel.guild, e(0x3ecf8e, '📁 Channel créé', `**Nom :** ${channel.name}\n**Type :** ${channel.type}`));
  });

  // Channel delete
  client.on('channelDelete', async channel => {
    if (!channel.guild) return;
    const cfg = getCfg(channel.guild.id);
    if (!cfg.events.channelDelete) return;
    await logEvent(channel.guild, e(0xe5484d, '📁 Channel supprimé', `**Nom :** #${channel.name}\n**Type :** ${channel.type}`));
  });

  // Voice state
  client.on('voiceStateUpdate', async (oldState, newState) => {
    const cfg = getCfg(newState.guild.id);
    if (!cfg.events.voiceMove) return;
    const member = newState.member;
    if (!member || member.user.bot) return;
    if (!oldState.channelId && newState.channelId) {
      await logEvent(newState.guild, e(0x3ecf8e, '🔊 Rejoint vocal', `**Membre :** ${member.user.tag}\n**Channel :** ${newState.channel?.name}`));
    } else if (oldState.channelId && !newState.channelId) {
      await logEvent(newState.guild, e(0xe5484d, '🔇 Quitté vocal', `**Membre :** ${member.user.tag}\n**Channel :** ${oldState.channel?.name}`));
    } else if (oldState.channelId !== newState.channelId) {
      await logEvent(newState.guild, e(0xf5c518, '🔀 Changé vocal',
        `**Membre :** ${member.user.tag}\n**De :** ${oldState.channel?.name} → **Vers :** ${newState.channel?.name}`));
    }
  });
}

// ── Slash
const slashCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('logs')
      .setDescription('Configuration des logs serveur')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(s => s.setName('setchannel').setDescription('Définir le channel de logs')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)))
      .addSubcommand(s => s.setName('disable').setDescription('Désactiver les logs'))
      .addSubcommand(s => s.setName('status').setDescription('Voir la configuration'))
      .addSubcommand(s => s.setName('toggle').setDescription('Activer/désactiver un type de log')
        .addStringOption(o => o.setName('event').setDescription('Événement').setRequired(true)
          .addChoices(
            { name: 'Messages supprimés', value: 'messageDelete' },
            { name: 'Messages modifiés',  value: 'messageUpdate' },
            { name: 'Arrivées membres',   value: 'memberJoin' },
            { name: 'Départs membres',    value: 'memberLeave' },
            { name: 'Bans',               value: 'memberBan' },
            { name: 'Rôles',              value: 'roleUpdate' },
            { name: 'Channels créés',     value: 'channelCreate' },
            { name: 'Channels supprimés', value: 'channelDelete' },
            { name: 'Vocal',              value: 'voiceMove' },
          ))
        .addStringOption(o => o.setName('état').setDescription('on/off').setRequired(true)
          .addChoices({ name: 'Activer', value: 'on' }, { name: 'Désactiver', value: 'off' }))),

    async execute(i) {
      const sub = i.options.getSubcommand();
      const cfg = getCfg(i.guild.id);

      if (sub === 'setchannel') {
        cfg.channelId = i.options.getChannel('channel').id;
        cfg.enabled   = true;
        await i.reply({ content: `✅ Logs → ${i.options.getChannel('channel')}`, ephemeral: true });
      } else if (sub === 'disable') {
        cfg.enabled = false;
        await i.reply({ content: '✅ Logs désactivés.', ephemeral: true });
      } else if (sub === 'toggle') {
        const ev  = i.options.getString('event');
        const val = i.options.getString('état') === 'on';
        cfg.events[ev] = val;
        await i.reply({ content: `✅ **${ev}** : ${val ? 'activé' : 'désactivé'}`, ephemeral: true });
      } else if (sub === 'status') {
        const ch = cfg.channelId ? `<#${cfg.channelId}>` : 'Non défini';
        const evList = Object.entries(cfg.events).map(([k,v]) => `${v?'✅':'❌'} ${k}`).join('\n');
        await i.reply({
          embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📋 Logs — Config')
            .addFields(
              { name: 'Activé',  value: cfg.enabled ? '✅' : '❌', inline: true },
              { name: 'Channel', value: ch, inline: true },
              { name: 'Événements', value: evList },
            )],
          ephemeral: true,
        });
      }
    },
  },
];

const prefixCommands = [
  {
    name: 'logs',
    async execute(msg, args) {
      if (!msg.member.permissions.has(PermissionFlagsBits.ManageGuild)) return msg.reply('❌ Permission insuffisante.');
      const cfg = getCfg(msg.guild.id);
      const sub = args[0]?.toLowerCase();
      if (sub === 'setchannel') {
        const ch = msg.mentions.channels.first();
        if (!ch) return msg.reply('❌ Mentionne un channel.');
        cfg.channelId = ch.id; cfg.enabled = true;
        msg.reply(`✅ Logs → ${ch}`);
      } else if (sub === 'disable') {
        cfg.enabled = false; msg.reply('✅ Logs désactivés.');
      } else {
        msg.reply('Usage: `!logs <setchannel|disable>`');
      }
    },
  },
];

module.exports = { slashCommands, prefixCommands, onReady };
