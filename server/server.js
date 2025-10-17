// server/server.js
require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 8787;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_INPUT_CHARS = Number(process.env.MAX_INPUT_CHARS || 120000);
const CHUNK_SIZE_CHARS = Number(process.env.CHUNK_SIZE_CHARS || 4000);
const MAX_MODEL_TOKENS = Number(process.env.MAX_MODEL_TOKENS || 512);
const DAILY_TOKEN_CAP = Number(process.env.DAILY_TOKEN_CAP || 200000);
const COST_PER_1K_TOKENS = Number(process.env.COST_PER_1K_TOKENS || 0.002);
const EXTENSION_CLIENT_KEY = process.env.EXTENSION_CLIENT_KEY || 'dev-key-change-me';

// DB: simple SQLite file in server directory
const DB_PATH = path.join(__dirname, 'usage_db.sqlite');
const db = new Database(DB_PATH);

// Initialize schema if missing
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS usage_day (
  day TEXT NOT NULL,
  client_key TEXT NOT NULL,
  user_id TEXT,
  tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, client_key, user_id)
);
CREATE TABLE IF NOT EXISTS clients (
  client_key TEXT PRIMARY KEY,
  display_name TEXT,
  daily_cap INTEGER
);
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  client_key TEXT,
  display_name TEXT,
  daily_cap INTEGER
);
`);

// Ensure there's a clients entry for the EXTENSION_CLIENT_KEY (so admin can change cap)
try {
  const up = db.prepare('INSERT OR IGNORE INTO clients(client_key, display_name, daily_cap) VALUES (?, ?, ?)');
  up.run(EXTENSION_CLIENT_KEY, 'default-extension-client', DAILY_TOKEN_CAP);
} catch (e) {
  console.error('DB insert clients error', e);
}

// helpers: token estimate (rough)
function estimateTokensFromChars(chars) { return Math.ceil((chars || 0) / 4); }
function estimateCost(tokens) { return (tokens / 1000) * COST_PER_1K_TOKENS; }

// increment usage in DB
function incrementUsageInDb({ day, client_key, user_id = null, tokens = 0 }) {
  const existsRow = db.prepare('SELECT tokens FROM usage_day WHERE day = ? AND client_key = ? AND user_id IS ?').get(day, client_key, user_id);
  if (existsRow) {
    db.prepare('UPDATE usage_day SET tokens = tokens + ? WHERE day = ? AND client_key = ? AND user_id IS ?')
      .run(tokens, day, client_key, user_id);
  } else {
    db.prepare('INSERT INTO usage_day(day, client_key, user_id, tokens) VALUES (?, ?, ?, ?)').run(day, client_key, user_id, tokens);
  }
  return db.prepare('SELECT tokens FROM usage_day WHERE day = ? AND client_key = ? AND user_id IS ?').get(day, client_key, user_id).tokens;
}

// get usage for day (client & optional user)
function getUsageForDay(day, client_key, user_id = null) {
  const row = db.prepare('SELECT tokens FROM usage_day WHERE day = ? AND client_key = ? AND user_id IS ?').get(day, client_key, user_id);
  return (row && row.tokens) || 0;
}

// get effective daily cap (user -> client -> global default)
function getDailyCapFor(client_key, user_id = null) {
  if (user_id) {
    const r = db.prepare('SELECT daily_cap FROM users WHERE user_id = ?').get(user_id);
    if (r && r.daily_cap) return r.daily_cap;
  }
  const rc = db.prepare('SELECT daily_cap FROM clients WHERE client_key = ?').get(client_key);
  if (rc && rc.daily_cap) return rc.daily_cap;
  return DAILY_TOKEN_CAP;
}

// small sleep helper
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// OpenAI call with retry/backoff and structured errors
async function callOpenAI(prompt, max_tokens = MAX_MODEL_TOKENS, retryOpts = { retries: 2, baseDelayMs: 700 }) {
  const url = 'https://api.openai.com/v1/responses';
  const body = { model: MODEL, input: prompt, max_output_tokens: max_tokens };

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type':'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify(body),
      });

      const text = await resp.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { json = { raw: text }; }

      if (!resp.ok) {
        const errType = json && json.error && json.error.type ? json.error.type : 'openai-error';
        const errCode = json && json.error && json.error.code ? json.error.code : null;
        const errMsg = json && json.error && json.error.message ? json.error.message : `HTTP ${resp.status}`;

        if (resp.status === 429 && attempt <= (retryOpts.retries || 0) + 1) {
          const wait = (retryOpts.baseDelayMs || 700) * Math.pow(2, attempt - 1);
          console.warn(`OpenAI 429 rate-limited (attempt ${attempt}). backoff ${wait}ms — ${errMsg}`);
          await sleep(wait);
          continue;
        }

        const err = new Error(`OpenAI error: ${resp.status} ${errMsg}`);
        err.openai = { status: resp.status, type: errType, code: errCode, message: errMsg, raw: json };
        throw err;
      }

      try {
        const parsed = JSON.parse(text || '{}');
        return parsed;
      } catch (e) {
        return { output_text: text || '' };
      }
    } catch (err) {
      const isRate = err && err.openai && err.openai.status === 429;
      if (isRate && attempt <= (retryOpts.retries || 0) + 1) {
        const wait = (retryOpts.baseDelayMs || 700) * Math.pow(2, attempt - 1);
        console.warn(`callOpenAI retrying after error attempt ${attempt}: ${err.message}. waiting ${wait}ms`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
}

const app = express();
// CORS: restrict to ALLOWED_ORIGINS from env (comma separated)
const rawAllowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
const allowedOrigins = new Set(rawAllowed);
app.use((req, res, next) => {
  const origin = req.get('Origin') || '';
  if (allowedOrigins.size === 0) {
    res.header('Access-Control-Allow-Origin', '*');
  } else if (allowedOrigins.has(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-extension-key, x-user-id');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '1mb' }));

// rate limiter per IP (still useful)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// auth middleware: require x-extension-key (and optionally x-user-id)
app.use((req, res, next) => {
  const clientKey = req.header('x-extension-key') || req.query.k || (req.body && req.body.key);
  if (!clientKey || clientKey !== EXTENSION_CLIENT_KEY) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  req.clientKey = clientKey;
  // optional user id from extension; if provided we track per-user usage
  const userId = req.header('x-user-id') || null;
  req.userId = userId;
  next();
});

// GET /usage -> returns today's usage summary for this client (and optionally for user)
app.get('/usage', (req, res) => {
  try {
    const clientKey = req.clientKey;
    const userId = req.userId;
    const today = (new Date()).toISOString().slice(0,10);
    const clientTokens = getUsageForDay(today, clientKey, null);
    const userTokens = userId ? getUsageForDay(today, clientKey, userId) : null;
    const cap = getDailyCapFor(clientKey, userId);
    return res.json({ ok: true, today, clientTokens, userTokens, dailyCap: cap });
  } catch (err) {
    console.error('/usage error', err);
    return res.status(500).json({ ok:false, error:'server-error' });
  }
});

// GET /quota -> shows remaining tokens (client / user)
app.get('/quota', (req, res) => {
  try {
    const clientKey = req.clientKey;
    const userId = req.userId;
    const today = (new Date()).toISOString().slice(0,10);
    const cap = getDailyCapFor(clientKey, userId);
    const used = getUsageForDay(today, clientKey, userId);
    const remaining = Math.max(0, cap - used);
    return res.json({ ok: true, dailyCap: cap, used, remaining });
  } catch (err) {
    console.error('/quota error', err);
    return res.status(500).json({ ok:false, error:'server-error' });
  }
});

// POST /summarize
app.post('/summarize', async (req, res) => {
  try {
    const clientKey = req.clientKey;
    const userId = req.userId;
    const { text = '', maxSentences = 3 } = req.body || {};
    if (!text || typeof text !== 'string') return res.status(400).json({ ok:false, error:'missing-text' });
    if (text.length > MAX_INPUT_CHARS) return res.status(400).json({ ok:false, error: 'input-too-large', max: MAX_INPUT_CHARS });

    const inputChars = text.length;
    const estInputTokens = estimateTokensFromChars(inputChars);
    // conservative extra tokens for model output
    const estTokensForModel = Math.min(MAX_MODEL_TOKENS, Math.ceil(estInputTokens/Math.max(1, Math.floor(CHUNK_SIZE_CHARS/1000))) * 200);
    const estimatedTotalTokens = estInputTokens + estTokensForModel;
    const cap = getDailyCapFor(clientKey, userId);
    const today = (new Date()).toISOString().slice(0,10);
    const usedToday = getUsageForDay(today, clientKey, userId);

    if (usedToday + estimatedTotalTokens > cap) {
      return res.status(429).json({ ok:false, error: 'daily-cap-exceeded', dailyCap: cap, used: usedToday, need: estimatedTotalTokens });
    }

    // chunk input
    const chunks = [];
    for (let i=0;i<text.length;i+=CHUNK_SIZE_CHARS) chunks.push(text.slice(i, i+CHUNK_SIZE_CHARS));

    let combinedSummaryParts = [];
    let tokensConsumed = 0;

    for (const chunk of chunks) {
      const prompt = `Summarize the following text into ${maxSentences} concise sentences suitable for a user-facing summary:\n\n${chunk}`;
      let r;
      try {
        r = await callOpenAI(prompt, Math.min(256, MAX_MODEL_TOKENS));
      } catch (err) {
        const oa = err && err.openai;
        console.error('OpenAI call error', oa || err.message || err);
        if (oa && oa.status === 429) return res.status(429).json({ ok:false, error: 'rate_limit_exceeded', detail: oa });
        if (oa && oa.status === 401) return res.status(401).json({ ok:false, error: 'unauthorized', detail: oa });
        return res.status(502).json({ ok:false, error: 'openai-down-or-error', detail: oa || String(err.message) });
      }

      // defensive parsing of Responses API
      let summaryText = '';
      if (r && typeof r === 'object') {
        if (typeof r.output_text === 'string') summaryText = r.output_text;
        else if (Array.isArray(r.output) && r.output[0] && r.output[0].content) {
          const content = r.output[0].content;
          if (typeof content === 'string') summaryText = content;
          else if (Array.isArray(content)) summaryText = content.map(c=>c.text||'').join(' ');
        } else if (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) {
          summaryText = r.choices[0].message.content;
        }
      }
      combinedSummaryParts.push((summaryText||'').trim());

      if (r && r.usage && typeof r.usage.total_tokens === 'number') tokensConsumed += r.usage.total_tokens;
      else tokensConsumed += estimateTokensFromChars(chunk.length) + Math.min(256, MAX_MODEL_TOKENS);
    }

    let finalSummary = combinedSummaryParts.join('\n\n');
    if (combinedSummaryParts.length > 1) {
      // final refinement
      try {
        const refinePrompt = `Combine and tighten the following partial summaries into ${maxSentences} sentences:\n\n${finalSummary}`;
        const r2 = await callOpenAI(refinePrompt, Math.min(256, MAX_MODEL_TOKENS));
        if (r2 && (r2.output_text || (Array.isArray(r2.output) && r2.output[0] && r2.output[0].content))) {
          const textOut = r2.output_text || ((r2.output && r2.output[0] && r2.output[0].content) || '');
          finalSummary = (typeof textOut === 'string') ? textOut.trim() : finalSummary;
        }
        if (r2 && r2.usage && typeof r2.usage.total_tokens === 'number') tokensConsumed += r2.usage.total_tokens;
        else tokensConsumed += estimateTokensFromChars(finalSummary.length) + Math.min(256, MAX_MODEL_TOKENS);
      } catch (err) {
        console.warn('refinement call failed, proceeding with combined parts', err && err.openai ? err.openai : err);
      }
    }

    // persist usage
    incrementUsageInDb({ day: today, client_key: clientKey, user_id: userId, tokens: tokensConsumed });

    return res.json({ ok: true, summary: finalSummary, tokensUsed: tokensConsumed, estimatedCost: estimateCost(tokensConsumed) });
  } catch (err) {
    console.error('/summarize error', err);
    return res.status(500).json({ ok:false, error: 'server-error', detail: String(err && err.message ? err.message : err) });
  }
});

// Admin note: simple endpoint to show DB rows (not exposed in production)
// You can remove or protect this behind a separate admin key before deploying
app.get('/_admin/usage_rows', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM usage_day ORDER BY day DESC LIMIT 200').all();
    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('/_admin/usage_rows err', err);
    return res.status(500).json({ ok:false });
  }
});

app.listen(PORT, () => {
  console.log(`OpenAI proxy server listening on port ${PORT}`);
});
