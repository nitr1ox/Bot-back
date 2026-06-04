/**
 * Module: Welcome
 * - Message de bienvenue dans un channel configurable
 * - Message d'au revoir
 * - Rôle automatique à l'arrivée
 * Commandes: /welcome setchannel /welcome setmessage /welcome setrole /welcome setbyechannel /welcome test /welcome disable
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

// Per-guild config store
const configs = new Map();
function getConfig(guildId) {
  if (!configs.has(guildId)) configs.set(guildId, {
    channelId:    null,
    byeChannelId: null,
    message:      'Bienvenue sur **{server}**, {user} ! Tu es le **{count}**ème membre 🎉',
    byeMessage:   '{user} a quitté le serveur. On était **{count}** membres.',
    roleId:       null,
    enabled:      true,
  });
  return configs.get(guildId);
}

function parseMessage(template, member) {
  return template
    .replace(/{user}/g,   member.toString())
    .replace(/{username}/g, member.user.username)
    .replace(/{server}/g, member.guild.name)
    .replace(/{count}/g,  member.guild.memberCount);
}

// ── Events
function onReady(client) {
  client.on('guildMemberAdd', async member => {
    const cfg = getConfig(member.guild.id);
    if (!cfg.enabled) return;

    // Auto-role
    if (cfg.roleId) {
      const role = member.guild.roles.cache.get(cfg.roleId);
      if (role) member.roles.add(role).catch(() => {});
    }

    // Welcome message
    if (!cfg.channelId) return;
    const channel = member.guild.channels.cache.get(cfg.channelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('👋 Nouveau membre !')
      .setDescription(parseMessage(cfg.message, member))
      .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
      .setFooter({ text: `${member.guild.name}` })
      .setTimestamp();

    channel.send({ embeds: [embed] }).catch(() => {});
  });

  client.on('guildMemberRemove', async member => {
    const cfg = getConfig(member.guild.id);
    if (!cfg.enabled || !cfg.byeChannelId) return;
    const channel = member.guild.channels.cache.get(cfg.byeChannelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(0xe5484d)
      .setDescription(parseMessage(cfg.byeMessage, member))
      .setTimestamp();

    channel.send({ embeds: [embed] }).catch(() => {});
  });
}

// ── Slash
const slashCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('welcome')
      .setDescription('Configuration des messages de bienvenue')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(s => s.setName('setchannel').setDescription('Définir le channel de bienvenue')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)))
      .addSubcommand(s => s.setName('setbyechannel').setDescription('Définir le channel d\'au revoir')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)))
      .addSubcommand(s => s.setName('setmessage').setDescription('Définir le message de bienvenue (variables: {user} {server} {count})')
        .addStringOption(o => o.setName('message').setDescription('Message').setRequired(true)))
      .addSubcommand(s => s.setName('setrole').setDescription('Rôle automatique à l\'arrivée')
        .addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true)))
      .addSubcommand(s => s.setName('test').setDescription('Tester le message de bienvenue'))
      .addSubcommand(s => s.setName('disable').setDescription('Désactiver les messages de bienvenue'))
      .addSubcommand(s => s.setName('status').setDescription('Voir la configuration')),

    async execute(i) {
      const sub = i.options.getSubcommand();
      const cfg = getConfig(i.guild.id);

      if (sub === 'setchannel') {
        cfg.channelId = i.options.getChannel('channel').id;
        cfg.enabled   = true;
        await i.reply({ content: `✅ Channel de bienvenue : ${i.options.getChannel('channel')}`, ephemeral: true });
      }
      else if (sub === 'setbyechannel') {
        cfg.byeChannelId = i.options.getChannel('channel').id;
        await i.reply({ content: `✅ Channel d'au revoir : ${i.options.getChannel('channel')}`, ephemeral: true });
      }
      else if (sub === 'setmessage') {
        cfg.message = i.options.getString('message');
        await i.reply({ content: `✅ Message mis à jour.`, ephemeral: true });
      }
      else if (sub === 'setrole') {
        cfg.roleId = i.options.getRole('role').id;
        await i.reply({ content: `✅ Rôle automatique : ${i.options.getRole('role')}`, ephemeral: true });
      }
      else if (sub === 'test') {
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('👋 Nouveau membre !')
          .setDescription(parseMessage(cfg.message, i.member))
          .setThumbnail(i.user.displayAvatarURL({ size: 128 }))
          .setTimestamp();
        await i.reply({ embeds: [embed], ephemeral: true });
      }
      else if (sub === 'disable') {
        cfg.enabled = false;
        await i.reply({ content: '✅ Messages de bienvenue désactivés.', ephemeral: true });
      }
      else if (sub === 'status') {
        const ch    = cfg.channelId    ? `<#${cfg.channelId}>`    : 'Non défini';
        const byCh  = cfg.byeChannelId ? `<#${cfg.byeChannelId}>` : 'Non défini';
        const role  = cfg.roleId       ? `<@&${cfg.roleId}>`      : 'Aucun';
        await i.reply({
          embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('👋 Welcome — Config')
            .addFields(
              { name: 'Activé',          value: cfg.enabled ? '✅' : '❌', inline: true },
              { name: 'Channel',         value: ch,   inline: true },
              { name: 'Channel départ',  value: byCh, inline: true },
              { name: 'Rôle auto',       value: role, inline: true },
              { name: 'Message',         value: cfg.message },
            )],
          ephemeral: true,
        });
      }
    },
  },
];

const prefixCommands = [
  {
    name: 'welcome', aliases: ['wlc'],
    async execute(msg, args) {
      if (!msg.member.permissions.has(PermissionFlagsBits.ManageGuild)) return msg.reply('❌ Permission insuffisante.');
      const cfg = getConfig(msg.guild.id);
      const sub = args[0]?.toLowerCase();
      if (sub === 'setchannel') {
        const ch = msg.mentions.channels.first();
        if (!ch) return msg.reply('❌ Mentionne un channel.');
        cfg.channelId = ch.id; cfg.enabled = true;
        msg.reply(`✅ Channel de bienvenue : ${ch}`);
      } else if (sub === 'setrole') {
        const role = msg.mentions.roles.first();
        if (!role) return msg.reply('❌ Mentionne un rôle.');
        cfg.roleId = role.id;
        msg.reply(`✅ Rôle auto : ${role}`);
      } else if (sub === 'setmessage') {
        cfg.message = args.slice(1).join(' ');
        msg.reply('✅ Message mis à jour.');
      } else if (sub === 'test') {
        const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('👋 Test bienvenue')
          .setDescription(parseMessage(cfg.message, msg.member)).setTimestamp();
        msg.channel.send({ embeds: [embed] });
      } else if (sub === 'disable') {
        cfg.enabled = false; msg.reply('✅ Bienvenue désactivé.');
      } else {
        msg.reply('Usage: `!welcome <setchannel|setrole|setmessage|test|disable>`');
      }
    },
  },
];

module.exports = { slashCommands, prefixCommands, onReady };
