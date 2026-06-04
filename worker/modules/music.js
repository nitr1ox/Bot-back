/**
 * Module: Musique
 * Commandes: /play /skip /stop /pause /resume /queue /nowplaying /volume /shuffle /loop
 * Prefix: !play !skip !stop !pause !resume !queue !np !volume !shuffle !loop
 *
 * Utilise @discordjs/voice + ytdl-core
 * Requiert: npm install @discordjs/voice @discordjs/opus ytdl-core ffmpeg-static
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  getVoiceConnection,
  entersState,
} = require('@discordjs/voice');

let ytdl;
try { ytdl = require('ytdl-core'); } catch { ytdl = null; }

// Per-guild queue: guildId → { queue: [], player, connection, loop, volume, textChannel }
const queues = new Map();

function getQueue(guildId) {
  return queues.get(guildId);
}

function createQueue(guild, voiceChannel, textChannel) {
  const player = createAudioPlayer();
  const connection = joinVoiceChannel({
    channelId:      voiceChannel.id,
    guildId:        guild.id,
    adapterCreator: guild.voiceAdapterCreator,
  });
  connection.subscribe(player);

  const queue = {
    guild,
    voiceChannel,
    textChannel,
    connection,
    player,
    songs:   [],
    loop:    false,
    volume:  100,
    playing: false,
  };
  queues.set(guild.id, queue);
  return queue;
}

async function playSong(queue, song) {
  if (!song) {
    queue.playing = false;
    queue.connection.destroy();
    queues.delete(queue.guild.id);
    return;
  }

  if (!ytdl) {
    queue.textChannel.send('❌ `ytdl-core` non installé. Lance `npm install ytdl-core @discordjs/voice @discordjs/opus ffmpeg-static`').catch(() => {});
    return;
  }

  try {
    const stream   = ytdl(song.url, { filter: 'audioonly', quality: 'lowestaudio', highWaterMark: 1 << 25 });
    const resource = createAudioResource(stream);
    queue.player.play(resource);
    queue.playing = true;

    queue.textChannel.send({ embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎵 En cours')
      .setDescription(`[${song.title}](${song.url})`)
      .addFields(
        { name: 'Durée',       value: song.duration || 'Inconnue', inline: true },
        { name: 'Demandé par', value: song.requestedBy,            inline: true },
      )
    ]}).catch(() => {});
  } catch (e) {
    queue.textChannel.send(`❌ Erreur lors de la lecture: ${e.message}`).catch(() => {});
    queue.songs.shift();
    playSong(queue, queue.songs[0]);
  }
}

async function addToQueue(guildId, voiceChannel, textChannel, url, requestedBy) {
  if (!ytdl) return null;
  try {
    const info = await ytdl.getInfo(url);
    const song = {
      title:       info.videoDetails.title,
      url,
      duration:    formatDuration(info.videoDetails.lengthSeconds),
      thumbnail:   info.videoDetails.thumbnails[0]?.url,
      requestedBy: requestedBy.tag,
    };

    let queue = getQueue(guildId);
    if (!queue) {
      queue = createQueue({ id: guildId, voiceAdapterCreator: voiceChannel.guild.voiceAdapterCreator }, voiceChannel, textChannel);
      queue.guild = voiceChannel.guild;

      queue.player.on(AudioPlayerStatus.Idle, () => {
        if (queue.loop && queue.songs.length) {
          playSong(queue, queue.songs[0]);
        } else {
          queue.songs.shift();
          playSong(queue, queue.songs[0]);
        }
      });

      queue.player.on('error', err => {
        console.error('Music player error:', err);
        queue.songs.shift();
        playSong(queue, queue.songs[0]);
      });

      queue.songs.push(song);
      playSong(queue, song);
    } else {
      queue.songs.push(song);
    }
    return song;
  } catch {
    return null;
  }
}

function formatDuration(seconds) {
  const s = seconds % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}

function isYoutubeUrl(str) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/.test(str);
}

// ── Slash
const slashCommands = [
  {
    data: new SlashCommandBuilder().setName('play').setDescription('Jouer une musique YouTube')
      .addStringOption(o => o.setName('url').setDescription('URL YouTube').setRequired(true)),
    async execute(i) {
      const voiceChannel = i.member.voice.channel;
      if (!voiceChannel) return i.reply({ content: '❌ Rejoins un salon vocal d\'abord.', ephemeral: true });
      const url = i.options.getString('url');
      if (!isYoutubeUrl(url)) return i.reply({ content: '❌ URL YouTube invalide.', ephemeral: true });
      await i.deferReply();
      const song = await addToQueue(i.guild.id, voiceChannel, i.channel, url, i.user);
      if (!song) return i.editReply('❌ Impossible de charger cette vidéo. Vérifie que `ytdl-core` est installé.');
      const queue = getQueue(i.guild.id);
      if (queue.songs.length > 1) {
        await i.editReply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📋 Ajouté à la file').setDescription(`[${song.title}](${url})\nPosition: **#${queue.songs.length}**`)] });
      } else {
        await i.deleteReply().catch(() => {});
      }
    },
  },
  {
    data: new SlashCommandBuilder().setName('skip').setDescription('Passer la musique actuelle'),
    async execute(i) {
      const queue = getQueue(i.guild.id);
      if (!queue?.playing) return i.reply({ content: '❌ Rien en cours.', ephemeral: true });
      queue.player.stop();
      await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription('⏭️ Musique passée.')] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('stop').setDescription('Arrêter la musique et vider la file'),
    async execute(i) {
      const queue = getQueue(i.guild.id);
      if (!queue) return i.reply({ content: '❌ Rien en cours.', ephemeral: true });
      queue.songs = [];
      queue.player.stop();
      queue.connection.destroy();
      queues.delete(i.guild.id);
      await i.reply({ embeds: [new EmbedBuilder().setColor(0xe5484d).setDescription('⏹️ Musique arrêtée et file vidée.')] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('pause').setDescription('Mettre en pause'),
    async execute(i) {
      const queue = getQueue(i.guild.id);
      if (!queue?.playing) return i.reply({ content: '❌ Rien en cours.', ephemeral: true });
      queue.player.pause();
      await i.reply({ embeds: [new EmbedBuilder().setColor(0xf5c518).setDescription('⏸️ En pause.')] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('resume').setDescription('Reprendre la lecture'),
    async execute(i) {
      const queue = getQueue(i.guild.id);
      if (!queue) return i.reply({ content: '❌ Rien en cours.', ephemeral: true });
      queue.player.unpause();
      await i.reply({ embeds: [new EmbedBuilder().setColor(0x3ecf8e).setDescription('▶️ Reprise.')] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('queue').setDescription('Voir la file d\'attente'),
    async execute(i) {
      const queue = getQueue(i.guild.id);
      if (!queue?.songs.length) return i.reply({ content: '📭 File vide.', ephemeral: true });
      const lines = queue.songs.map((s, idx) => `${idx === 0 ? '▶️' : `**${idx}.**`} [${s.title}](${s.url}) — ${s.duration}`).slice(0, 15).join('\n');
      await i.reply({ embeds: [new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📋 File (${queue.songs.length} musique(s))`)
        .setDescription(lines)
        .setFooter({ text: queue.loop ? '🔁 Loop activé' : '' })
      ]});
    },
  },
  {
    data: new SlashCommandBuilder().setName('nowplaying').setDescription('Voir la musique en cours'),
    async execute(i) {
      const queue = getQueue(i.guild.id);
      if (!queue?.songs[0]) return i.reply({ content: '❌ Rien en cours.', ephemeral: true });
      const s = queue.songs[0];
      await i.reply({ embeds: [new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎵 En cours')
        .setDescription(`[${s.title}](${s.url})`)
        .addFields(
          { name: 'Durée',       value: s.duration || '?', inline: true },
          { name: 'Demandé par', value: s.requestedBy,     inline: true },
        )
        .setThumbnail(s.thumbnail || null)
      ]});
    },
  },
  {
    data: new SlashCommandBuilder().setName('shuffle').setDescription('Mélanger la file'),
    async execute(i) {
      const queue = getQueue(i.guild.id);
      if (!queue || queue.songs.length < 2) return i.reply({ content: '❌ Pas assez de musiques.', ephemeral: true });
      const current = queue.songs.shift();
      queue.songs.sort(() => Math.random() - 0.5);
      queue.songs.unshift(current);
      await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription(`🔀 File mélangée (${queue.songs.length} musiques).`)] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('loop').setDescription('Activer/désactiver le loop'),
    async execute(i) {
      const queue = getQueue(i.guild.id);
      if (!queue) return i.reply({ content: '❌ Rien en cours.', ephemeral: true });
      queue.loop = !queue.loop;
      await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription(queue.loop ? '🔁 Loop activé.' : '➡️ Loop désactivé.')] });
    },
  },
];

// ── Prefix
const prefixCommands = [
  { name: 'play', aliases: ['p'],
    async execute(msg, args) {
      const voiceChannel = msg.member.voice.channel;
      if (!voiceChannel) return msg.reply('❌ Rejoins un salon vocal.');
      const url = args[0];
      if (!url || !isYoutubeUrl(url)) return msg.reply('❌ URL YouTube invalide.');
      const song = await addToQueue(msg.guild.id, voiceChannel, msg.channel, url, msg.author);
      if (!song) return msg.reply('❌ Impossible de charger. `ytdl-core` installé ?');
      const queue = getQueue(msg.guild.id);
      if (queue.songs.length > 1) msg.reply(`📋 Ajouté: **${song.title}** (#${queue.songs.length})`);
    }},
  { name: 'skip', aliases: ['s'],
    async execute(msg) {
      const q = getQueue(msg.guild.id);
      if (!q?.playing) return msg.reply('❌ Rien en cours.');
      q.player.stop(); msg.reply('⏭️ Skip.');
    }},
  { name: 'stop',
    async execute(msg) {
      const q = getQueue(msg.guild.id);
      if (!q) return msg.reply('❌ Rien en cours.');
      q.songs = []; q.player.stop(); q.connection.destroy(); queues.delete(msg.guild.id);
      msg.reply('⏹️ Stop.');
    }},
  { name: 'pause',
    async execute(msg) {
      const q = getQueue(msg.guild.id);
      if (!q) return msg.reply('❌ Rien en cours.');
      q.player.pause(); msg.reply('⏸️ Pause.');
    }},
  { name: 'resume',
    async execute(msg) {
      const q = getQueue(msg.guild.id);
      if (!q) return msg.reply('❌ Rien en cours.');
      q.player.unpause(); msg.reply('▶️ Reprise.');
    }},
  { name: 'queue', aliases: ['q'],
    async execute(msg) {
      const q = getQueue(msg.guild.id);
      if (!q?.songs.length) return msg.reply('📭 File vide.');
      const lines = q.songs.map((s,i) => `${i===0?'▶️':`**${i}.**`} ${s.title} — ${s.duration}`).slice(0,15).join('\n');
      msg.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`📋 File (${q.songs.length})`).setDescription(lines)] });
    }},
  { name: 'np', aliases: ['nowplaying'],
    async execute(msg) {
      const q = getQueue(msg.guild.id);
      if (!q?.songs[0]) return msg.reply('❌ Rien en cours.');
      msg.reply(`🎵 **${q.songs[0].title}** — ${q.songs[0].duration}`);
    }},
  { name: 'shuffle',
    async execute(msg) {
      const q = getQueue(msg.guild.id);
      if (!q || q.songs.length < 2) return msg.reply('❌ Pas assez de musiques.');
      const cur = q.songs.shift(); q.songs.sort(() => Math.random() - 0.5); q.songs.unshift(cur);
      msg.reply(`🔀 File mélangée.`);
    }},
  { name: 'loop',
    async execute(msg) {
      const q = getQueue(msg.guild.id);
      if (!q) return msg.reply('❌ Rien en cours.');
      q.loop = !q.loop; msg.reply(q.loop ? '🔁 Loop activé.' : '➡️ Loop désactivé.');
    }},
];

module.exports = { slashCommands, prefixCommands };
