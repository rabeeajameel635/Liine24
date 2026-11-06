// الزاوية: one cinematic reference per segment, with a short directing study of it (angle, masses, light, depth, rhythm),
// what we can learn, and what stays as decided. An analysis tool only: it never touches a shot, a prompt or a locked reference.
// The reference is a library «link» asset from الإلهام (someone else's work, no_generation = 1, rights internal), linked to the
// segment through inspo_link, so the storyboard, the sheet and the gallery's «قارن» all read the same row. Nothing is stored twice.
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DB } from './db.ts';

export const STUDY_KEYS = ['angle', 'masses', 'light', 'depth', 'rhythm'] as const;
export type StudyKey = typeof STUDY_KEYS[number];
export type Study = Partial<Record<StudyKey, string | null>> & { learn: string; keep: string };
export const EVIDENCE = { text: 'من نص المقال بس', image: 'من الصورة والنص', video: 'من الفيديو والنص' } as const;

export function migrateLens(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS study (
    segment_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    lens INTEGER NOT NULL DEFAULT 1,          -- the segment's chosen reference (one per segment)
    fields TEXT NOT NULL DEFAULT '{}',        -- {angle, masses, light, depth, rhythm, learn, keep}: Arabic, one line each, null = no evidence yet
    evidence TEXT NOT NULL DEFAULT 'text',    -- text | image | video: what the study was written from
    author TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (segment_id, asset_id)
  )`);
}

/** One Arabic line: no Latin words, no digits, at most `max` words. Empty / null means «no evidence yet». */
export const validStudyLine = (s: unknown, max = 14) => {
  if (s == null || s === '') return true;
  if (typeof s !== 'string') return false;
  const t = s.trim(), w = t.split(/\s+/).filter(Boolean);
  return /[؀-ۿ]/.test(t) && !/[a-z]{2,}/i.test(t) && !/[0-9٠-٩۰-۹]/.test(t) && w.length >= 2 && w.length <= max;
};

type Row = Record<string, unknown>;
const prov = (s: unknown) => { try { return JSON.parse(String(s || '{}')) as Record<string, unknown>; } catch { return {}; } };

/** The segment's lens, shaped for the sheet and the gallery: the reference (link, picture, credits, rights) and the study. */
export function lensOf(db: DB, segmentId: string) {
  const r = db.prepare(`SELECT s.*, a.label, a.thumb_path, a.remote_url, a.source_ref, a.provenance, a.no_generation FROM study s JOIN asset a ON a.id = s.asset_id
    WHERE s.segment_id = ? AND s.lens = 1 ORDER BY s.updated_at DESC LIMIT 1`).get(segmentId) as Row | undefined;
  if (!r) return null;
  const p = prov(r.provenance);
  return {
    asset_id: r.asset_id, label: r.label, thumb: r.thumb_path ? `/media/${r.asset_id}/thumb` : (r.remote_url as string | null),
    link: (p.link as string | undefined) ?? (r.source_ref as string | null), watch: (p.watch as string | null) ?? null,
    director: (p.director as string | null) ?? null, source: (p.source as string | null) ?? null,
    license: (p.license as string | null) ?? null, rights: (p.rights as string | undefined) ?? 'internal', no_generation: !!r.no_generation,
    study: JSON.parse(String(r.fields || '{}')) as Study, evidence: String(r.evidence), evidence_ar: EVIDENCE[r.evidence as keyof typeof EVIDENCE] ?? String(r.evidence),
    author: r.author, updated_at: r.updated_at
  };
}

/** A study as a file in the repo (projects/i-am-the-world/studies/<code>.json): written where the pictures can be seen,
 *  read on every machine. Keyed by the shot code and the reference's link, never by database ids. */
export type StudyFile = { code: string; reference: { link: string; item_id?: string | null; work: string | null; director: string | null; source: string | null; thumb_url: string | null; watch: string | null; license: string | null; rights: string; line?: string | null; category?: string | null };
  study: Study; evidence: string; author: string; updated_at: string };

export function exportLens(db: DB, segmentId: string, wantCode?: string): StudyFile | null {
  const l = lensOf(db, segmentId); if (!l?.link) return null;
  // the shot the study is about: ?code=H2, else the segment's first shot
  const code = (db.prepare('SELECT code FROM shot WHERE segment_id = ? AND (upper(code) = upper(?) OR ? IS NULL) ORDER BY start_s, idx LIMIT 1').get(segmentId, wantCode ?? '', wantCode ?? null) as { code?: string } | undefined)?.code;
  const p = prov((db.prepare('SELECT provenance FROM asset WHERE id = ?').get(String(l.asset_id)) as Row | undefined)?.provenance);
  const it = db.prepare('SELECT id, thumb_url FROM inspo_item WHERE link = ?').get(l.link) as { id: string; thumb_url: string | null } | undefined;
  return { code: code ?? '', reference: { link: l.link, item_id: it?.id ?? null, work: (l.label as string | null) ?? null, director: l.director, source: l.source, thumb_url: it?.thumb_url ?? null, watch: l.watch, license: l.license, rights: l.rights, line: (p.line as string | null) ?? null, category: (p.category as string | null) ?? null },
    study: l.study, evidence: l.evidence, author: String(l.author ?? ''), updated_at: String(l.updated_at) };
}

/** Load every studies/*.json: the reference becomes (or stays) a library link asset, and the study is upserted when the file is newer. Never touches shots. */
export async function seedStudies(db: DB, dir: string) {
  const files = await readdir(dir).catch(() => [] as string[]);
  for (const f of files.filter(x => x.endsWith('.json'))) {
    let sf: StudyFile; try { sf = JSON.parse(await readFile(join(dir, f), 'utf8')) as StudyFile; } catch { continue; }
    const seg = db.prepare('SELECT segment_id FROM shot WHERE upper(code) = upper(?) AND segment_id IS NOT NULL').get(sf.code) as { segment_id?: string } | undefined;
    if (!seg?.segment_id || !sf.reference?.link) continue;
    const r = sf.reference;
    let asset = db.prepare(`SELECT id FROM asset WHERE source_ref = ? OR json_extract(provenance, '$.link') = ?`).get(r.link, r.link) as { id: string } | undefined;
    const provenance = { tool: 'الإلهام', source: r.source, link: r.link, watch: r.watch, director: r.director, line: r.line ?? null, category: r.category ?? null, license: r.license ?? `ملك أصحابه · المصدر ${r.source ?? ''}`, rights: r.rights ?? 'internal' };
    if (!asset) {
      const id = randomUUID();
      db.prepare(`INSERT INTO asset (id, project_id, name, label, kind, remote_url, source, source_ref, provenance, no_generation, created_at) VALUES (?, 'iatw', ?, ?, 'link', ?, 'inspiration', ?, ?, 1, datetime('now'))`)
        .run(id, `${r.item_id ?? 'ref'}.jpg`, r.work, r.thumb_url, r.link, JSON.stringify(provenance));
      try { db.prepare('INSERT INTO asset_fts (asset_id, name, label, prompt, tags) VALUES (?,?,?,?,?)').run(id, r.item_id ?? '', r.work ?? '', '', `إلهام ${r.director ?? ''} ${r.line ?? ''}`); } catch { /* fts optional */ }
      asset = { id };
    }
    db.prepare('UPDATE asset SET no_generation = 1 WHERE id = ?').run(asset.id);
    db.prepare('UPDATE inspo_item SET asset_id = ? WHERE link = ? AND asset_id IS NULL').run(asset.id, r.link);
    const have = db.prepare('SELECT updated_at FROM study WHERE segment_id = ? AND asset_id = ?').get(seg.segment_id, asset.id) as { updated_at: string } | undefined;
    if (have && have.updated_at >= sf.updated_at) continue;
    db.prepare(`INSERT INTO study (segment_id, asset_id, lens, fields, evidence, author, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT (segment_id, asset_id) DO UPDATE SET lens = 1, fields = excluded.fields, evidence = excluded.evidence, author = excluded.author, updated_at = excluded.updated_at`)
      .run(seg.segment_id, asset.id, JSON.stringify(sf.study), ['text', 'image', 'video'].includes(sf.evidence) ? sf.evidence : 'text', String(sf.author ?? '').slice(0, 80), sf.updated_at);
    db.prepare('UPDATE study SET lens = 0 WHERE segment_id = ? AND asset_id <> ?').run(seg.segment_id, asset.id);
    db.prepare('INSERT OR IGNORE INTO inspo_link (segment_id, asset_id) VALUES (?, ?)').run(seg.segment_id, asset.id);
  }
}

export async function lensRoutes(app: FastifyInstance, db: DB, studiesDir?: string) {
  migrateLens(db);
  if (studiesDir) await seedStudies(db, studiesDir);
  // the study as a repo file: `curl .../lens/export > projects/i-am-the-world/studies/H2.json`, then commit; every machine seeds it at start
  app.get('/api/segments/:id/lens/export', async (req, reply) => { const x = exportLens(db, (req.params as { id: string }).id, (req.query as { code?: string }).code); return x ?? reply.code(404).send({ what: 'مفيش زاوية للمقطع ده' }); });

  app.get('/api/segments/:id/lens', async req => ({ lens: lensOf(db, (req.params as { id: string }).id) }));

  // Set / update the segment's lens. Writes the study table and the inspo_link row only.
  app.post('/api/segments/:id/lens', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { asset_id?: string; study?: Record<string, unknown>; evidence?: string; author?: string };
    if (!db.prepare('SELECT 1 FROM segment WHERE id = ?').get(id)) return reply.code(404).send({ what: 'المقطع مش موجود' });
    const a = db.prepare(`SELECT id, kind, no_generation, provenance FROM asset WHERE id = ?`).get(String(b.asset_id)) as Row | undefined;
    if (!a) return reply.code(404).send({ what: 'المرجع مش في المكتبة', fix: 'اعمل «خده مرجع» من الإلهام الأول.' });
    // only someone else's work from الإلهام: never a generation input, never a locked asset of ours
    if (a.kind !== 'link' && !prov(a.provenance).link) return reply.code(409).send({ what: 'الزاوية بتاخد مرجع من الإلهام بس' });
    if (!a.no_generation) return reply.code(409).send({ what: 'المرجع لازم يبقى «ممنوع كمرجع توليد»' });
    const st = b.study ?? {};
    for (const k of STUDY_KEYS) if (!validStudyLine(st[k])) return reply.code(400).send({ what: `سطر «${k}» خارج القاعدة`, fix: 'عربي، من غير أرقام ولا إنجليزي، لحد ١٤ كلمة.' });
    if (!validStudyLine(st.learn, 14) || !st.learn || !validStudyLine(st.keep, 20) || !st.keep) return reply.code(400).send({ what: 'سطرَي «نتعلم» و«بيفضل» لازمين', fix: 'عربي، «نتعلم» لحد ١٤ كلمة و«بيفضل» لحد ٢٠.' });
    const evidence = ['text', 'image', 'video'].includes(String(b.evidence)) ? String(b.evidence) : 'text';
    const fields: Study = { learn: String(st.learn).trim(), keep: String(st.keep).trim() };
    for (const k of STUDY_KEYS) fields[k] = st[k] ? String(st[k]).trim() : null;
    db.prepare(`INSERT INTO study (segment_id, asset_id, lens, fields, evidence, author) VALUES (?, ?, 1, ?, ?, ?)
      ON CONFLICT (segment_id, asset_id) DO UPDATE SET lens = 1, fields = excluded.fields, evidence = excluded.evidence, author = excluded.author, updated_at = datetime('now')`)
      .run(id, String(a.id), JSON.stringify(fields), evidence, String(b.author ?? '').slice(0, 80));
    db.prepare('UPDATE study SET lens = 0 WHERE segment_id = ? AND asset_id <> ?').run(id, String(a.id));
    db.prepare('INSERT OR IGNORE INTO inspo_link (segment_id, asset_id) VALUES (?, ?)').run(id, String(a.id)); // so the storyboard shows it too
    return { lens: lensOf(db, id) };
  });

  // What the Mac's study script needs, read-only: the shot's locked answers, the segment's prompt, and the candidate references
  app.get('/api/segments/:id/lens/brief', async (req, reply) => {
    const { id } = req.params as { id: string };
    const g = db.prepare('SELECT id, label, lyric, prompt_partial, direction FROM segment WHERE id = ?').get(id) as Row | undefined;
    if (!g) return reply.code(404).send({ what: 'المقطع مش موجود' });
    const shots = db.prepare('SELECT code, title, prompt, answers FROM shot WHERE segment_id = ? ORDER BY start_s, idx').all(id) as Row[];
    const linked = db.prepare(`SELECT a.id AS asset_id, a.label, a.thumb_path, a.provenance, i.id AS item_id, i.excerpt, i.line, i.category, i.score
      FROM inspo_link l JOIN asset a ON a.id = l.asset_id LEFT JOIN inspo_item i ON i.asset_id = a.id WHERE l.segment_id = ?`).all(id) as Row[];
    const candidates = db.prepare(`SELECT id AS item_id, asset_id, work, director, source, thumb_path, line, category, score, excerpt FROM inspo_item WHERE line IS NOT NULL ORDER BY score DESC LIMIT 12`).all() as Row[];
    return { segment: { ...g }, shots: shots.map(s => ({ ...s, answers: JSON.parse(String(s.answers || '[]')) })), linked: linked.map(r => ({ ...r, provenance: prov(r.provenance) })), candidates };
  });
}
