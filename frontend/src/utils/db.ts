import Dexie, { type Table } from 'dexie';
import type { RingRecord } from '../types/ring-record';
import type { Morphometrics } from '../types/morphometrics';
import type { BirdSite } from '../types/bird-site';
import type { SurveySession } from '../types/session';
import type { Taxon } from '../types/taxon';
import { SPECIES_CATALOG } from './stats';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbbirdring-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

class BirdRingDB extends Dexie {
  rings!: Table<RingRecord, string>;
  morphs!: Table<Morphometrics, string>;
  sites!: Table<BirdSite, string>;
  sessions!: Table<SurveySession, string>;
  taxa!: Table<Taxon, string>;
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

    // v3：新增 taxa 鸟种归并台账。
    // 升级时从名录与现有环志字面自动建立标准种：名录物种按名录学名建条，
    // 名录外的自定义/别名记录先各自独立成条（不做猜测式合并），之后由用户
    // 在「鸟种归并」页手动归并；环志与量度记录原字面一律不改动。
    this.version(3)
      .stores({
        rings: 'id, ringNo, speciesCn, status, ringDate, siteId, sessionId, [speciesCn+ringDate]',
        morphs: 'id, ringId, measuredAt',
        sites: 'id, siteNo, habitat, name',
        sessions: 'id, sessionNo, date, siteId, closed',
        taxa: 'id, standardCn',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const rows = await tx.table<RingRecord, string>('rings').toArray();
        const taxaTable = tx.table<Taxon, string>('taxa');
        const now = new Date().toISOString();
        const seen = new Set<string>();
        const taxa: Taxon[] = [];

        SPECIES_CATALOG.forEach((item) => {
          if (seen.has(item.cn)) return;
          seen.add(item.cn);
          taxa.push({
            id: `taxon-cat-${taxa.length + 1}`,
            standardCn: item.cn,
            standardSci: item.sci,
            aliases: [],
            renameHistory: [],
            createdAt: now,
            updatedAt: now,
          });
        });

        rows.forEach((row) => {
          const cn = row.speciesCn?.trim();
          if (!cn || seen.has(cn)) return;
          seen.add(cn);
          taxa.push({
            id: `taxon-mig-${taxa.length + 1}`,
            standardCn: cn,
            standardSci: row.speciesSci ?? '',
            aliases: [],
            renameHistory: [],
            note: '升级时按历史记录字面建立，待人工归并',
            createdAt: now,
            updatedAt: now,
          });
        });

        if (taxa.length) await taxaTable.bulkAdd(taxa);
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
