import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { RingRecord } from '../types/ring-record';
import { useRingStore } from './ringStore';
import type { SaveTaxonResult, Taxon, TaxonConflict, TaxonRename } from '../types/taxon';

export interface TaxonInput {
  id?: string;
  standardCn: string;
  standardSci: string;
  aliases: string[];
  note?: string;
}

interface TaxonState {
  taxa: Taxon[];
  hydrated: boolean;
}

const norm = (value: string): string => value.trim();
const normSci = (value: string): string => value.trim().toLowerCase();
const uniq = (values: string[]): string[] => Array.from(new Set(values.map(norm).filter(Boolean)));

/** 鸟种归并台账：标准中文名 / 学名 / 别名，统计与筛选按本台账解析记录字面 */
export const useTaxonStore = defineStore('taxon', {
  state: (): TaxonState => ({ taxa: [], hydrated: false }),

  getters: {
    /** 名称（标准名 + 全部别名/历史名）→ 标准种 的全局唯一索引 */
    nameIndex(state): Map<string, Taxon> {
      const map = new Map<string, Taxon>();
      state.taxa.forEach((taxon) => {
        map.set(norm(taxon.standardCn), taxon);
        taxon.aliases.forEach((alias) => map.set(norm(alias), taxon));
      });
      return map;
    },
  },

  actions: {
    async hydrate() {
      this.taxa = await db.taxa.orderBy('id').toArray();
      this.hydrated = true;
    },

    /** 把环志记录中的鸟种字面解析为标准种；台账缺失时回退为字面本身 */
    resolveCn(cn: string): { standardCn: string; standardSci: string; taxonId?: string; merged: boolean } {
      const name = norm(cn);
      const taxon = this.nameIndex.get(name);
      if (taxon) {
        return { standardCn: taxon.standardCn, standardSci: taxon.standardSci, taxonId: taxon.id, merged: norm(taxon.standardCn) !== name };
      }
      return { standardCn: name, standardSci: '', merged: false };
    },

    /**
     * 依据环志记录补齐台账：名录外的自定义/别名字面首次出现时各自独立成条，
     * 不做猜测式合并；之后由用户在台账页手动归并。
     */
    async syncFromRings(records: RingRecord[]) {
      const known = new Set(this.nameIndex.keys());
      const now = new Date().toISOString();
      const additions: Taxon[] = [];
      records.forEach((record) => {
        const cn = norm(record.speciesCn);
        if (!cn || known.has(cn)) return;
        known.add(cn);
        additions.push({
          id: uid('taxon'),
          standardCn: cn,
          standardSci: record.speciesSci ?? '',
          aliases: [],
          renameHistory: [],
          note: '按记录字面自动登记的自定义鸟种，待人工归并',
          createdAt: now,
          updatedAt: now,
        });
      });
      if (additions.length) {
        await db.taxa.bulkPut(toPlain(additions));
        this.taxa = [...this.taxa, ...additions];
      }
    },

    /** 单条记录保存时确保其字面在台账中存在（不阻塞录入） */
    async ensureLiteral(cn: string, sci: string) {
      const name = norm(cn);
      if (!name || this.nameIndex.has(name)) return;
      const now = new Date().toISOString();
      const taxon: Taxon = {
        id: uid('taxon'),
        standardCn: name,
        standardSci: norm(sci),
        aliases: [],
        renameHistory: [],
        note: '按记录字面自动登记的自定义鸟种，待人工归并',
        createdAt: now,
        updatedAt: now,
      };
      await db.taxa.put(toPlain(taxon));
      this.taxa = [...this.taxa, taxon];
    },

    /**
     * 保存标准种（新建或调整标准名/学名/别名）。
     * 别名已归属其他鸟种、学名不一致或名称冲突时返回冲突列表且不落库。
     * 标准中文名调整时，旧标准名自动并入别名并写入更名轨迹。
     */
    async saveTaxon(input: TaxonInput): Promise<SaveTaxonResult> {
      const standardCn = norm(input.standardCn);
      const standardSci = norm(input.standardSci);
      const aliases = uniq(input.aliases ?? []).filter((alias) => alias !== standardCn);

      if (!standardCn) {
        return { ok: false, conflicts: [{ type: 'name_taken', message: '标准中文名不能为空' }] };
      }

      const self = input.id ? this.taxa.find((item) => item.id === input.id) : undefined;
      if (input.id && !self) {
        return { ok: false, conflicts: [{ type: 'name_taken', message: '待保存的台账条目不存在或已被删除' }] };
      }

      const conflicts: TaxonConflict[] = [];

      // 1. 同批次别名重复（uniq 已去重，此处对原始输入给出提示）
      const rawAliases = (input.aliases ?? []).map(norm).filter(Boolean);
      const dupes = rawAliases.filter((alias, idx) => rawAliases.indexOf(alias) !== idx);
      Array.from(new Set(dupes)).forEach((alias) =>
        conflicts.push({ type: 'alias_duplicate', name: alias, message: `别名「${alias}」在本次提交中重复填写` }),
      );

      // 2. 名称全局唯一：标准名与别名都不能落在其他鸟种名下
      const ownerOf = (name: string): Taxon | undefined => {
        const owner = this.nameIndex.get(name);
        return owner && owner.id !== self?.id ? owner : undefined;
      };

      const standardOwner = ownerOf(standardCn);
      if (standardOwner) {
        conflicts.push({
          type: 'name_taken',
          name: standardCn,
          ownerCn: standardOwner.standardCn,
          message: `标准中文名「${standardCn}」已被「${standardOwner.standardCn}」占用（标准名或别名）`,
        });
      }

      aliases.forEach((alias) => {
        const owner = ownerOf(alias);
        if (owner) {
          const asStandard = norm(owner.standardCn) === alias;
          conflicts.push({
            type: 'alias_owned',
            name: alias,
            ownerCn: owner.standardCn,
            message: asStandard
              ? `别名「${alias}」本身是「${owner.standardCn}」的标准中文名，请改用归并操作`
              : `别名「${alias}」已归属于「${owner.standardCn}」，不能再挂到「${standardCn}」名下`,
          });
        }
      });

      // 3. 别名在历史环志记录里出现过，且记录学名与标准学名不一致
      aliases.forEach((alias) => {
        const mismatch = this.findSciMismatches(alias, standardSci);
        if (mismatch.length) {
          conflicts.push({
            type: 'sci_mismatch_alias',
            name: alias,
            records: mismatch,
            message: `别名「${alias}」有 ${mismatch.length} 条历史记录的学名不是「${standardSci}」，归并前请核对`,
          });
        }
      });

      // 4. 学名已被其他标准种占用
      if (standardSci) {
        const sciOwner = this.taxa.find(
          (item) => item.id !== self?.id && normSci(item.standardSci) === normSci(standardSci),
        );
        if (sciOwner) {
          conflicts.push({
            type: 'sci_taken',
            name: standardSci,
            ownerCn: sciOwner.standardCn,
            message: `学名「${standardSci}」已是「${sciOwner.standardCn}」的标准学名`,
          });
        }
      }

      if (conflicts.length) return { ok: false, conflicts };

      const now = new Date().toISOString();
      let saved: Taxon;
      if (self) {
        const nextAliases = [...aliases];
        const renameHistory = [...self.renameHistory];
        // 标准名调整：旧标准名降级为别名（历史档案仍可按旧名查询），并留痕
        if (norm(self.standardCn) !== standardCn && !nextAliases.includes(norm(self.standardCn))) {
          nextAliases.push(norm(self.standardCn));
          const entry: TaxonRename = {
            fromCn: self.standardCn,
            toCn: standardCn,
            at: now,
            reason: self.aliases.includes(standardCn) ? '别名提升' : '标准名调整',
          };
          renameHistory.push(entry);
        }
        saved = {
          ...self,
          standardCn,
          standardSci,
          aliases: uniq(nextAliases).filter((alias) => alias !== standardCn),
          renameHistory,
          note: input.note?.trim() || undefined,
          updatedAt: now,
        };
      } else {
        saved = {
          id: uid('taxon'),
          standardCn,
          standardSci,
          aliases,
          renameHistory: [],
          note: input.note?.trim() || undefined,
          createdAt: now,
          updatedAt: now,
        };
      }

      await db.taxa.put(toPlain(saved));
      this.taxa = self ? this.taxa.map((item) => (item.id === saved.id ? saved : item)) : [...this.taxa, saved];
      return { ok: true, conflicts: [], taxon: saved };
    },

    /**
     * 把一个标准种整体归并到另一个标准种（别名已独立成条时的主路径）。
     * 学名不一致或存在冲突记录时不落库；源种的标准名与别名并入目标种。
     */
    async mergeTaxon(sourceId: string, targetId: string): Promise<SaveTaxonResult> {
      const source = this.taxa.find((item) => item.id === sourceId);
      const target = this.taxa.find((item) => item.id === targetId);
      if (!source || !target) {
        return { ok: false, conflicts: [{ type: 'name_taken', message: '待归并的鸟种不存在或已被删除' }] };
      }
      if (source.id === target.id) {
        return { ok: false, conflicts: [{ type: 'alias_owned', message: '归并源与归并目标不能是同一种' }] };
      }

      const conflicts: TaxonConflict[] = [];

      // 学名必须一致（源标准名 / 别名名下的历史记录一并核对）
      if (normSci(source.standardSci) && normSci(target.standardSci) && normSci(source.standardSci) !== normSci(target.standardSci)) {
        conflicts.push({
          type: 'sci_mismatch_alias',
          name: source.standardCn,
          ownerCn: target.standardCn,
          records: this.findSciMismatches(source.standardCn, target.standardSci),
          message: `「${source.standardCn}」学名 ${source.standardSci} 与「${target.standardCn}」学名 ${target.standardSci} 不一致，不能归并`,
        });
      }
      source.aliases.forEach((alias) => {
        const mismatch = this.findSciMismatches(alias, target.standardSci);
        if (mismatch.length) {
          conflicts.push({
            type: 'sci_mismatch_alias',
            name: alias,
            records: mismatch,
            message: `「${source.standardCn}」的别名「${alias}」有 ${mismatch.length} 条记录学名与「${target.standardSci}」不一致`,
          });
        }
      });

      // 名称撞车（理论上全局唯一索引已保证，防御性校验）
      [source.standardCn, ...source.aliases].forEach((name) => {
        const owner = this.nameIndex.get(norm(name));
        if (owner && owner.id !== source.id && owner.id !== target.id) {
          conflicts.push({
            type: 'alias_owned',
            name,
            ownerCn: owner.standardCn,
            message: `名称「${name}」已归属于「${owner.standardCn}」，归并会造成别名冲突`,
          });
        }
      });

      if (conflicts.length) return { ok: false, conflicts };

      const now = new Date().toISOString();
      const absorbed = uniq([source.standardCn, ...source.aliases, ...target.aliases]).filter(
        (name) => name !== target.standardCn,
      );
      const merged: Taxon = {
        ...target,
        standardSci: target.standardSci || source.standardSci,
        aliases: absorbed,
        renameHistory: [
          ...target.renameHistory,
          ...source.renameHistory,
          { fromCn: source.standardCn, toCn: target.standardCn, at: now, reason: '鸟种归并' as const },
        ],
        note: target.note,
        updatedAt: now,
      };

      await db.transaction('rw', db.taxa, async () => {
        await db.taxa.put(toPlain(merged));
        await db.taxa.delete(source.id);
      });
      this.taxa = [...this.taxa.filter((item) => item.id !== source.id).map((item) => (item.id === merged.id ? merged : item))];
      return { ok: true, conflicts: [], taxon: merged };
    },

    /** 删除台账条目（环志记录原字面保留，统计回退为按字面独立成种） */
    async removeTaxon(id: string) {
      await db.taxa.delete(id);
      this.taxa = this.taxa.filter((item) => item.id !== id);
    },

    /** 查询某字面名下学名与标准学名不一致的历史环志记录（最多回报 5 条） */
    findSciMismatches(literalCn: string, standardSci: string, limit = 5) {
      // 延迟读取环志 store，避免 store 间循环依赖
      const records = useRingStore().rings;
      if (!standardSci) return [];
      return records
        .filter(
          (record) =>
            norm(record.speciesCn) === norm(literalCn) &&
            norm(record.speciesSci) &&
            normSci(record.speciesSci) !== normSci(standardSci),
        )
        .slice(0, limit)
        .map((record) => ({
          ringId: record.id,
          ringNo: record.ringNo,
          literalCn: record.speciesCn,
          literalSci: record.speciesSci,
          ringDate: record.ringDate,
        }));
    },
  },
});
