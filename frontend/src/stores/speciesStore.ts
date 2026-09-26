import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { validateMerge } from '../utils/species-merge';
import type { MergeConflict, MergeInput, SpeciesMerge } from '../types/species-merge';
import { useRingStore } from './ringStore';

interface SpeciesState {
  merges: SpeciesMerge[];
  hydrated: boolean;
}

/** 鸟种归并台账：别名 → 标准鸟种；保存前做冲突校验，命中冲突则保存不生效 */
export const useSpeciesStore = defineStore('species', {
  state: (): SpeciesState => ({ merges: [], hydrated: false }),

  getters: {
    aliasCount(state): number {
      return state.merges.reduce((sum, merge) => sum + merge.aliases.length, 0);
    },
    renameCount(state): number {
      return state.merges.reduce((sum, merge) => sum + merge.renames.length, 0);
    },
  },

  actions: {
    async hydrate() {
      this.merges = await db.merges.orderBy('updatedAt').reverse().toArray();
      this.hydrated = true;
    },

    /** 新建归并条目；有冲突时返回冲突列表且不落库 */
    async addMerge(input: MergeInput): Promise<{ merge?: SpeciesMerge; conflicts: MergeConflict[] }> {
      const conflicts = validateMerge(input, this.merges, useRingStore().rings);
      if (conflicts.length) return { conflicts };
      const now = new Date().toISOString();
      const merge: SpeciesMerge = {
        id: uid('merge'),
        standardCn: input.standardCn.trim(),
        standardSci: input.standardSci.trim(),
        aliases: Array.from(new Set(input.aliases.map((alias) => alias.trim()).filter(Boolean))),
        renames: [],
        note: input.note?.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      };
      await db.merges.put(toPlain(merge));
      this.merges = [merge, ...this.merges];
      return { merge, conflicts: [] };
    },

    /** 更新别名与备注（标准名 / 学名的调整走 renameMerge，保留改名历史） */
    async updateMerge(id: string, patch: Pick<MergeInput, 'aliases' | 'note'>): Promise<{ conflicts: MergeConflict[] }> {
      const current = this.merges.find((merge) => merge.id === id);
      if (!current) return { conflicts: [{ type: 'name-taken', message: '归并条目不存在或已被解除' }] };
      const input: MergeInput = { standardCn: current.standardCn, standardSci: current.standardSci, aliases: patch.aliases, note: patch.note };
      const conflicts = validateMerge(input, this.merges, useRingStore().rings, id);
      if (conflicts.length) return { conflicts };
      const next: SpeciesMerge = {
        ...current,
        aliases: Array.from(new Set(patch.aliases.map((alias) => alias.trim()).filter(Boolean))),
        note: patch.note?.trim() || undefined,
        updatedAt: new Date().toISOString(),
      };
      await db.merges.put(toPlain(next));
      this.merges = this.merges.map((merge) => (merge.id === id ? next : merge));
      return { conflicts: [] };
    },

    /**
     * 调整标准种名 / 学名：别名与历史记录保持归并，旧名记入改名历史（仍归并到本条目），
     * 统计按新名称重算。有冲突时保存不生效。
     */
    async renameMerge(id: string, next: { standardCn: string; standardSci: string }): Promise<{ conflicts: MergeConflict[] }> {
      const current = this.merges.find((merge) => merge.id === id);
      if (!current) return { conflicts: [{ type: 'name-taken', message: '归并条目不存在或已被解除' }] };
      const cn = next.standardCn.trim();
      const sci = next.standardSci.trim();
      if (cn === current.standardCn && sci === current.standardSci) {
        return { conflicts: [{ type: 'alias-clash', message: '新标准名与学名均未变化，无需调整' }] };
      }
      const input: MergeInput = { standardCn: cn, standardSci: sci, aliases: current.aliases, note: current.note };
      const conflicts = validateMerge(input, this.merges, useRingStore().rings, id);
      if (conflicts.length) return { conflicts };
      const now = new Date().toISOString();
      const renamed: SpeciesMerge = {
        ...current,
        standardCn: cn,
        standardSci: sci,
        renames: [...current.renames, { fromCn: current.standardCn, fromSci: current.standardSci, toCn: cn, toSci: sci, changedAt: now }],
        updatedAt: now,
      };
      await db.merges.put(toPlain(renamed));
      this.merges = this.merges.map((merge) => (merge.id === id ? renamed : merge));
      return { conflicts: [] };
    },

    /** 解除归并：别名不再归并，统计拆回原字面 */
    async removeMerge(id: string) {
      await db.merges.delete(id);
      this.merges = this.merges.filter((merge) => merge.id !== id);
    },
  },
});
