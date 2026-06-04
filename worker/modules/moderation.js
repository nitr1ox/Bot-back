/**
 * Module: Modération
 * Slash: /ban /kick /mute /unmute /warn /warnings /clearwarnings /clear /slowmode /lock /unlock
 * Prefix: !ban !kick !mute !unmute !warn !warnings !clearwarnings !clear !slowmode !lock !unlock
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');

function modEmbed(color, title, desc) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc).setTimestamp();
}

async function modLog(guild, embed) {
  const ch = guild.channels.cache.find(c =>
    c.type === ChannelType.GuildText &&
    ['mod-logs','modlogs','logs','sanctions'].includes(c.name.toLowerCase())
  );
  if (ch) ch.send({ embeds: [embed] }).catch(() => {});
}

const warnStore = new Map();
function getWarns(guildId, userId) {
  if (!warnStore.has(guildId)) warnStore.set(guildId, new Map());
  return warnStore.get(guildId).get(userId) || [];
}
function addWarn(guildId, userId, entry) {
  if (!warnStore.has(guildId)) warnStore.set(guildId, new Map());
  const w = getWarns(guildId, userId);
  w.push(entry);
  warnStore.get(guildId).set(userId, w);
}
function clearWarns(guildId, userId) {
  warnStore.get(guildId)?.delete(userId);
}

const slashCommands = [
  {
    data: new SlashCommandBuilder().setName('ban').setDescription('Bannir un membre')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
      .addStringOption(o => o.setName('raison').setDescription('Raison'))
      .addIntegerOption(o => o.setName('jours').setDescription('Jours messages à supprimer (0-7)').setMinValue(0).setMaxValue(7)),
    async execute(i) {
      const target = i.options.getMember('membre');
      const raison = i.options.getString('raison') || 'Aucune raison';
      const jours  = i.options.getInteger('jours') || 0;
      if (!target?.bannable) return i.reply({ content: '❌ Impossible de bannir ce membre.', ephemeral: true });
      await target.send({ embeds: [modEmbed(0xe5484d, '🔨 Banni', `**Serveur :** ${i.guild.name}\n**Raison :** ${raison}`)] }).catch(() => {});
      await target.ban({ reason: raison, deleteMessageSeconds: jours * 86400 });
      const e = modEmbed(0xe5484d, '🔨 Membre banni', `**Membre :** ${target.user.tag}\n**Raison :** ${raison}\n**Mod :** ${i.user.tag}`);
      await i.reply({ embeds: [e] });
      modLog(i.guild, e);
    },
  },
  {
    data: new SlashCommandBuilder().setName('kick').setDescription('Expulser un membre')
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
      .addStringOption(o => o.setName('raison').setDescription('Raison')),
    async execute(i) {
      const target = i.options.getMember('membre');
      const raison = i.options.getString('raison') || 'Aucune raison';
      if (!target?.kickable) return i.reply({ content: '❌ Impossible de kick ce membre.', ephemeral: true });
      await target.send({ embeds: [modEmbed(0xf5c518, '👢 Expulsé', `**Serveur :** ${i.guild.name}\n**Raison :** ${raison}`)] }).catch(() => {});
      await target.kick(raison);
      const e = modEmbed(0xf5c518, '👢 Membre expulsé', `**Membre :** ${target.user.tag}\n**Raison :** ${raison}\n**Mod :** ${i.user.tag}`);
      await i.reply({ embeds: [e] });
      modLog(i.guild, e);
    },
  },
  {
    data: new SlashCommandBuilder().setName('mute').setDescription('Muter un membre (timeout)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
      .addIntegerOption(o => o.setName('durée').setDescription('Minutes').setMinValue(1).setMaxValue(40320).setRequired(true))
      .addStringOption(o => o.setName('raison').setDescription('Raison')),
    async execute(i) {
      const target = i.options.getMember('membre');
      const mins   = i.options.getInteger('durée');
      const raison = i.options.getString('raison') || 'Aucune raison';
      if (!target) return i.reply({ content: '❌ Membre introuvable.', ephemeral: true });
      await target.timeout(mins * 60000, raison);
      const e = modEmbed(0xe040a0, '🔇 Muté', `**Membre :** ${target.user.tag}\n**Durée :** ${mins} min\n**Raison :** ${raison}\n**Mod :** ${i.user.tag}`);
      await i.reply({ embeds: [e] });
      modLog(i.guild, e);
    },
  },
  {
    data: new SlashCommandBuilder().setName('unmute').setDescription('Démuter un membre')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)),
    async execute(i) {
      const target = i.options.getMember('membre');
      if (!target) return i.reply({ content: '❌ Membre introuvable.', ephemeral: true });
      await target.timeout(null);
      const e = modEmbed(0x3ecf8e, '🔊 Démuté', `**Membre :** ${target.user.tag}\n**Mod :** ${i.user.tag}`);
      await i.reply({ embeds: [e] });
      modLog(i.guild, e);
    },
  },
  {
    data: new SlashCommandBuilder().setName('warn').setDescription('Avertir un membre')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
      .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(true)),
    async execute(i) {
      const target = i.options.getMember('membre');
      const raison = i.options.getString('raison');
      if (!target) return i.reply({ content: '❌ Membre introuvable.', ephemeral: true });
      addWarn(i.guild.id, target.id, { reason: raison, mod: i.user.tag, t: new Date().toISOString() });
      const warns = getWarns(i.guild.id, target.id);
      await target.send({ embeds: [modEmbed(0xf5c518, '⚠️ Avertissement', `**Serveur :** ${i.guild.name}\n**Raison :** ${raison}\n**Total :** ${warns.length}`)] }).catch(() => {});
      const e = modEmbed(0xf5c518, '⚠️ Averti', `**Membre :** ${target.user.tag}\n**Raison :** ${raison}\n**Total :** ${warns.length}\n**Mod :** ${i.user.tag}`);
      await i.reply({ embeds: [e] });
      modLog(i.guild, e);
    },
  },
  {
    data: new SlashCommandBuilder().setName('warnings').setDescription('Voir les warns d\'un membre')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)),
    async execute(i) {
      const target = i.options.getUser('membre');
      const warns  = getWarns(i.guild.id, target.id);
      if (!warns.length) return i.reply({ content: `✅ Aucun warn pour ${target.tag}.`, ephemeral: true });
      const list = warns.map((w, idx) => `**${idx+1}.** ${w.reason} — ${w.mod}`).join('\n');
      await i.reply({ embeds: [modEmbed(0xf5c518, `⚠️ Warns — ${target.tag}`, list)], ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder().setName('clearwarnings').setDescription('Effacer les warns d\'un membre')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)),
    async execute(i) {
      const target = i.options.getUser('membre');
      clearWarns(i.guild.id, target.id);
      await i.reply({ content: `✅ Warns de ${target.tag} effacés.`, ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder().setName('clear').setDescription('Supprimer des messages')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption(o => o.setName('nombre').setDescription('Nombre (1-100)').setMinValue(1).setMaxValue(100).setRequired(true)),
    async execute(i) {
      const n = i.options.getInteger('nombre');
      await i.deferReply({ ephemeral: true });
      const deleted = await i.channel.bulkDelete(n, true);
      await i.editReply({ content: `✅ ${deleted.size} message(s) supprimé(s).` });
      modLog(i.guild, modEmbed(0x5865f2, '🗑️ Clear', `**Channel :** ${i.channel}\n**Nombre :** ${deleted.size}\n**Mod :** ${i.user.tag}`));
    },
  },
  {
    data: new SlashCommandBuilder().setName('slowmode').setDescription('Slowmode du channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addIntegerOption(o => o.setName('secondes').setDescription('Secondes (0 = off)').setMinValue(0).setMaxValue(21600).setRequired(true)),
    async execute(i) {
      const s = i.options.getInteger('secondes');
      await i.channel.setRateLimitPerUser(s);
      await i.reply({ embeds: [modEmbed(0x5865f2, '🐢 Slowmode', s === 0 ? 'Désactivé.' : `Réglé à **${s}s**.`)] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('lock').setDescription('Verrouiller le channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async execute(i) {
      await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: false });
      const e = modEmbed(0xe5484d, '🔒 Verrouillé', `${i.channel} verrouillé par ${i.user.tag}.`);
      await i.reply({ embeds: [e] });
      modLog(i.guild, e);
    },
  },
  {
    data: new SlashCommandBuilder().setName('unlock').setDescription('Déverrouiller le channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async execute(i) {
      await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: null });
      const e = modEmbed(0x3ecf8e, '🔓 Déverrouillé', `${i.channel} déverrouillé par ${i.user.tag}.`);
      await i.reply({ embeds: [e] });
      modLog(i.guild, e);
    },
  },
];

const prefixCommands = [
  { name: 'ban', aliases: ['bannir'],
    async execute(msg, args) {
      if (!msg.member.permissions.has(PermissionFlagsBits.BanMembers)) return msg.reply('❌ Permission insuffisante.');
      const t = msg.mentions.members.first(); if (!t?.bannable) return msg.reply('❌ Mentionne un membre bannable.');
      const r = args.slice(1).join(' ') || 'Aucune raison';
      await t.send({ embeds: [modEmbed(0xe5484d,'🔨 Banni',`**Serveur :** ${msg.guild.name}\n**Raison :** ${r}`)] }).catch(()=>{});
      await t.ban({ reason: r });
      const e = modEmbed(0xe5484d,'🔨 Banni',`**Membre :** ${t.user.tag}\n**Raison :** ${r}`);
      msg.channel.send({ embeds: [e] }); modLog(msg.guild, e);
    }},
  { name: 'kick', aliases: ['expulser'],
    async execute(msg, args) {
      if (!msg.member.permissions.has(PermissionFlagsBits.KickMembers)) return msg.reply('❌ Permission insuffisante.');
      const t = msg.mentions.members.first(); if (!t?.kickable) return msg.reply('❌ Mentionne un membre kickable.');
      const r = args.slice(1).join(' ') || 'Aucune raison';
      await t.send({ embeds: [modEmbed(0xf5c518,'👢 Expulsé',`**Serveur :** ${msg.guild.name}\n**Raison :** ${r}`)] }).catch(()=>{});
      await t.kick(r);
      const e = modEmbed(0xf5c518,'👢 Expulsé',`**Membre :** ${t.user.tag}\n**Raison :** ${r}`);
      msg.channel.send({ embeds: [e] }); modLog(msg.guild, e);
    }},
  { name: 'mute', aliases: ['timeout'],
    async execute(msg, args) {
      if (!msg.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return msg.reply('❌ Permission insuffisante.');
      const t = msg.mentions.members.first(); if (!t) return msg.reply('❌ Mentionne un membre.');
      const mins = parseInt(args[1]) || 10; const r = args.slice(2).join(' ') || 'Aucune raison';
      await t.timeout(mins * 60000, r);
      const e = modEmbed(0xe040a0,'🔇 Muté',`**Membre :** ${t.user.tag}\n**Durée :** ${mins}min\n**Raison :** ${r}`);
      msg.channel.send({ embeds: [e] }); modLog(msg.guild, e);
    }},
  { name: 'unmute',
    async execute(msg) {
      if (!msg.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return msg.reply('❌ Permission insuffisante.');
      const t = msg.mentions.members.first(); if (!t) return msg.reply('❌ Mentionne un membre.');
      await t.timeout(null); msg.reply(`✅ ${t.user.tag} démuté.`);
    }},
  { name: 'warn',
    async execute(msg, args) {
      if (!msg.member.permissions.has(PermissionFlagsBits.ManageMessages)) return msg.reply('❌ Permission insuffisante.');
      const t = msg.mentions.members.first(); if (!t) return msg.reply('❌ Mentionne un membre.');
      const r = args.slice(1).join(' ') || 'Aucune raison';
      addWarn(msg.guild.id, t.id, { reason: r, mod: msg.author.tag, t: new Date().toISOString() });
      const w = getWarns(msg.guild.id, t.id);
      const e = modEmbed(0xf5c518,'⚠️ Averti',`**Membre :** ${t.user.tag}\n**Raison :** ${r}\n**Total :** ${w.length}`);
      msg.channel.send({ embeds: [e] }); modLog(msg.guild, e);
    }},
  { name: 'warnings', aliases: ['warns'],
    async execute(msg) {
      const t = msg.mentions.users.first(); if (!t) return msg.reply('❌ Mentionne un membre.');
      const w = getWarns(msg.guild.id, t.id);
      if (!w.length) return msg.reply(`✅ Aucun warn pour ${t.tag}.`);
      msg.reply({ embeds: [modEmbed(0xf5c518,`⚠️ Warns — ${t.tag}`, w.map((x,i)=>`**${i+1}.** ${x.reason} — ${x.mod}`).join('\n'))] });
    }},
  { name: 'clearwarnings', aliases: ['clearwarns'],
    async execute(msg) {
      if (!msg.member.permissions.has(PermissionFlagsBits.ManageMessages)) return msg.reply('❌ Permission insuffisante.');
      const t = msg.mentions.users.first(); if (!t) return msg.reply('❌ Mentionne un membre.');
      clearWarns(msg.guild.id, t.id); msg.reply(`✅ Warns de ${t.tag} effacés.`);
    }},
  { name: 'clear', aliases: ['purge'],
    async execute(msg, args) {
      if (!msg.member.permissions.has(PermissionFlagsBits.ManageMessages)) return msg.reply('❌ Permission insuffisante.');
      const n = Math.min(parseInt(args[0]) || 10, 100);
      await msg.delete().catch(()=>{});
      const d = await msg.channel.bulkDelete(n, true);
      msg.channel.send(`✅ ${d.size} message(s) supprimé(s).`).then(m=>setTimeout(()=>m.delete().catch(()=>{}),4000));
    }},
  { name: 'slowmode',
    async execute(msg, args) {
      if (!msg.member.permissions.has(PermissionFlagsBits.ManageChannels)) return msg.reply('❌ Permission insuffisante.');
      const s = parseInt(args[0]) || 0;
      await msg.channel.setRateLimitPerUser(s); msg.reply(s===0?'✅ Slowmode off.':` ✅ Slowmode ${s}s.`);
    }},
  { name: 'lock',
    async execute(msg) {
      if (!msg.member.permissions.has(PermissionFlagsBits.ManageChannels)) return msg.reply('❌ Permission insuffisante.');
      await msg.channel.permissionOverwrites.edit(msg.guild.roles.everyone, { SendMessages: false });
      msg.reply('🔒 Channel verrouillé.');
    }},
  { name: 'unlock',
    async execute(msg) {
      if (!msg.member.permissions.has(PermissionFlagsBits.ManageChannels)) return msg.reply('❌ Permission insuffisante.');
      await msg.channel.permissionOverwrites.edit(msg.guild.roles.everyone, { SendMessages: null });
      msg.reply('🔓 Channel déverrouillé.');
    }},
];

module.exports = { slashCommands, prefixCommands };
