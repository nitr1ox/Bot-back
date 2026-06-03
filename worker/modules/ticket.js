/**
 * Module: Tickets
 * Commandes: /ticket open|close|add|remove|list  (slash)
 *            !ticket open|close|add|remove|list  (prefix)
 *
 * Fonctionnement:
 *  - /ticket open <sujet>  → crée un channel #ticket-XXXX visible uniquement par l'auteur + staff
 *  - /ticket close         → ferme (supprime) le ticket channel
 *  - /ticket add @user     → ajoute un user au ticket
 *  - /ticket remove @user  → retire un user du ticket
 *  - /ticket list          → liste les tickets ouverts du serveur
 *
 * Rôle staff : "Support" ou "Staff" ou "Moderator" ou "Admin"
 */

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const STAFF_ROLES = ['support', 'staff', 'moderator', 'admin', 'mod'];

function isStaff(member) {
  return member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    member.roles.cache.some(r => STAFF_ROLES.includes(r.name.toLowerCase()));
}

// ── Slash Commands ─────────────────────────────────────────────────────────

const slashCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Système de tickets de support')
      .addSubcommand(sub => sub
        .setName('open')
        .setDescription('Ouvre un nouveau ticket')
        .addStringOption(opt => opt.setName('sujet').setDescription('Sujet du ticket').setRequired(false)))
      .addSubcommand(sub => sub
        .setName('close')
        .setDescription('Ferme ce ticket'))
      .addSubcommand(sub => sub
        .setName('add')
        .setDescription('Ajoute un utilisateur au ticket')
        .addUserOption(opt => opt.setName('utilisateur').setDescription('Utilisateur à ajouter').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('remove')
        .setDescription('Retire un utilisateur du ticket')
        .addUserOption(opt => opt.setName('utilisateur').setDescription('Utilisateur à retirer').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('list')
        .setDescription('Liste les tickets ouverts')),

    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      if      (sub === 'open')   await openTicket(interaction);
      else if (sub === 'close')  await closeTicket(interaction);
      else if (sub === 'add')    await addToTicket(interaction);
      else if (sub === 'remove') await removeFromTicket(interaction);
      else if (sub === 'list')   await listTickets(interaction);
    },
  },
];

// ── Prefix Commands ────────────────────────────────────────────────────────

const prefixCommands = [
  {
    name: 'ticket',
    aliases: ['t'],
    description: 'Système de tickets',
    usage: 'ticket <open|close|add|remove|list>',
    async execute(message, args) {
      const sub = args[0]?.toLowerCase();
      if      (sub === 'open')   await openTicketPrefix(message, args.slice(1));
      else if (sub === 'close')  await closeTicketPrefix(message);
      else if (sub === 'add')    await addToTicketPrefix(message);
      else if (sub === 'remove') await removeFromTicketPrefix(message);
      else if (sub === 'list')   await listTicketsPrefix(message);
      else {
        message.reply('Usage: `ticket <open|close|add|remove|list>`');
      }
    },
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function ticketEmbed(color, title, desc, fields = []) {
  const e = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(desc)
    .setTimestamp();
  fields.forEach(f => e.addFields(f));
  return e;
}

async function createTicketChannel(guild, member, sujet) {
  // Count existing tickets for numbering
  const existing = guild.channels.cache.filter(c => c.name.startsWith('ticket-'));
  const num = String(existing.size + 1).padStart(4, '0');
  const channelName = `ticket-${num}`;

  // Gather staff roles
  const staffRoleObjs = guild.roles.cache.filter(r =>
    STAFF_ROLES.includes(r.name.toLowerCase()) || r.permissions.has(PermissionFlagsBits.ManageChannels)
  );

  // Permission overwrites: deny everyone, allow member + staff
  const overwrites = [
    { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
  ];
  staffRoleObjs.forEach(role => {
    overwrites.push({
      id: role.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  });

  // Find or create Tickets category
  let category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'tickets');
  if (!category) {
    category = await guild.channels.create({
      name: 'Tickets',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [{ id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] }],
    }).catch(() => null);
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category?.id,
    permissionOverwrites: overwrites,
    topic: `Ticket de ${member.user.tag}${sujet ? ` — ${sujet}` : ''}`,
  });

  return { channel, num };
}

// ── Slash handlers ─────────────────────────────────────────────────────────

async function openTicket(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const sujet = interaction.options.getString('sujet') || 'Pas de sujet';
  const { guild, member } = interaction;

  // Check if user already has an open ticket
  const already = guild.channels.cache.find(c =>
    c.name.startsWith('ticket-') &&
    c.permissionOverwrites.cache.has(member.id)
  );
  if (already) {
    return interaction.editReply({ content: `❌ Tu as déjà un ticket ouvert : ${already}` });
  }

  try {
    const { channel, num } = await createTicketChannel(guild, member, sujet);

    // Send welcome message in ticket channel
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Fermer le ticket').setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      embeds: [ticketEmbed(0x5865f2, `🎫 Ticket #${num}`, [
        `Bienvenue ${member} !`,
        `**Sujet :** ${sujet}`,
        '',
        'Un membre du staff va vous répondre sous peu.',
        'Décrivez votre problème en détail.',
      ].join('\n'))],
      components: [row],
    });

    await interaction.editReply({ content: `✅ Ton ticket a été créé : ${channel}` });
  } catch (e) {
    await interaction.editReply({ content: `❌ Impossible de créer le ticket: ${e.message}` });
  }
}

async function closeTicket(interaction) {
  const { channel, member } = interaction;
  if (!channel.name.startsWith('ticket-')) {
    return interaction.reply({ content: '❌ Cette commande doit être utilisée dans un channel de ticket.', ephemeral: true });
  }
  if (!isStaff(member) && !channel.permissionOverwrites.cache.has(member.id)) {
    return interaction.reply({ content: '❌ Tu ne peux pas fermer ce ticket.', ephemeral: true });
  }

  await interaction.reply({ embeds: [ticketEmbed(0xe5484d, '🔒 Fermeture du ticket', `Ticket fermé par ${member}.\nSuppression dans 5 secondes…`)] });
  setTimeout(() => channel.delete().catch(() => {}), 5000);
}

async function addToTicket(interaction) {
  const { channel, member } = interaction;
  if (!channel.name.startsWith('ticket-')) {
    return interaction.reply({ content: '❌ Utilise cette commande dans un channel de ticket.', ephemeral: true });
  }
  if (!isStaff(member)) {
    return interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true });
  }
  const target = interaction.options.getUser('utilisateur');
  await channel.permissionOverwrites.create(target.id, {
    ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
  });
  await interaction.reply({ embeds: [ticketEmbed(0x3ecf8e, '➕ Utilisateur ajouté', `${target} a été ajouté au ticket.`)] });
}

async function removeFromTicket(interaction) {
  const { channel, member } = interaction;
  if (!channel.name.startsWith('ticket-')) {
    return interaction.reply({ content: '❌ Utilise cette commande dans un channel de ticket.', ephemeral: true });
  }
  if (!isStaff(member)) {
    return interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true });
  }
  const target = interaction.options.getUser('utilisateur');
  await channel.permissionOverwrites.delete(target.id);
  await interaction.reply({ embeds: [ticketEmbed(0xf5c518, '➖ Utilisateur retiré', `${target} a été retiré du ticket.`)] });
}

async function listTickets(interaction) {
  const { guild, member } = interaction;
  if (!isStaff(member)) {
    return interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true });
  }
  const tickets = guild.channels.cache.filter(c => c.name.startsWith('ticket-'));
  if (!tickets.size) {
    return interaction.reply({ content: '📭 Aucun ticket ouvert.', ephemeral: true });
  }
  const list = tickets.map(c => `• ${c} — ${c.topic || 'Sans sujet'}`).join('\n');
  await interaction.reply({
    embeds: [ticketEmbed(0x5865f2, `🎫 Tickets ouverts (${tickets.size})`, list)],
    ephemeral: true,
  });
}

// ── Prefix handlers ────────────────────────────────────────────────────────

async function openTicketPrefix(message, args) {
  const sujet = args.join(' ') || 'Pas de sujet';
  const already = message.guild.channels.cache.find(c =>
    c.name.startsWith('ticket-') && c.permissionOverwrites.cache.has(message.author.id)
  );
  if (already) return message.reply(`❌ Tu as déjà un ticket ouvert : ${already}`);

  try {
    const { channel, num } = await createTicketChannel(message.guild, message.member, sujet);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Fermer le ticket').setStyle(ButtonStyle.Danger)
    );
    await channel.send({
      embeds: [ticketEmbed(0x5865f2, `🎫 Ticket #${num}`, `Bienvenue ${message.author} !\n**Sujet :** ${sujet}\n\nUn membre du staff va vous répondre sous peu.`)],
      components: [row],
    });
    message.reply(`✅ Ticket créé : ${channel}`);
  } catch (e) {
    message.reply(`❌ Erreur: ${e.message}`);
  }
}

async function closeTicketPrefix(message) {
  if (!message.channel.name.startsWith('ticket-')) return message.reply('❌ Utilise cette commande dans un ticket.');
  if (!isStaff(message.member)) return message.reply('❌ Réservé au staff.');
  await message.channel.send({ embeds: [ticketEmbed(0xe5484d, '🔒 Fermeture', `Ticket fermé par ${message.author}. Suppression dans 5s…`)] });
  setTimeout(() => message.channel.delete().catch(() => {}), 5000);
}

async function addToTicketPrefix(message) {
  if (!message.channel.name.startsWith('ticket-')) return message.reply('❌ Utilise dans un ticket.');
  if (!isStaff(message.member)) return message.reply('❌ Staff uniquement.');
  const target = message.mentions.users.first();
  if (!target) return message.reply('❌ Mentionne un utilisateur.');
  await message.channel.permissionOverwrites.create(target.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
  message.reply(`✅ ${target.tag} ajouté au ticket.`);
}

async function removeFromTicketPrefix(message) {
  if (!message.channel.name.startsWith('ticket-')) return message.reply('❌ Utilise dans un ticket.');
  if (!isStaff(message.member)) return message.reply('❌ Staff uniquement.');
  const target = message.mentions.users.first();
  if (!target) return message.reply('❌ Mentionne un utilisateur.');
  await message.channel.permissionOverwrites.delete(target.id);
  message.reply(`✅ ${target.tag} retiré du ticket.`);
}

async function listTicketsPrefix(message) {
  if (!isStaff(message.member)) return message.reply('❌ Staff uniquement.');
  const tickets = message.guild.channels.cache.filter(c => c.name.startsWith('ticket-'));
  if (!tickets.size) return message.reply('📭 Aucun ticket ouvert.');
  const list = tickets.map(c => `• ${c} — ${c.topic || 'Sans sujet'}`).join('\n');
  message.reply({ embeds: [ticketEmbed(0x5865f2, `🎫 Tickets (${tickets.size})`, list)] });
}

// ── Button handler (close button inside ticket) ───────────────────────────

function register(client) {
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId !== 'ticket_close') return;
    const { channel, member } = interaction;
    if (!channel.name.startsWith('ticket-')) return;
    if (!isStaff(member) && !channel.permissionOverwrites.cache.has(member.id)) {
      return interaction.reply({ content: '❌ Tu ne peux pas fermer ce ticket.', ephemeral: true });
    }
    await interaction.reply({ embeds: [ticketEmbed(0xe5484d, '🔒 Fermeture', `Ticket fermé par ${member}. Suppression dans 5s…`)] });
    setTimeout(() => channel.delete().catch(() => {}), 5000);
  });
}

module.exports = { slashCommands, prefixCommands, register };
