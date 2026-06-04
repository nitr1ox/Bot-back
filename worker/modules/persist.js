/**
 * Simple Firestore persistence helper for bot modules.
 * Stores/retrieves per-guild data with in-memory cache.
 */
const { db } = require('../../firebase');

const cache = new Map(); // key → { data, ts }
const CACHE_TTL = 5 * 60 * 1000; // 5min

async function loadData(botId, guildId, key) {
  const cacheKey = `${botId}:${guildId}:${key}`;
  const cached   = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  try {
    const snap = await db.collection('bot_data').doc(`${botId}_${guildId}_${key}`).get();
    const data = snap.exists ? snap.data().value : null;
    cache.set(cacheKey, { data, ts: Date.now() });
    return data;
  } catch { return null; }
}

async function saveData(botId, guildId, key, value) {
  const cacheKey = `${botId}:${guildId}:${key}`;
  cache.set(cacheKey, { data: value, ts: Date.now() });
  try {
    await db.collection('bot_data').doc(`${botId}_${guildId}_${key}`).set({ value, updatedAt: new Date().toISOString() });
  } catch {}
}

module.exports = { loadData, saveData };
