/**
 * Module: Giveaway
 * Commandes: /giveaway start /giveaway end /giveaway reroll /giveaway list
 * Prefix: !gstart !gend !greroll !glist
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// guildId → Map<messageId, giveaway>
const giveaways = new Map();

function getGuild(guildId) {
  if (!giveaways.has(guildId)) giveaways.set(guildId, new Map());
  return giveaways.get(guildId);
}

function parseDuration(str) {
  // e.g. "10m" "2h" "1d"
  const match = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const n = parseInt(match[1]);
  const u = match[2].toLowerCase();
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * mult[u];
}

async function endGiveaway(guild, giveaway) {
  giveaway.ended = true;
  const channel = guild.channels.cache.get(giveaway.channelId);
  if (!channel) return;

  const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
  if (!message) return;

  const participants = [...giveaway.participants];
  if (!participants.length) {
    await message.edit({ embeds: [buildEmbed(giveaway, true, [])] });
    await channel.send({ embeds: [new EmbedBuilder().setColor(0xe5484d).setDescription(`🎉 Giveaway terminé — **${giveaway.prize}** : Aucun participant !`)] });
    return;
  }

  // Pick winners
  const winners = [];
  const pool    = [...participants];
  for (let w = 0; w < Math.min(giveaway.winners, pool.length); w++) {
    const idx = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(idx, 1)[0]);
  }
  giveaway.winnerIds = winners;

  await message.edit({ embeds: [buildEmbed(giveaway, true, winners)] });
  const winMentions = winners.map(id => `<@${id}>`).join(', ');
  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0x3ecf8e)
      .setTitle('🎉 Giveaway terminé !')
      .setDescription(`Félicitations ${winMentions} ! Vous avez gagné **${giveaway.prize}** !`)
      .setTimestamp()
    ],
  });
}

function buildEmbed(giveaway, ended = false, winners = []) {
  const end   = Math.floor(giveaway.endsAt / 1000);
  const color = ended ? 0xe5484d : 0x5865f2;
  const e = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🎉 ${giveaway.prize}`)
    .addFields(
      { name: 'Organisateur',  value: `<@${giveaway.hostId}>`,   inline: true },
      { name: 'Gagnants',      value: String(giveaway.winners),  inline: true },
      { name: 'Participants',  value: String(giveaway.participants.size), inline: true },
    )
    .setTimestamp();

  if (ended) {
    e.setDescription(winners.length
      ? `**Gagnant(s) :** ${winners.map(id => `<@${id}>`).join(', ')}`
      : '**Aucun gagnant**');
    e.setFooter({ text: 'Terminé' });
  } else {
    e.setDescription(`Réagis avec 🎉 pour participer !\n**Fin :** <t:${end}:R>`);
    e.setFooter({ text: `Fin le` });
    e.setTimestamp(giveaway.endsAt);
  }
  return e;
}

async function startGiveaway(channel, host, prize, durationMs, winnersCount) {
  const endsAt = Date.now() + durationMs;
  const row    = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('giveaway_enter').setLabel('🎉 Participer').setStyle(ButtonStyle.Primary)
  );
  const tempData = { prize, hostId: host.id, endsAt, winners: winnersCount, participants: new Set(), ended: false, winnerIds: [] };
  const msg = await channel.send({ embeds: [buildEmbed(tempData)], components: [row] });

  const giveaway = { ...tempData, messageId: msg.id, channelId: channel.id };
  getGuild(channel.guild.id).set(msg.id, giveaway);

  // Auto-end timer
  const timer = setTimeout(async () => {
    await endGiveaway(channel.guild, giveaway);
  }, durationMs);
  giveaway._timer = timer;

  return msg;
}

// ── Slash
const slashCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Gestion des giveaways')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addSubcommand(s => s.setName('start').setDescription('Lancer un giveaway')
        .addStringOption(o => o.setName('durée').setDescription('Durée (ex: 10m, 2h, 1d)').setRequired(true))
        .addStringOption(o => o.setName('prix').setDescription('Lot à gagner').setRequired(true))
        .addIntegerOption(o => o.setName('gagnants').setDescription('Nombre de gagnants').setMinValue(1).setMaxValue(10))
        .addChannelOption(o => o.setName('channel').setDescription('Channel (défaut: actuel)')))
      .addSubcommand(s => s.setName('end').setDescription('Terminer un giveaway')
        .addStringOption(o => o.setName('message_id').setDescription('ID du message giveaway').setRequired(true)))
      .addSubcommand(s => s.setName('reroll').setDescription('Relancer le tirage')
        .addStringOption(o => o.setName('message_id').setDescription('ID du message giveaway').setRequired(true)))
      .addSubcommand(s => s.setName('list').setDescription('Voir les giveaways actifs')),

    async execute(i) {
      const sub = i.options.getSubcommand();

      if (sub === 'start') {
        const durStr   = i.options.getString('durée');
        const prize    = i.options.getString('prix');
        const winners  = i.options.getInteger('gagnants') || 1;
        const channel  = i.options.getChannel('channel') || i.channel;
        const duration = parseDuration(durStr);
        if (!duration) return i.reply({ content: '❌ Durée invalide. Exemples: `10m`, `2h`, `1d`', ephemeral: true });
        await i.deferReply({ ephemeral: true });
        const msg = await startGiveaway(channel, i.user, prize, duration, winners);
        await i.editReply({ content: `✅ Giveaway lancé dans ${channel} ! [Lien](${msg.url})` });
      }

      else if (sub === 'end') {
        const msgId    = i.options.getString('message_id');
        const giveaway = getGuild(i.guild.id).get(msgId);
        if (!giveaway || giveaway.ended) return i.reply({ content: '❌ Giveaway introuvable ou déjà terminé.', ephemeral: true });
        clearTimeout(giveaway._timer);
        await endGiveaway(i.guild, giveaway);
        await i.reply({ content: '✅ Giveaway terminé.', ephemeral: true });
      }

      else if (sub === 'reroll') {
        const msgId    = i.options.getString('message_id');
        const giveaway = getGuild(i.guild.id).get(msgId);
        if (!giveaway || !giveaway.ended) return i.reply({ content: '❌ Giveaway introuvable ou pas encore terminé.', ephemeral: true });
        const participants = [...giveaway.participants];
        if (!participants.length) return i.reply({ content: '❌ Aucun participant.', ephemeral: true });
        const newWinner = participants[Math.floor(Math.random() * participants.length)];
        const channel   = i.guild.channels.cache.get(giveaway.channelId);
        if (channel) channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🔄 Reroll').setDescription(`Nouveau gagnant : <@${newWinner}> pour **${giveaway.prize}** !`)] });
        await i.reply({ content: `✅ Nouveau gagnant : <@${newWinner}>`, ephemeral: true });
      }

      else if (sub === 'list') {
        const active = [...getGuild(i.guild.id).values()].filter(g => !g.ended);
        if (!active.length) return i.reply({ content: '📭 Aucun giveaway actif.', ephemeral: true });
        const lines = active.map(g => `• **${g.prize}** — <#${g.channelId}> — fin <t:${Math.floor(g.endsAt/1000)}:R> — ${g.participants.size} participants`).join('\n');
        await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🎉 Giveaways actifs').setDescription(lines)], ephemeral: true });
      }
    },
  },
];

// ── Prefix
const prefixCommands = [
  { name: 'gstart',
    async execute(msg, args) {
      if (!msg.member.permissions.has(PermissionFlagsBits.ManageMessages)) return msg.reply('❌ Permission insuffisante.');
      const durStr  = args[0]; const winnersStr = args[1]; const prize = args.slice(2).join(' ');
      if (!durStr || !prize) return msg.reply('Usage: `!gstart <durée> <gagnants> <prix>`');
      const duration = parseDuration(durStr);
      if (!duration) return msg.reply('❌ Durée invalide (ex: 10m, 2h)');
      const winners = parseInt(winnersStr) || 1;
      await startGiveaway(msg.channel, msg.author, prize, duration, winners);
      msg.delete().catch(() => {});
    }},
  { name: 'gend',
    async execute(msg, args) {
      if (!msg.member.permissions.has(PermissionFlagsBits.ManageMessages)) return msg.reply('❌ Permission insuffisante.');
      const msgId = args[0]; if (!msgId) return msg.reply('Usage: `!gend <message_id>`');
      const giveaway = getGuild(msg.guild.id).get(msgId);
      if (!giveaway || giveaway.ended) return msg.reply('❌ Giveaway introuvable ou terminé.');
      clearTimeout(giveaway._timer);
      await endGiveaway(msg.guild, giveaway);
      msg.reply('✅ Giveaway terminé.');
    }},
  { name: 'greroll',
    async execute(msg, args) {
      const msgId = args[0]; if (!msgId) return msg.reply('Usage: `!greroll <message_id>`');
      const giveaway = getGuild(msg.guild.id).get(msgId);
      if (!giveaway?.ended) return msg.reply('❌ Introuvable ou pas terminé.');
      const participants = [...giveaway.participants];
      if (!participants.length) return msg.reply('❌ Aucun participant.');
      const w = participants[Math.floor(Math.random() * participants.length)];
      msg.channel.send(`🔄 Nouveau gagnant : <@${w}> pour **${giveaway.prize}** !`);
    }},
];

// ── Button handler (participate)
function register(client) {
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId !== 'giveaway_enter') return;

    const guild    = interaction.guild;
    const msgId    = interaction.message.id;
    const giveaway = getGuild(guild.id).get(msgId);
    if (!giveaway || giveaway.ended) {
      return interaction.reply({ content: '❌ Ce giveaway est terminé.', ephemeral: true });
    }

    const userId = interaction.user.id;
    if (giveaway.participants.has(userId)) {
      giveaway.participants.delete(userId);
      await interaction.reply({ content: '❌ Tu t\'es retiré du giveaway.', ephemeral: true });
    } else {
      giveaway.participants.add(userId);
      await interaction.reply({ content: '✅ Tu participes au giveaway !', ephemeral: true });
    }

    // Update participant count in embed
    const msg = await interaction.channel.messages.fetch(msgId).catch(() => null);
    if (msg) msg.edit({ embeds: [buildEmbed(giveaway)] }).catch(() => {});
  });
}

module.exports = { slashCommands, prefixCommands, register };
