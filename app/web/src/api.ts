export type Asset = {
  id: string; name: string; label: string | null; kind: 'image' | 'video' | 'audio' | 'doc';
  width: number | null; height: number | null; duration: number | null;
  thumb: string | null; src: string | null; original: string | null; remote_url: string | null;
  source: string; source_ref: string | null; folder: string | null; role: string | null;
  provenance: { tool?: string; model?: string; prompt?: string | null; seed?: string | number | null; version?: string; license?: string; refs_sent?: string[]; media_id?: string; higgsfield_project?: string; fetch_error?: string; size?: number };
  favorite: boolean; locked: boolean; approved: boolean; face_check: 'pending' | 'pass' | 'warn'; face_score: number | null;
  character_name: string | null; project_title: string | null; shot_id: string | null; created_at: string;
  warn: string | null; no_generation: number; face_baseline: number;
};
export type Album = { id: string; title: string; icon?: string; count: number; cover: string | null };

export const api = {
  assets: (album: string, q = '') => fetch(`/api/assets?album=${encodeURIComponent(album)}&q=${encodeURIComponent(q)}`).then(r => r.json()) as Promise<{ items: Asset[] }>,
  albums: () => fetch('/api/albums').then(r => r.json()) as Promise<{ albums: Album[]; projects: Album[]; people: Album[] }>,
  bootstrap: () => fetch('/api/bootstrap').then(r => r.json()),
  favorite: (id: string) => fetch(`/api/assets/${id}/favorite`, { method: 'POST' }).then(r => r.json()),
  approve: (id: string) => fetch(`/api/assets/${id}/approve`, { method: 'POST' }).then(r => r.json()),
  upload: (files: File[]) => { const fd = new FormData(); files.forEach(f => fd.append('file', f, f.name)); return fetch('/api/assets/import', { method: 'POST', body: fd }).then(r => r.json()); }
};

export const fmtDur = (s: number | null) => s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' });
