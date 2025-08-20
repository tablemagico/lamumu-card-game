// Node.js Serverless Function (Vercel)
// Zorunlu: REDIS_URL
// İsteğe bağlı: REDIS_NS (varsayılan: "lamu")
module.exports.config = { runtime: 'nodejs' };

const Redis = require('ioredis');

const NS = process.env.REDIS_NS || 'lamu';
const K  = (s) => `${NS}:${s}`;

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

function setNoCache(res) {
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Expires','0');
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    setNoCache(res);
    res.end('Method Not Allowed');
    return;
  }

  try {
    const r = getRedis();

    // ?start=0&count=50&rankFor=username
    const url = new URL(req.url, 'http://localhost');
    const start = Math.max(0, parseInt(url.searchParams.get('start') ?? '0', 10));
    const count = Math.max(1, Math.min(200, parseInt(url.searchParams.get('count') ?? '50', 10)));
    const rankForRaw = url.searchParams.get('rankFor');
    const rankFor = rankForRaw ? String(rankForRaw).toLowerCase().replace(/^@/, '').trim() : null;

    const totalPromise = r.zcard(K('board'));
    const members = await r.zrevrange(K('board'), start, start + count - 1);
    const total = await totalPromise;

    let rank = null;
    if (rankFor) {
      const rv = await r.zrevrank(K('board'), rankFor);
      if (rv !== null && rv !== undefined) rank = rv + 1; // 1-based
    }

    let items = [];
    if (members.length) {
      const pipe = r.pipeline();
      for (const u of members) pipe.hmget(K(`detail:${u}`), 'username', 'score', 'updatedAt');
      const rows = await pipe.exec();
      items = members.map((u, i) => {
        const arr = rows[i]?.[1] || [];
        const username = (arr?.[0] || u);
        return {
          username,
          score: parseInt(arr?.[1] ?? '0', 10),
          updatedAt: parseInt(arr?.[2] ?? '0', 10)
        };
      });
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    setNoCache(res);
    res.end(JSON.stringify({ items, start, count, total, rank }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('content-type','application/json');
    setNoCache(res);
    res.end(JSON.stringify({ error: String(e) }));
  }
};
