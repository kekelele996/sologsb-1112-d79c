import { db, SCHEMA_VERSION } from './db';

export interface BackupPayload {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  rings: unknown[];
  morphs: unknown[];
  sites: unknown[];
  sessions: unknown[];
  merges: unknown[];
}

/** 汇总全部本地表为 JSON 备份（schema 迁移前先导出） */
export async function buildBackup(): Promise<BackupPayload> {
  const [rings, morphs, sites, sessions, merges] = await Promise.all([
    db.rings.toArray(),
    db.morphs.toArray(),
    db.sites.toArray(),
    db.sessions.toArray(),
    db.merges.toArray(),
  ]);
  return {
    app: 'gbbirdring',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    rings,
    morphs,
    sites,
    sessions,
    merges,
  };
}

export async function exportBackupJson(): Promise<string> {
  return JSON.stringify(await buildBackup(), null, 2);
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 导出 CSV（环志汇总表打印用） */
export function downloadCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  columns: Array<{ key: keyof T; title: string }>,
): void {
  const header = columns.map((c) => `"${c.title}"`).join(',');
  const body = rows
    .map((row) => columns.map((c) => `"${String(row[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  downloadText(filename, `\ufeff${header}\n${body}`, 'text/csv');
}

/** 恢复 JSON 备份（merges 为 v3 新增表，旧备份没有该字段时跳过） */
export async function importBackup(text: string): Promise<{ rings: number; morphs: number; sites: number; sessions: number; merges: number }> {
  const payload = JSON.parse(text) as Partial<BackupPayload>;
  if (!payload || payload.app !== 'gbbirdring') {
    throw new Error('备份文件格式不匹配（缺少 app=gbbirdring 标记）');
  }
  const counts = {
    rings: payload.rings?.length ?? 0,
    morphs: payload.morphs?.length ?? 0,
    sites: payload.sites?.length ?? 0,
    sessions: payload.sessions?.length ?? 0,
    merges: payload.merges?.length ?? 0,
  };
  await db.transaction('rw', db.rings, db.morphs, db.sites, db.sessions, db.merges, async () => {
    await Promise.all([db.rings.clear(), db.morphs.clear(), db.sites.clear(), db.sessions.clear()]);
    if (payload.rings?.length) await db.rings.bulkPut(payload.rings as never[]);
    if (payload.morphs?.length) await db.morphs.bulkPut(payload.morphs as never[]);
    if (payload.sites?.length) await db.sites.bulkPut(payload.sites as never[]);
    if (payload.sessions?.length) await db.sessions.bulkPut(payload.sessions as never[]);
    // merges 为 v3 新增表：旧备份没有该字段时保留现有归并台账，避免静默丢失
    if (payload.merges) {
      await db.merges.clear();
      if (payload.merges.length) await db.merges.bulkPut(payload.merges as never[]);
    }
  });
  return counts;
}
