// Node.js Serverless Function (Vercel)
// Kullanım: REDIS_URL zorunlu. İsteğe bağlı: REDIS_NS (varsayılan "lamu").
module.exports.config = { runtime: 'nodejs' };

const Redis = require('ioredis');

const NS = process.env.REDIS_NS || 'lamu';         // yeni proje namespace'i
const K  = (s) => `${NS}:${s}`;                    // key helper

let client;
function getRedis() {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  let opts = {};
  try { const u = new URL(url); if (u.protocol === 'rediss:') opts.tls = {}; } catch (_) {}
  client = new Redis(url, opts);
  return client;
}

// Sıralama skoru: önce matched (büyük ↑), eşitse süre küçük (hızlı ↑)
const rankComposite = (matched, timeMs) => matched * 1_000_000_000 - timeMs;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return; }

  try {
    // Body: { username, matched, timeMs }
    const body = await readJson(req);
    let { username, matched, timeMs } = body;

    if (!username || typeof matched !== 'number' || typeof timeMs !== 'number') {
      res.statusCode = 400; res.setHeader('content-type','application/json');
      res.end(JSON.stringify({ error: 'Invalid payload' })); return;
    }

    const uname = String(username).toLowerCase().replace(/^@/, '').trim();
    const m = Math.max(0, Math.min(8, Math.floor(matched)));              // 0..8
    const t = Math.max(0, Math.min(3_600_000, Math.floor(timeMs)));       // <= 1 saat güvenlik
    const composite = rankComposite(m, t);

    const r = getRedis();

    // Mevcut composite skoru oku
    const cur = await r.zscore(K('board'), uname);
    const curNum = cur == null ? null : Number(cur);

    let updated = false;
    if (curNum == null || composite > curNum) {
      // ZSET: board → composite (rank için)
      // HASH: detail:<uname> → username, score (bulunan çift sayısı), updatedAt
      const multi = r.multi();
      multi.zadd(K('board'), composite, uname);
      multi.hset(K(`detail:${uname}`),
        'username', uname,
        'score', String(m),          // <-- sadece "score" alanını kullanıyoruz (çift sayısı)
        'updatedAt', String(Date.now())
      );
      await multi.exec();
      updated = true;
    }

    res.statusCode = 200; res.setHeader('content-type','application/json');
    res.end(JSON.stringify({ updated }));
  } catch (e) {
    res.statusCode = 500; res.setHeader('content-type','application/json');
    res.end(JSON.stringify({ error: String(e) }));
  }
};
