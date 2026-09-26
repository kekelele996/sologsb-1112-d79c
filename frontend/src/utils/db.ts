import Dexie, { type Table } from 'dexie';
import type { RingRecord } from '../types/ring-record';
import type { Morphometrics } from '../types/morphometrics';
import type { BirdSite } from '../types/bird-site';
import type { SurveySession } from '../types/session';
import type { SpeciesMerge } from '../types/species-merge';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbbirdring-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

class BirdRingDB extends Dexie {
  rings!: Table<RingRecord, string>;
  morphs!: Table<Morphometrics, string>;
  sites!: Table<BirdSite, string>;
  sessions!: Table<SurveySession, string>;
  merges!: Table<SpeciesMerge, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super(DB_NAME);

    // v1：建表声明索引
    this.version(1).stores({
      rings: 'id, ringNo, speciesCn, status, ringDate, siteId, sessionId',
      morphs: 'id, ringId, measuredAt',
      sites: 'id, siteNo, habitat, name',
      sessions: 'id, sessionNo, date, siteId, closed',
      meta: 'key',
    });

    // v2：环志表增加 (speciesCn+ringDate) 复合索引，鸟种按日期检索更快；并回填历史彩环字段。
    // 升级前请在顶栏「导出备份」导出 JSON。
    this.version(2)
      .stores({
        rings: 'id, ringNo, speciesCn, status, ringDate, siteId, sessionId, [speciesCn+ringDate]',
        morphs: 'id, ringId, measuredAt',
        sites: 'id, siteNo, habitat, name',
        sessions: 'id, sessionNo, date, siteId, closed',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('rings')
          .toCollection()
          .modify((row: RingRecord) => {
            if (typeof row.colorRing !== 'string') {
              row.colorRing = '无';
            }
          });
      });

    // v3：新增鸟种归并台账表 merges（别名 → 标准鸟种，含改名历史）。升级前请先在顶栏「导出备份」。
    this.version(3).stores({
      rings: 'id, ringNo, speciesCn, status, ringDate, siteId, sessionId, [speciesCn+ringDate]',
      morphs: 'id, ringId, measuredAt',
      sites: 'id, siteNo, habitat, name',
      sessions: 'id, sessionNo, date, siteId, closed',
      merges: 'id, standardCn, updatedAt',
      meta: 'key',
    });
  }
}

export const db = new BirdRingDB();

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
