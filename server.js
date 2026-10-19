import express from 'express';
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScoreStore } from './lib/store.js';
import { HttpError, RunRegistry, loadQuestionBank, sanitizeName } from './lib/quiz.js';
import { Realtime } from './lib/realtime.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const ADMIN_KEY = process.env.ADMIN_KEY ?? 'sorting-admin';
const MAX_RECORDS = Number(process.env.MAX_RECORDS ?? 5000);

const bank = loadQuestionBank(path.join(root, 'data', 'questions.json'));
const recordsFile = path.join(process.env.DATA_DIR ?? path.join(root, 'data'), 'records.json');
const store = new ScoreStore(recordsFile);
const publicDir = path.join(root, 'public');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

const runs = new RunRegistry(bank, {
  onProgress: () => realtime.broadcastPresence(),
  onFinish: (record) => {
    store.add(record);
    if (store.records.length > MAX_RECORDS) {
      store.records.length = MAX_RECORDS;
      store.flush();
    }
    realtime.broadcast({ type: 'run:finished', record: summarise(record) });
  },
});

function summarise(record) {
  return {
    id: record.id,
    name: record.name,
    heroClass: record.heroClass,
    score: record.score,
    total: record.total,
    accuracy: record.accuracy,
    timeSeconds: record.timeSeconds,
    rank: record.rank,
    finishedAt: record.finishedAt,
  };
}

function requireAdmin(req, res, next) {
  const supplied = req.get('x-admin-key') ?? req.query.key;
  if (supplied && timingSafeEqual(String(supplied), ADMIN_KEY)) return next();
  return res.status(401).json({ error: 'Admin key required.' });
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const hits = new Map();
function rateLimit(req, res, next) {
  const key = `${req.ip}|${req.path}`;
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.start > 60000) {
    hits.set(key, { start: now, count: 1 });
    return next();
  }
  entry.count += 1;
  if (entry.count > 120) return res.status(429).json({ error: 'Too many requests, slow down.' });
  return next();
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'algorithm-quest',
    totalQuestions: bank.questions.length,
    activeRuns: runs.active().length,
    connectedClients: realtime?.connectedCount ?? 0,
    records: store.records.length,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    totalQuestions: bank.questions.length,
    monsters: bank.monsters,
    classes: bank.classes,
    serverTime: Date.now(),
  });
});

app.post('/api/runs/start', rateLimit, (req, res) => {
  const name = sanitizeName(req.body?.name);
  if (!name) throw new HttpError(400, 'Enter a player name or student ID.');
  const heroClassKey = String(req.body?.heroClass ?? 'paladin');
  const heroClass = bank.classes.find((entry) => entry.key === heroClassKey);
  if (!heroClass) throw new HttpError(400, 'Unknown hero class.');
  res.json(runs.create({ name, heroClass: heroClass.name }));
});

app.post('/api/runs/:runId/answer', rateLimit, (req, res) => {
  const entry = runs.answer(req.params.runId, req.body?.index, req.body?.selected);
  const active = runs.runs.get(req.params.runId);
  res.json({ entry, stage: active ? runs.summary(active) : null });
});

app.post('/api/runs/:runId/finish', rateLimit, (req, res) => {
  const record = runs.finish(req.params.runId);
  res.json({ record: summarise(record) });
});

app.get('/api/scores', (req, res) => {
  const limit = clampInt(req.query.limit, 1, 250, 60);
  const offset = clampInt(req.query.offset, 0, 100000, 0);
  const { rows, total } = store.list({ limit, offset, search: String(req.query.q ?? '') });
  res.json({ records: rows, total, stats: store.stats() });
});

app.post('/api/admin/verify', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

app.get('/api/scores/:id', requireAdmin, (req, res) => {
  const record = store.get(req.params.id);
  if (!record) throw new HttpError(404, 'No such record.');
  res.json({ record });
});

app.delete('/api/scores', requireAdmin, (req, res) => {
  res.json({ removed: store.clear() });
});

app.get('/api/export.csv', requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="algorithm-quest-scores-${Date.now()}.csv"`
  );
  res.send(store.toCsv());
});

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

app.use(express.static(publicDir, { extensions: ['html'], maxAge: '5m' }));

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API route.' }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error instanceof HttpError ? error.status : 500;
  if (status >= 500) console.error('[server]', error);
  res.status(status).json({ error: error.message || 'Unexpected server error.' });
});

const server = http.createServer(app);
const realtime = new Realtime(server, { getPresence: () => runs.active() });

server.listen(PORT, HOST, () => {
  printAccessUrls(PORT);
  if ((process.env.ADMIN_KEY ?? '') === '') {
    console.log('[admin] using default key "sorting-admin" — set ADMIN_KEY before publishing online');
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[server] port ${PORT} is busy. Try: PORT=3001 npm start`);
    process.exit(1);
  }
  throw error;
});

function printAccessUrls(port) {
  const interfaces = os.networkInterfaces();
  const addresses = Object.values(interfaces)
    .flat()
    .filter((info) => info && info.family === 'IPv4' && !info.internal)
    .map((info) => info.address);

  console.log('\n  ALGORITHM QUEST - The Sorting Saga');
  console.log(`  this device    http://localhost:${port}`);
  for (const address of addresses) {
    console.log(`  LAN (students) http://${address}:${port}`);
  }
  console.log(`  records file   ${recordsFile}`);
  console.log('  teacher dashboard: click ADMIN PANEL, enter the admin key\n');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    store.flush();
    realtime?.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
