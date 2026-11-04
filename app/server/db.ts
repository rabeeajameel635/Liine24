// Database: node:sqlite (built into Node, no native build on M1) with FTS5 for keyword search.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS brand (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,          -- LIINE24
  line TEXT NOT NULL,          -- OUT OF LINE
  -- names that must never appear in this brand's lyrics/titles/descriptions/metadata
  forbidden_terms TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brand(id),
  title TEXT NOT NULL,
  cadence_days INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS song (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id),
  title TEXT NOT NULL,
  bpm REAL,
  bpm_source TEXT,             -- measured | manual | imported
  bpm_approved INTEGER NOT NULL DEFAULT 0,
  sections TEXT NOT NULL DEFAULT '[]',   -- [{name,start}]
  bars TEXT NOT NULL DEFAULT '{}',       -- {offset, beats_per_bar}
  versions TEXT NOT NULL DEFAULT '[]'    -- [{label, asset_id}]
);

CREATE TABLE IF NOT EXISTS character (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brand(id),
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  refs TEXT NOT NULL DEFAULT '[]',        -- up to 20 asset ids / remote refs
  locked_text TEXT NOT NULL DEFAULT '',
  wardrobe TEXT NOT NULL DEFAULT '{}',    -- {looks:[], constants:[], hex:[]}
  voice TEXT,
  forbidden TEXT NOT NULL DEFAULT '[]',
  modesty TEXT NOT NULL DEFAULT '',
  identity_baseline REAL,                 -- mean pairwise similarity of approved images (= 100%)
  identity_threshold REAL NOT NULL DEFAULT 0.95  -- fraction of baseline
);

-- wardrobe colours measured from the piece itself (a box inside a reference image); a suggestion until approved
CREATE TABLE IF NOT EXISTS wardrobe_piece (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES character(id),
  name TEXT NOT NULL,
  asset_ref TEXT NOT NULL,      -- source_ref prefix of the reference image
  box TEXT NOT NULL,            -- {x,y,w,h} as fractions of the image
  mode TEXT NOT NULL DEFAULT 'all', -- all | red (only saturated crimson pixels)
  hex TEXT,                     -- measured colours, JSON array
  approved_at TEXT
);

-- لوحة المقاطع: a song is cut into segments on whole bars; every edit is versioned (undo)
CREATE TABLE IF NOT EXISTS segment (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES song(id),
  idx INTEGER NOT NULL,
  start_s REAL NOT NULL, end_s REAL NOT NULL,
  label TEXT, group_label TEXT,
  lyric TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','ready','generating','done','editing')),
  direction TEXT NOT NULL DEFAULT '',     -- what happens (from the director's map)
  prompt_partial TEXT NOT NULL DEFAULT '',
  tool TEXT NOT NULL DEFAULT 'higgsfield-kling',
  backup TEXT NOT NULL DEFAULT '{}',      -- {tool, direction, prompt_partial}: same strength, easier for the generator
  refs TEXT NOT NULL DEFAULT '[]',        -- ordered asset ids = send order
  video_asset_id TEXT,
  kit_code TEXT, kit_path TEXT,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS segment_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  snapshot TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shot (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id),
  idx INTEGER NOT NULL,
  label TEXT,
  bars REAL,
  start_s REAL,
  primary_plan TEXT NOT NULL DEFAULT '{}',
  backup_plan TEXT NOT NULL DEFAULT '{}',  -- same strength, easier for the generator
  kit TEXT NOT NULL DEFAULT '[]',
  is_lip_sync INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS job (
  id TEXT PRIMARY KEY,
  generator TEXT NOT NULL,       -- higgsfield | suno | runway | grok | flow | wan | gemini
  mode TEXT NOT NULL CHECK (mode IN ('api','mcp','bridge')),
  idempotency_key TEXT NOT NULL UNIQUE,
  cost_quote REAL,
  cost_cap REAL NOT NULL,
  state TEXT NOT NULL DEFAULT 'quoted', -- quoted|approved|submitted|running|fetched|failed|cancelled
  step TEXT,                     -- last completed step, resume point
  payload TEXT NOT NULL DEFAULT '{}',
  result TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS asset (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES project(id),
  name TEXT NOT NULL,            -- original file name (shown in the inspector only)
  label TEXT,                    -- short human label: «Departure»، «الجزمة»
  sha256 TEXT UNIQUE,
  kind TEXT NOT NULL,            -- video | image | audio | doc
  width INTEGER, height INTEGER, duration REAL,         -- of the original
  original_path TEXT,            -- untouched original, always kept
  work_path TEXT,                -- capped working copy (video ≤1080p, image ≤2K); = original when already within cap
  thumb_path TEXT,
  remote_url TEXT,               -- when the bytes could not be fetched yet
  source TEXT NOT NULL DEFAULT 'drop',  -- drop | watch | higgsfield
  source_ref TEXT,               -- e.g. higgsfield media id
  folder TEXT,                   -- source folder name
  provenance TEXT NOT NULL DEFAULT '{}', -- {tool, model, prompt, seed, version, license, refs_sent, job_id}
  shot_id TEXT, song_id TEXT, character_id TEXT,
  role TEXT,                     -- primary | backup | reference | look | sheet
  favorite INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,       -- locked reference
  face_check TEXT NOT NULL DEFAULT 'pending', -- pending | pass | warn (needs the commercial face model)
  face_score REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),  -- when the source made it
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE VIRTUAL TABLE IF NOT EXISTS asset_fts USING fts5(asset_id UNINDEXED, name, label, prompt, tags);
-- semantic search is designed now, filled later
CREATE TABLE IF NOT EXISTS asset_embedding (
  asset_id TEXT NOT NULL REFERENCES asset(id),
  model TEXT NOT NULL,
  vector BLOB NOT NULL,
  PRIMARY KEY (asset_id, model)
);

CREATE TABLE IF NOT EXISTS "check" (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('pass','warn','stop')),
  detail TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS approval (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (subject_type, subject_id, stage)
);

CREATE TABLE IF NOT EXISTS release (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id),
  platform TEXT NOT NULL,
  package TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS skill (
  id TEXT PRIMARY KEY,
  file TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
`;

// additive migrations for databases created by earlier steps
const COLUMNS: [string, string][] = [
  ['song', 'audio_asset_id TEXT'], ['song', 'srt TEXT'], ['song', 'duration REAL'], ['song', 'beat_offset REAL'],
  ['song', 'beats_per_bar INTEGER NOT NULL DEFAULT 4'], ['song', 'segment_seconds REAL NOT NULL DEFAULT 15'],
  ['asset', 'warn TEXT'], ['asset', 'no_generation INTEGER NOT NULL DEFAULT 0'], ['asset', 'face_baseline INTEGER NOT NULL DEFAULT 0'],
  ['song', 'poster_asset_id TEXT'], ['song', 'plan_note TEXT'], ['segment', 'draft INTEGER NOT NULL DEFAULT 0'], ['song', 'bpm_candidates TEXT'], ['song', 'created_at TEXT']
];

export function openDb(path: string): DB {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  for (const [t, col] of COLUMNS) { try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${col}`); } catch { /* already there */ } }
  seed(db);
  return db;
}

function seed(db: DB) {
  const has = db.prepare('SELECT count(*) AS n FROM brand').get() as { n: number };
  if (has.n > 0) return;
  const ins = db.prepare('INSERT INTO brand (id, name, line, forbidden_terms) VALUES (?, ?, ?, ?)');
  // Each brand forbids the other brand's names.
  ins.run('liine24', 'LIINE24', 'OUT OF LINE', JSON.stringify(['BE SULTAN', 'OUT OF FOCUS']));
  ins.run('be-sultan', 'BE SULTAN', 'OUT OF FOCUS', JSON.stringify(['LIINE24', 'LIINE 24', 'OUT OF LINE']));
  db.prepare('INSERT INTO project (id, brand_id, title) VALUES (?, ?, ?)').run('iatw', 'liine24', 'I Am The World');
}

/** Server-side gate: nothing advances without the user's «اعتمد». */
export function isApproved(db: DB, subjectType: string, subjectId: string, stage: string): boolean {
  return !!db.prepare('SELECT 1 FROM approval WHERE subject_type = ? AND subject_id = ? AND stage = ?').get(subjectType, subjectId, stage);
}
export class NotApprovedError extends Error {
  stage: string;
  constructor(stage: string) { super(`المرحلة «${stage}» محتاجة «اعتمد» الأول`); this.stage = stage; }
}
export function requireApproval(db: DB, subjectType: string, subjectId: string, stage: string): void {
  if (!isApproved(db, subjectType, subjectId, stage)) throw new NotApprovedError(stage);
}
