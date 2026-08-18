'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { nanoid } = require('nanoid');

const app = express();
const PORT = parseInt(process.env.PORT ?? '4040', 10);
const DATA_DIR = process.env.DATA_DIR ?? '/data/clips';
const MAX_CLIPS = parseInt(process.env.MAX_CLIPS ?? '500', 10);
const MAX_SIZE_KB = parseInt(process.env.MAX_SIZE_KB ?? '512', 10);

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Middleware ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ limit: '2mb', type: 'text/plain' }));

// ── Helpers ──────────────────────────────────────────────────
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return (forwarded ? forwarded.split(',')[0].trim() : null)
    ?? req.socket?.remoteAddress
    ?? 'unknown';
}

/** Validate clip ID to prevent path traversal */
function isValidId(id) {
  return /^[\w-]+$/.test(id);
}

function readMeta(id) {
  const p = path.join(DATA_DIR, `${id}.meta`);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readContent(id) {
  const p = path.join(DATA_DIR, `${id}.txt`);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

/** Returns all clip metadata sorted by creation date descending */
function getAllClips() {
  try {
    return fs.readdirSync(DATA_DIR)
      .filter((f) => f.endsWith('.meta'))
      .map((f) => readMeta(f.slice(0, -5)))
      .filter(Boolean)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } catch {
    return [];
  }
}

/** Remove oldest clips when limit is exceeded */
function enforceLimit() {
  const clips = getAllClips();
  if (clips.length <= MAX_CLIPS) return;
  for (const clip of clips.slice(MAX_CLIPS)) {
    try { fs.unlinkSync(path.join(DATA_DIR, `${clip.id}.txt`)); } catch { /* ignore */ }
    try { fs.unlinkSync(path.join(DATA_DIR, `${clip.id}.meta`)); } catch { /* ignore */ }
  }
}

// ── Routes ───────────────────────────────────────────────────

/**
 * POST /api/clips
 * Accepts: application/json { content: string } or text/plain body
 * Compatible with: curl --data-binary @- -H "Content-Type: text/plain"
 */
app.post('/api/clips', (req, res) => {
  // express.text() populates req.body as a string for text/plain
  // express.json() populates req.body as an object for application/json
  const content = typeof req.body === 'string' ? req.body : (req.body?.content ?? '');

  if (!content.trim()) {
    return res.status(400).json({ error: 'Content is required' });
  }

  const sizeBytes = Buffer.byteLength(content, 'utf8');
  if (sizeBytes > MAX_SIZE_KB * 1024) {
    return res.status(413).json({ error: `Content exceeds ${MAX_SIZE_KB} KB limit` });
  }

  const ts = Date.now();
  const id = `${ts}_${nanoid(6)}`;
  const created_at = new Date(ts).toISOString();
  const source_ip = getClientIp(req);
  const lines = content.split('\n').length;
  const preview = content.slice(0, 300);

  const meta = { id, created_at, source_ip, size: sizeBytes, lines, preview };

  fs.writeFileSync(path.join(DATA_DIR, `${id}.txt`), content, 'utf8');
  fs.writeFileSync(path.join(DATA_DIR, `${id}.meta`), JSON.stringify(meta), 'utf8');

  enforceLimit();

  return res.status(201).json({
    id,
    created_at,
    url: `/api/clips/${id}/raw`,
    size: sizeBytes,
    lines,
  });
});

/**
 * GET /api/clips
 * Query params: page (default 1), limit (default 20, max 50)
 */
app.get('/api/clips', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit ?? '20', 10)));

  const clips = getAllClips();
  const total = clips.length;
  const items = clips.slice((page - 1) * limit, page * limit);

  return res.json({
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
    clips: items,
  });
});

/**
 * GET /api/clips/stats
 * Returns aggregate stats for the header badge.
 */
app.get('/api/clips/stats', (req, res) => {
  const clips = getAllClips();
  const totalSize = clips.reduce((acc, c) => acc + (c.size ?? 0), 0);
  return res.json({ total: clips.length, totalSize, maxClips: MAX_CLIPS });
});

/**
 * GET /api/clips/search?q=<query>
 * Uses grep for fast file-based full-text search.
 */
app.get('/api/clips/search', (req, res) => {
  const q = (req.query.q ?? '').trim();
  if (!q) return res.json({ results: [], query: '', total: 0 });

  // grep: -r recursive, -l list filenames only, -i case-insensitive
  execFile(
    'grep',
    ['-rl', '-i', '--include=*.txt', q, DATA_DIR],
    { maxBuffer: 4 * 1024 * 1024 },
    (err, stdout) => {
      // exit code 1 = no matches (not an error)
      if (err && err.code !== 1) {
        return res.status(500).json({ error: 'Search failed' });
      }

      const matchedIds = new Set(
        stdout.split('\n').filter(Boolean).map((f) => path.basename(f, '.txt')),
      );

      const results = getAllClips()
        .filter((c) => matchedIds.has(c.id))
        .map((c) => {
          const content = readContent(c.id) ?? '';
          const matchLine = content
            .split('\n')
            .find((l) => l.toLowerCase().includes(q.toLowerCase()));
          return { ...c, match_line: (matchLine ?? '').trim().slice(0, 300) };
        });

      return res.json({ results, query: q, total: results.length });
    },
  );
});

/**
 * GET /api/clips/latest/raw
 * Returns the most recent clip as plain text — useful for piping.
 * curl http://host:4040/api/clips/latest/raw | pbcopy
 */
app.get('/api/clips/latest/raw', (req, res) => {
  const clips = getAllClips();
  if (!clips.length) {
    return res.status(404).type('text/plain').send('No clips found\n');
  }
  const content = readContent(clips[0].id);
  if (!content) return res.status(404).type('text/plain').send('Not found\n');
  return res.type('text/plain').send(content);
});

/**
 * GET /api/clips/:id
 * Returns full clip JSON including content.
 */
app.get('/api/clips/:id', (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid ID' });

  const meta = readMeta(id);
  if (!meta) return res.status(404).json({ error: 'Not found' });

  const content = readContent(id) ?? '';
  return res.json({ ...meta, content });
});

/**
 * GET /api/clips/:id/raw
 * Returns clip as plain text — curl / pipe friendly.
 */
app.get('/api/clips/:id/raw', (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).type('text/plain').send('Invalid ID\n');

  const content = readContent(id);
  if (content === null) return res.status(404).type('text/plain').send('Not found\n');
  return res.type('text/plain').send(content);
});

/**
 * DELETE /api/clips/:id
 */
app.delete('/api/clips/:id', (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid ID' });

  const txtPath = path.join(DATA_DIR, `${id}.txt`);
  if (!fs.existsSync(txtPath)) return res.status(404).json({ error: 'Not found' });

  fs.unlinkSync(txtPath);
  try { fs.unlinkSync(path.join(DATA_DIR, `${id}.meta`)); } catch { /* ignore */ }

  return res.json({ success: true, id });
});

/** GET /health */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', clips: getAllClips().length, dataDir: DATA_DIR });
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`LanClip listening → http://0.0.0.0:${PORT}`);
  console.log(`Data: ${DATA_DIR} | Max clips: ${MAX_CLIPS} | Max size: ${MAX_SIZE_KB} KB`);
});
