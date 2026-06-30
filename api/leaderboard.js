// Vercel serverless function: the leaderboard data layer for
// Liquidity or Liquidation.
//
// Why this exists: the in-chat prototype used claude.ai shared storage
// (window.storage), which does not exist on a deployed site. This endpoint is
// the production swap - the browser never touches Supabase or any key. Reads
// and writes both route through here using the service role key, which lives
// only in server-side env vars.
//
// Security posture:
//   - No keys in the frontend. Service key is server-side only.
//   - RLS is ON for the table with no anon policies, so even a leaked anon key
//     can't read or write directly (see supabase/schema.sql).
//   - Submit is IP-rate-limited (hashed IP, never raw) to deter score-stuffing.
//   - Handle/twitter are length-capped, char-filtered, and profanity-screened
//     server-side - client validation is not trusted.
//   - The row key is re-derived from the handle server-side so nobody can
//     overwrite another player's row by forging a key.
//   - Errors return generic messages; details are logged server-side only,
//     and secrets are never logged.
//   - CORS is scoped to ALLOWED_ORIGINS.
//
// Honest, documented limitation: scores are client-submitted, so the board is
// spoofable (anyone can POST any score). That is acceptable for a joke game.
// Real tamper-resistance = server-side score validation, intentionally out of
// scope. See README.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { isProfane } = require('../lib/profanity');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RATE_SALT = process.env.RATE_SALT || 'lol-default-salt-change-me';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Tunables
const TOP_N = 50;
const HANDLE_MAX = 20;
const TWITTER_MAX = 15;
const SCORE_MAX = 1e12; // sanity cap to stop overflow / absurd values
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_PER_WINDOW = 8;

let _client = null;
function db() {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return _client;
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(ip + RATE_SALT).digest('hex');
}

// Mirror of the client's keyFor() - the row identity for a player.
function keyFor(handle) {
  return 'k' + String(handle).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
}

function cleanHandle(raw) {
  return String(raw || '').trim().slice(0, HANDLE_MAX);
}

function cleanTwitter(raw) {
  return String(raw || '')
    .trim()
    .replace(/^@/, '')
    .replace(/[^A-Za-z0-9_]/g, '')
    .slice(0, TWITTER_MAX);
}

function publicRow(r) {
  return { key: r.key, handle: r.handle, twitter: r.twitter || '', score: r.score, ts: r.ts };
}

async function readBoard() {
  const { data, error } = await db()
    .from('lol_leaderboard')
    .select('key, handle, twitter, score, ts')
    .order('score', { ascending: false })
    .limit(TOP_N);
  if (error) throw error;
  return (data || []).map(publicRow);
}

// Durable-ish IP rate limit using the existing Supabase. Counts recent rows
// for this hashed IP; rejects over the cap. Best-effort cleanup of old rows.
async function rateLimited(ipHash) {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count, error } = await db()
    .from('lol_rate_limit')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('ts', since);
  if (error) throw error;
  if ((count || 0) >= RATE_MAX_PER_WINDOW) return true;
  await db().from('lol_rate_limit').insert({ ip_hash: ipHash });
  // opportunistic GC: drop rows older than an hour
  const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  db().from('lol_rate_limit').delete().lt('ts', stale).then(() => {}, () => {});
  return false;
}

module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('leaderboard: missing Supabase env configuration');
    res.status(500).json({ error: 'Leaderboard is not configured.' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const board = await readBoard();
      res.status(200).json({ board });
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
      const handle = cleanHandle(body.handle);
      const twitter = cleanTwitter(body.twitter);
      let score = Number(body.score);

      if (!handle) {
        res.status(400).json({ error: 'Pick a handle first.' });
        return;
      }
      const key = keyFor(handle);
      if (key === 'k') {
        res.status(400).json({ error: 'Handle needs a letter or number.' });
        return;
      }
      if (!Number.isFinite(score) || score < 0) {
        res.status(400).json({ error: 'Invalid score.' });
        return;
      }
      score = Math.min(Math.floor(score), SCORE_MAX);

      if (isProfane(handle) || isProfane(twitter)) {
        res.status(400).json({ error: 'That handle did not pass moderation. Try another.' });
        return;
      }

      const ipHash = hashIp(clientIp(req));
      if (await rateLimited(ipHash)) {
        res.status(429).json({ error: 'Slow down - too many submissions. Try again in a minute.' });
        return;
      }

      // keep best score for this key
      const { data: existing, error: selErr } = await db()
        .from('lol_leaderboard')
        .select('score')
        .eq('key', key)
        .maybeSingle();
      if (selErr) throw selErr;

      const finalScore = existing ? Math.max(existing.score, score) : score;
      const { error: upErr } = await db()
        .from('lol_leaderboard')
        .upsert(
          { key, handle, twitter, score: finalScore, ts: new Date().toISOString() },
          { onConflict: 'key' }
        );
      if (upErr) throw upErr;

      const board = await readBoard();
      const rank = board.findIndex((e) => e.key === key) + 1;
      res.status(200).json({ board, key, rank: rank || null });
      return;
    }

    if (req.method === 'DELETE') {
      // admin remove path - the simple report/remove escape hatch.
      const token = req.headers['x-admin-token'] || '';
      if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
        res.status(403).json({ error: 'Forbidden.' });
        return;
      }
      const key = (req.query && req.query.key) || (safeParse(req.body)?.key);
      if (!key) {
        res.status(400).json({ error: 'Missing key.' });
        return;
      }
      const { error } = await db().from('lol_leaderboard').delete().eq('key', String(key));
      if (error) throw error;
      const board = await readBoard();
      res.status(200).json({ board, removed: key });
      return;
    }

    res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    // never leak internals to the client; log server-side without secrets
    console.error('leaderboard error:', err && err.message ? err.message : 'unknown');
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
};

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return {};
  }
}
