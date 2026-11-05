// المرجع مرة واحدة (@): every picture, video or sound in the library has a short Arabic handle (@دنيا، @الممر، @اللوفر،
// @لوحة-الرحيل). Write @handle in a segment's prompt and it is turned into what each generator needs, in the order it reads.
//
// Constants come in two levels: «ثابت للفيلم كله» (the character and her fixed props) and «ثابت للمكان» (corridor, tower, room).
// A handle never changes in place: any edit is a new version, the old one is kept, and generation uses the APPROVED version only.
import type { FastifyInstance } from 'fastify';
import type { DB } from './db.ts';

export type Scope = 'film' | 'place' | 'asset';
export type Kind = 'character' | 'prop' | 'place' | 'image' | 'video' | 'audio';
type RefRow = { handle: string; scope: Scope; kind: Kind; title_ar: string; current_version: number; approved_version: number | null; project_id: string };
type VerRow = { handle: string; version: number; assets: string; text_en: string | null; name_en: string | null; note_ar: string | null; element_id: string | null; created_at: string; approved_at: string | null };

/** Higgsfield elements that must never be sent (the old «Donia» element has a different face). */
export const FORBIDDEN_ELEMENTS = new Set(['4c0ad5c2-7af7-4c67-8ada-59e090a349fc']);

export const HANDLE_RE = /^[\p{Script=Arabic}A-Za-z0-9-]{2,24}$/u;
const KIND_ORDER: Record<Kind, number> = { character: 0, prop: 1, place: 2, image: 3, video: 4, audio: 5 };

export function migrateRefs(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS ref (handle TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK (scope IN ('film','place','asset')), kind TEXT NOT NULL,
    title_ar TEXT NOT NULL, current_version INTEGER NOT NULL DEFAULT 1, approved_version INTEGER, project_id TEXT NOT NULL DEFAULT 'iatw', created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS ref_version (handle TEXT NOT NULL REFERENCES ref(handle), version INTEGER NOT NULL, assets TEXT NOT NULL DEFAULT '[]',
    text_en TEXT, name_en TEXT, note_ar TEXT, element_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), approved_at TEXT, PRIMARY KEY (handle, version))`);
  // a version, once written, is never rewritten: only its approval time may be set, once
  db.exec(`CREATE TRIGGER IF NOT EXISTS ref_version_frozen BEFORE UPDATE ON ref_version
    WHEN NEW.assets IS NOT OLD.assets OR NEW.text_en IS NOT OLD.text_en OR NEW.name_en IS NOT OLD.name_en OR NEW.element_id IS NOT OLD.element_id OR NEW.note_ar IS NOT OLD.note_ar
      OR (OLD.approved_at IS NOT NULL AND NEW.approved_at IS NOT OLD.approved_at)
    BEGIN SELECT RAISE(ABORT, 'نسخة المرجع ما بتتعدلش: اعمل نسخة جديدة'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS ref_version_keep BEFORE DELETE ON ref_version BEGIN SELECT RAISE(ABORT, 'النسخ القديمة محفوظة'); END`);
}

type NewVersion = { assets?: string[]; text_en?: string | null; name_en?: string | null; note_ar?: string | null; element_id?: string | null };

export function createRef(db: DB, r: { handle: string; scope: Scope; kind: Kind; title_ar: string } & NewVersion, approve = false) {
  if (!HANDLE_RE.test(r.handle)) throw new Error('الاسم المختصر لازم يبقى كلمة واحدة (حروف وأرقام و-)');
  if (r.element_id && FORBIDDEN_ELEMENTS.has(r.element_id)) throw new Error('العنصر ده ممنوع (وش تاني)');
  db.prepare(`INSERT INTO ref (handle, scope, kind, title_ar, current_version, approved_version) VALUES (?, ?, ?, ?, 1, ?)`).run(r.handle, r.scope, r.kind, r.title_ar, approve ? 1 : null);
  db.prepare(`INSERT INTO ref_version (handle, version, assets, text_en, name_en, note_ar, element_id, approved_at) VALUES (?, 1, ?, ?, ?, ?, ?, ${approve ? "datetime('now')" : 'NULL'})`)
    .run(r.handle, JSON.stringify(r.assets ?? []), r.text_en ?? null, r.name_en ?? null, r.note_ar ?? null, r.element_id ?? null);
}

/** Any change = a new version. The approved one stays in use until the new one is approved. */
export function newVersion(db: DB, handle: string, v: NewVersion) {
  const r = db.prepare('SELECT * FROM ref WHERE handle = ?').get(handle) as RefRow | undefined; if (!r) throw new Error('مش موجود');
  if (v.element_id && FORBIDDEN_ELEMENTS.has(v.element_id)) throw new Error('العنصر ده ممنوع (وش تاني)');
  const cur = db.prepare('SELECT * FROM ref_version WHERE handle = ? AND version = ?').get(handle, r.current_version) as VerRow;
  const n = r.current_version + 1;
  db.prepare(`INSERT INTO ref_version (handle, version, assets, text_en, name_en, note_ar, element_id) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(handle, n,
    JSON.stringify(v.assets ?? JSON.parse(cur.assets)), v.text_en !== undefined ? v.text_en : cur.text_en, v.name_en !== undefined ? v.name_en : cur.name_en,
    v.note_ar !== undefined ? v.note_ar : cur.note_ar, v.element_id !== undefined ? v.element_id : cur.element_id);
  db.prepare('UPDATE ref SET current_version = ? WHERE handle = ?').run(n, handle);
  return n;
}

export function approveVersion(db: DB, handle: string, version: number) {
  const v = db.prepare('SELECT * FROM ref_version WHERE handle = ? AND version = ?').get(handle, version) as VerRow | undefined; if (!v) throw new Error('النسخة مش موجودة');
  if (!v.approved_at) db.prepare(`UPDATE ref_version SET approved_at = datetime('now') WHERE handle = ? AND version = ?`).run(handle, version);
  db.prepare('UPDATE ref SET approved_version = ? WHERE handle = ?').run(version, handle);
}

/** Short Arabic handle from a label: «الشعر والمشبك «سِرّ»» → الشعر-والمشبك-سِرّ */
export const bare = (s: string) => s.normalize('NFC').replace(/[\u064B-\u065F\u0670\u0640]/g, ''); // no tashkeel or tatweel in handles
export const slug = (s: string) => bare(s).replace(/[«»"'‘’“”()[\]{}.,:;!?؟،·]/g, ' ').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 24).replace(/-$/, '');

/** Every library picture/video/sound gets a handle (asset scope) the first time we see it. */
export function ensureAssetHandles(db: DB) {
  const rows = db.prepare(`SELECT a.id, a.label, a.kind, EXISTS (SELECT 1 FROM approval p WHERE p.subject_type = 'asset' AND p.subject_id = a.id) AS approved_flag FROM asset a
    WHERE a.kind IN ('image','video','audio')
      AND NOT EXISTS (SELECT 1 FROM ref r JOIN ref_version v ON v.handle = r.handle WHERE r.scope = 'asset' AND v.assets = json_array(a.id))`).all() as { id: string; label: string | null; kind: Kind; approved_flag: number }[];
  for (const a of rows) {
    let base = a.label && /[؀-ۿ]/.test(a.label) ? slug(a.label) : `${a.kind === 'video' ? 'فيديو' : a.kind === 'audio' ? 'صوت' : 'صورة'}-${a.id.slice(0, 4)}`;
    if (!HANDLE_RE.test(base)) base = `صورة-${a.id.slice(0, 4)}`;
    let h = base, i = 2; while (db.prepare('SELECT 1 FROM ref WHERE handle = ?').get(h)) h = `${base}-${i++}`;
    createRef(db, { handle: h, scope: 'asset', kind: a.kind, title_ar: a.label ?? h, assets: [a.id] }, !!a.approved_flag);
  }
}

// ---------- resolving @ in a prompt, per generator ----------
export type Family = 'bridge' | 'higgsfield' | 'runway';
export const familyOf = (toolKey: string, mode: string): Family => toolKey.startsWith('higgsfield') ? 'higgsfield' : toolKey === 'runway' ? 'runway' : mode === 'bridge' ? 'bridge' : 'runway';
/** Higgsfield models that take an element placeholder <<<id>>> (from the Higgsfield MCP tool description, 5 Nov). */
const ELEMENT_MODELS: Record<string, { model: string; needsStart?: boolean } | null> = {
  'higgsfield-seedance': { model: 'seedance_2_0' }, 'higgsfield-kling': { model: 'kling3_0', needsStart: true }, 'higgsfield-minimax': null
};

export type Resolved = {
  handle: string; scope: Scope; kind: Kind; title_ar: string; version: number | null; pending: boolean;
  images: { id: string; label: string | null; thumb: string | null; work_path: string | null; hf_id: string | null; n: number }[];
  blocked: { id: string; label: string | null }[]; text_en: string | null; name_en: string | null; element_id: string | null;
  how: string; warn: string[];
};
export type Resolution = { tool: string; family: Family; refs: Resolved[]; unknown: string[]; prompt_out: string; files: { n: number; asset: string; label: string | null }[];
  medias: { value: string; role: string }[]; problems: string[]; notes: string[] };

const MENTION = /@([\p{Script=Arabic}\p{M}A-Za-z0-9-]{2,24})/gu;

export function resolvePrompt(db: DB, prompt: string, toolKey: string, mode: string): Resolution {
  const family = familyOf(toolKey, mode);
  const seen: string[] = []; const unknown: string[] = [];
  for (const m of prompt.matchAll(MENTION)) {
    const h = bare(m[1]).replace(/-+$/, ''); // Arabic punctuation (، .) already ends the handle; tashkeel is ignored
    if (!db.prepare('SELECT 1 FROM ref WHERE handle = ?').get(h)) { if (!unknown.includes(h)) unknown.push(h); continue; }
    if (!seen.includes(h)) seen.push(h);
  }
  const refs: Resolved[] = seen.map(h => {
    const r = db.prepare('SELECT * FROM ref WHERE handle = ?').get(h) as RefRow;
    const ver = r.approved_version ?? r.current_version;
    const v = db.prepare('SELECT * FROM ref_version WHERE handle = ? AND version = ?').get(h, ver) as VerRow;
    const ids = JSON.parse(v.assets) as string[];
    const rows = ids.map(id => db.prepare('SELECT id, label, kind, work_path, thumb_path, remote_url, no_generation, source, source_ref FROM asset WHERE id = ?').get(id) as Record<string, string | number | null> | undefined).filter(Boolean) as Record<string, string | number | null>[];
    const ok = rows.filter(a => !a.no_generation && a.kind !== 'link');
    const warn: string[] = [];
    if (r.approved_version == null) warn.push('مستني اعتمادك');
    else if (r.current_version !== r.approved_version) warn.push(`فيه نسخة ${r.current_version} مستنية اعتمادك · بنستخدم ${r.approved_version}`);
    const blocked = rows.filter(a => a.no_generation || a.kind === 'link').map(a => ({ id: String(a.id), label: a.label as string | null }));
    if (!ok.length && blocked.length && !v.text_en && !v.element_id) warn.push('ممنوع كمرجع توليد');
    else if (!ok.length && !v.text_en && !v.element_id) warn.push('ناقص وصف وصورة');
    if (v.element_id && FORBIDDEN_ELEMENTS.has(v.element_id)) warn.push('العنصر ممنوع');
    return { handle: h, scope: r.scope, kind: r.kind, title_ar: r.title_ar, version: r.approved_version, pending: r.approved_version == null,
      images: ok.map(a => ({ id: String(a.id), label: a.label as string | null, thumb: a.thumb_path ? `/media/${a.id}/thumb` : (a.remote_url as string | null), work_path: a.work_path as string | null,
        hf_id: a.source === 'higgsfield' ? (a.source_ref as string) : null, n: 0 })),
      blocked, text_en: v.text_en, name_en: v.name_en, element_id: v.element_id, how: '', warn };
  });
  // order the generator reads best: the character first, then her props, then places, then other pictures; ties keep the order you wrote them
  refs.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || seen.indexOf(a.handle) - seen.indexOf(b.handle));

  const files: Resolution['files'] = []; const medias: Resolution['medias'] = []; const problems: string[] = []; const notes: string[] = [];
  const em = ELEMENT_MODELS[toolKey];
  let n = 0;
  const token = new Map<string, string>();
  for (const r of refs) {
    const name = r.name_en ?? r.title_ar;
    const useElement = family === 'higgsfield' && !!r.element_id && !!em && !FORBIDDEN_ELEMENTS.has(r.element_id);
    if (useElement) {
      token.set(r.handle, `<<<${r.element_id}>>>`); r.how = 'عنصر Donia-Final على Higgsfield';
      if (em!.needsStart) notes.push('Kling 3.0 محتاج صورة بداية عشان العنصر يشتغل');
    } else if (r.images.length && family !== 'runway') {
      const from = n + 1; for (const im of r.images) { im.n = ++n; files.push({ n: im.n, asset: im.id, label: im.label });
        if (family === 'higgsfield') { if (im.hf_id) medias.push({ value: im.hf_id, role: 'image' }); else notes.push(`${im.label ?? 'صورة'} هتترفع على Higgsfield وقت الإرسال`); } }
      const span = from === n ? `image ${from}` : `images ${from}–${n}`;
      token.set(r.handle, `${name} (${span})`); r.how = from === n ? `الصورة ${from}` : `الصور ${from}–${n}`;
    } else if (r.images.length && family === 'runway') {
      token.set(r.handle, name); r.how = 'صيغة Runway بتتأكد بعد تسجيل الدخول';
    } else { token.set(r.handle, name); r.how = r.text_en ? 'وصف بس' : 'ناقص'; }
    if (r.text_en && !useElement) r.how += r.images.length ? ' + وصف' : '';
    if (r.pending) problems.push(`@${r.handle} مستني اعتمادك`);
    if (r.warn.includes('ناقص وصف وصورة')) problems.push(`@${r.handle} ناقص وصف وصورة`);
    if (r.warn.includes('ممنوع كمرجع توليد')) problems.push(`@${r.handle} ممنوع كمرجع توليد`);
  }
  for (const u of unknown) problems.push(`@${u} مش معروف`);
  if (family === 'higgsfield' && medias.length) notes.push('نوع كل صورة بيتحدد من Higgsfield وقت الإرسال');
  if (family === 'runway' && refs.length) notes.push('صيغة المراجع في Runway بتتأكد من الأداة نفسها بعد تسجيل الدخول على الماك');

  // the prompt the generator gets: constants' fixed text first (character, props, place), then your words with @ replaced
  const body = prompt.replace(MENTION, (m, h: string) => token.get(bare(h).replace(/-+$/, '')) ?? m);
  const fixed = refs.filter(r => r.text_en).map(r => r.text_en!.trim());
  return { tool: toolKey, family, refs, unknown, prompt_out: [...fixed, body.trim()].filter(Boolean).join('\n\n'), files, medias, problems, notes };
}

// ---------- seed: the constants already decided for I Am The World ----------
export function seedRefs(db: DB) {
  migrateRefs(db);
  const id = (label: string) => (db.prepare('SELECT id FROM asset WHERE label = ?').get(label) as { id?: string } | undefined)?.id;
  const card = db.prepare(`SELECT locked_text FROM character WHERE id = 'donia'`).get() as { locked_text?: string } | undefined;
  const make = (r: Parameters<typeof createRef>[1], approve: boolean) => { if (!db.prepare('SELECT 1 FROM ref WHERE handle = ?').get(r.handle)) createRef(db, r, approve); };
  // film constants
  make({ handle: 'دنيا', scope: 'film', kind: 'character', title_ar: 'دنيا', name_en: 'Donia', text_en: card?.locked_text ?? null,
    assets: [id('وش دنيا A · من غير حلق'), id('وش دنيا B · زاوية تانية')].filter(Boolean) as string[], element_id: '84b9e386-8647-4d78-9671-c1fd3079a616',
    note_ar: 'Donia-Final. وش A الأصل خط أساس للمقارنة بس (فيه حلق) فمش بيتبعت.' }, true);
  make({ handle: 'اللوفر', scope: 'film', kind: 'prop', title_ar: 'اللوفر الأبيض', name_en: 'the white loafers', text_en: 'Exactly the same white loafers as the loafer reference.', assets: [id('الجزمة')].filter(Boolean) as string[] }, true);
  make({ handle: 'المشبك', scope: 'film', kind: 'prop', title_ar: 'مشبك «سِرّ»', name_en: 'the crimson «سِرّ» claw clip', text_en: 'The crimson velvet «سِرّ» claw clip in her hair, exactly as the clip reference.', assets: [id('الشعر والمشبك «سِرّ»')].filter(Boolean) as string[] }, true);
  // places (only what is decided; the rest waits for a description and a picture)
  make({ handle: 'الممر', scope: 'place', kind: 'place', title_ar: 'الممر', name_en: 'the corridor',
    text_en: 'Location — the corridor: wide but oppressive, walls of light-grey and dark-grey concrete blocks laid in a random rhythm, black carpet with a single 12 cm crimson line running its length. Light: cold, soft and simple, coming from the left; never warm, never amber.',
    note_ar: 'من قرارات H2 المعتمدة (٤ نوفمبر). لسه ملوش صورة مرجع.' }, true);
  make({ handle: 'البرج', scope: 'place', kind: 'place', title_ar: 'البرج', name_en: 'the tower', note_ar: 'ناقص وصف وصورة (H7 وTW1 وTW2).' }, false);
  make({ handle: 'الغرفة', scope: 'place', kind: 'place', title_ar: 'الغرفة', name_en: 'the bedroom', note_ar: 'ناقص وصف وصورة (B1).' }, false);
  // explicit names for pictures we already talk about
  const named: [string, string, string][] = [['لوحة-الرحيل', 'العُقدة (لوحة الرحيل)', 'the painting «The Knot»'], ['لوحة-الشهرة', 'الانفصال (لوحة الشهرة)', 'the painting «The Separation»'],
    ['لوحة-الحب', 'بعد المطر (لوحة الحب)', 'the painting «After the Rain»'], ['الجاكيت', 'الجاكيت', 'the jacket'], ['شيت-اللبس', 'DONIA_WARDROBE_LOCK_v2', 'the wardrobe sheet'],
    ['لوك-الرحيل', 'Departure', 'the Departure look'], ['لوك-الشهرة', 'Fame', 'the Fame look'], ['لوك-الحب', 'Love v2', 'the Love look'],
    ['وش-خط-الأساس', 'وش دنيا A · خط الأساس', "Donia's face (baseline)"], ['وش-B', 'وش دنيا B · زاوية تانية', "Donia's face, second angle"], ['وش-من-غير-حلق', 'وش دنيا A · من غير حلق', "Donia's face"]];
  for (const [h, label, en] of named) {
    const a = id(label); if (!a) continue;
    const approved = !!db.prepare(`SELECT 1 FROM approval WHERE subject_type = 'asset' AND subject_id = ?`).get(a);
    make({ handle: h, scope: 'asset', kind: 'image', title_ar: label, name_en: en, assets: [a] }, approved);
  }
  ensureAssetHandles(db);
}

// ---------- routes ----------
export async function refRoutes(app: FastifyInstance, db: DB, tools: Record<string, { mode: string }>) {
  seedRefs(db);
  const view = (r: RefRow) => {
    const ver = (n: number | null) => n == null ? null : db.prepare('SELECT * FROM ref_version WHERE handle = ? AND version = ?').get(r.handle, n) as VerRow;
    const use = ver(r.approved_version ?? r.current_version)!;
    const ids = JSON.parse(use.assets) as string[];
    const thumbs = ids.map(id => db.prepare('SELECT id, thumb_path, remote_url, no_generation FROM asset WHERE id = ?').get(id) as Record<string, string | number | null> | undefined).filter(Boolean)
      .map(a => ({ id: a!.id, thumb: a!.thumb_path ? `/media/${a!.id}/thumb` : a!.remote_url, blocked: !!a!.no_generation }));
    return { ...r, locked: r.approved_version != null, pending_version: r.current_version !== r.approved_version ? r.current_version : null, assets: thumbs,
      text_en: use.text_en, name_en: use.name_en, note_ar: use.note_ar, element_id: use.element_id };
  };
  app.get('/api/refs', async req => {
    ensureAssetHandles(db);
    const { scope } = req.query as { scope?: string };
    const rows = db.prepare(`SELECT * FROM ref ${scope ? 'WHERE scope = ?' : ''} ORDER BY CASE scope WHEN 'film' THEN 0 WHEN 'place' THEN 1 ELSE 2 END, created_at`).all(...(scope ? [scope] : [])) as RefRow[];
    return { refs: rows.map(view) };
  });
  app.get('/api/refs/:handle', async (req, reply) => {
    const r = db.prepare('SELECT * FROM ref WHERE handle = ?').get((req.params as { handle: string }).handle) as RefRow | undefined; if (!r) return reply.code(404).send({ what: 'مش موجود' });
    const versions = db.prepare('SELECT * FROM ref_version WHERE handle = ? ORDER BY version DESC').all(r.handle) as VerRow[];
    return { ...view(r), versions: versions.map(v => ({ ...v, assets: JSON.parse(v.assets) })) };
  });
  app.post('/api/refs', async (req, reply) => {
    const b = req.body as { handle: string; scope: Scope; kind: Kind; title_ar: string } & NewVersion;
    if (db.prepare('SELECT 1 FROM ref WHERE handle = ?').get(b.handle)) return reply.code(409).send({ what: `@${b.handle} موجود قبل كده` });
    try { createRef(db, b, false); } catch (e) { return reply.code(400).send({ what: (e as Error).message }); }
    return { ok: true };
  });
  app.post('/api/refs/:handle/versions', async (req, reply) => {
    try { return { version: newVersion(db, (req.params as { handle: string }).handle, req.body as NewVersion) }; } catch (e) { return reply.code(400).send({ what: (e as Error).message }); }
  });
  // «اعتمد» from the UI only
  app.post('/api/refs/:handle/approve', async (req, reply) => {
    const { handle } = req.params as { handle: string }; const { version } = req.body as { version: number };
    try { approveVersion(db, handle, version); return { ok: true }; } catch (e) { return reply.code(400).send({ what: (e as Error).message }); }
  });
  app.post('/api/refs/resolve', async (req, reply) => {
    const { prompt, tool } = req.body as { prompt: string; tool: string };
    const t = tools[tool]; if (!t) return reply.code(400).send({ what: 'أداة مش معروفة' });
    return resolvePrompt(db, prompt ?? '', tool, t.mode);
  });
  app.get('/api/refs/by-asset/:id', async req => {
    const rows = db.prepare(`SELECT r.handle, r.scope FROM ref r JOIN ref_version v ON v.handle = r.handle AND v.version = COALESCE(r.approved_version, r.current_version)
      WHERE EXISTS (SELECT 1 FROM json_each(v.assets) j WHERE j.value = ?) ORDER BY CASE r.scope WHEN 'asset' THEN 0 ELSE 1 END`).all((req.params as { id: string }).id);
    return { handles: rows };
  });
}

/** Is Donia in this segment? A word list over its description, lyric and shots (titles, answers, notes). Returns the word that matched. */
const DONIA_WORDS = ['دنيا', 'donia', 'وهي', 'هي ', 'سيلويت', 'ضهرها', 'وشها', 'عيونها', 'العيون', 'دموع', 'تحضن', 'إيدها', 'ايدها', 'شعرها', 'الكعكة', 'الروب', 'الهود', 'قاعدة', 'تقوم', 'بتمشي', 'بتعيط', 'لبسها', 'silhouette', ' her '];
export function doniaHint(texts: (string | null | undefined)[]): string | null {
  const all = ' ' + texts.filter(Boolean).join(' \n ').toLowerCase() + ' ';
  for (const w of DONIA_WORDS) if (all.includes(w)) return w.trim();
  return null;
}
