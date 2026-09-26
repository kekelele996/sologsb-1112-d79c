import type { RingRecord } from '../types/ring-record';
import type { MergeConflict, MergeInput, SpeciesMerge } from '../types/species-merge';
import { SPECIES_CATALOG } from './stats';

const norm = (name: string): string => name.trim();
const normSci = (sci: string): string => sci.trim().toLowerCase();

/** 条目涉及的全部名字：现行标准名 + 别名 + 曾用标准名（改名历史里的旧名） */
export function namesOf(merge: SpeciesMerge): string[] {
  return [merge.standardCn, ...merge.aliases, ...merge.renames.map((rename) => rename.fromCn)];
}

/** 曾用标准名（改名前的旧标准名，仍归并到本条目） */
export function formerNamesOf(merge: SpeciesMerge): string[] {
  return merge.renames.map((rename) => rename.fromCn);
}

function findMerge(name: string, merges: SpeciesMerge[]): SpeciesMerge | undefined {
  const key = norm(name);
  if (!key) return undefined;
  return merges.find(
    (merge) => merge.standardCn === key || merge.aliases.includes(key) || formerNamesOf(merge).includes(key),
  );
}

/** 解析字面鸟种名 → 归并后的标准中文名（无归并时原样返回） */
export function resolveName(name: string, merges: SpeciesMerge[]): string {
  const hit = findMerge(name, merges);
  return hit ? hit.standardCn : norm(name);
}

/** 解析字面鸟种 → 标准中文名与学名（无归并时原样返回） */
export function resolveSpecies(cn: string, sci: string, merges: SpeciesMerge[]): { cn: string; sci: string } {
  const hit = findMerge(cn, merges);
  if (hit) return { cn: hit.standardCn, sci: hit.standardSci };
  return { cn: norm(cn), sci };
}

/** 鸟种选择解析：选中别名时采用标准中文名与学名；名录鸟种带出名录学名；其余原样保留 */
export function resolvePick(value: string, merges: SpeciesMerge[]): { cn: string; sci: string } {
  const key = norm(value);
  if (!key) return { cn: '', sci: '' };
  const hit = findMerge(key, merges);
  if (hit) return { cn: hit.standardCn, sci: hit.standardSci };
  const catalog = SPECIES_CATALOG.find((item) => item.cn === key);
  return { cn: key, sci: catalog?.sci ?? '' };
}

/**
 * 归并视图：把记录里的鸟种名替换为归并后的标准名（不改库、不改原数组），
 * 统计台计数 / 量度均值 / 批次统计先经此视图再分组，即归到同一种。
 */
export function canonicalRings(records: RingRecord[], merges: SpeciesMerge[]): RingRecord[] {
  if (!merges.length) return records;
  return records.map((record) => {
    const resolved = resolveSpecies(record.speciesCn, record.speciesSci, merges);
    if (resolved.cn === record.speciesCn && resolved.sci === record.speciesSci) return record;
    return { ...record, speciesCn: resolved.cn, speciesSci: resolved.sci || record.speciesSci };
  });
}

/** 各标准名下被归并的原字面名称（统计台标注「含别名」用） */
export function mergedLiterals(records: RingRecord[], merges: SpeciesMerge[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  records.forEach((record) => {
    const resolved = resolveName(record.speciesCn, merges);
    if (resolved !== record.speciesCn) {
      const set = map.get(resolved) ?? new Set<string>();
      set.add(record.speciesCn);
      map.set(resolved, set);
    }
  });
  return new Map(Array.from(map.entries()).map(([key, set]) => [key, Array.from(set)]));
}

/** 该归并条目覆盖到的环志记录（原字面命中标准名 / 别名 / 曾用名） */
export function recordsOf(merge: SpeciesMerge, rings: RingRecord[]): RingRecord[] {
  const names = namesOf(merge);
  return rings.filter((record) => names.includes(record.speciesCn));
}

function conflictRecords(rings: RingRecord[]): MergeConflict['records'] {
  return rings.map((record) => ({
    id: record.id,
    ringNo: record.ringNo,
    speciesCn: record.speciesCn,
    speciesSci: record.speciesSci,
  }));
}

/**
 * 归并保存校验。命中以下任一情况时返回冲突列表（保存不生效）：
 * - 别名已归属其他鸟种 / 标准名已被其他条目占用（含曾用名）
 * - 与现有别名冲突（别名与标准名相同、别名重复、别名是他条目的标准名）
 * - 学名不一致（与名录或历史环志记录中的学名不符，并指出冲突记录）
 * selfId 用于编辑 / 改名时排除条目自身。
 */
export function validateMerge(
  input: MergeInput,
  merges: SpeciesMerge[],
  rings: RingRecord[],
  selfId = '',
): MergeConflict[] {
  const conflicts: MergeConflict[] = [];
  const cn = norm(input.standardCn);
  const sci = norm(input.standardSci);
  const rawAliases = input.aliases.map(norm).filter(Boolean);
  const aliases = Array.from(new Set(rawAliases));
  const others = merges.filter((merge) => merge.id !== selfId);

  // 标准名与其他归并条目冲突
  others.forEach((merge) => {
    if (merge.standardCn === cn) {
      conflicts.push({ type: 'name-taken', mergeId: merge.id, message: `标准名「${cn}」已被归并条目「${merge.standardCn} · ${merge.standardSci}」使用` });
    } else if (merge.aliases.includes(cn)) {
      conflicts.push({ type: 'alias-taken', mergeId: merge.id, message: `「${cn}」已是条目「${merge.standardCn}」的别名，不能再作为标准名` });
    } else if (formerNamesOf(merge).includes(cn)) {
      conflicts.push({ type: 'name-taken', mergeId: merge.id, message: `「${cn}」是条目「${merge.standardCn}」的曾用标准名，仍归并到该条目` });
    }
  });

  // 别名列表内部重复
  if (aliases.length !== rawAliases.length) {
    conflicts.push({ type: 'alias-clash', message: '别名列表存在重复项，请去重后再保存' });
  }

  aliases.forEach((alias) => {
    if (alias === cn) {
      conflicts.push({ type: 'alias-clash', message: `别名「${alias}」与标准名相同，无需归并` });
      return;
    }
    // 别名已归属其他鸟种 / 与现有条目冲突
    others.forEach((merge) => {
      if (merge.aliases.includes(alias)) {
        conflicts.push({ type: 'alias-taken', mergeId: merge.id, message: `别名「${alias}」已归属「${merge.standardCn} · ${merge.standardSci}」` });
      } else if (merge.standardCn === alias) {
        conflicts.push({ type: 'alias-clash', mergeId: merge.id, message: `别名「${alias}」是条目「${merge.standardCn}」的标准名，不能重复登记为别名` });
      } else if (formerNamesOf(merge).includes(alias)) {
        conflicts.push({ type: 'alias-taken', mergeId: merge.id, message: `别名「${alias}」是条目「${merge.standardCn}」的曾用标准名，仍归并到该条目` });
      }
    });
    // 学名不一致：名录
    const catalogHit = SPECIES_CATALOG.find((item) => item.cn === alias);
    if (catalogHit && sci && normSci(catalogHit.sci) !== normSci(sci)) {
      conflicts.push({ type: 'sci-mismatch', message: `别名「${alias}」在名录中的学名为 ${catalogHit.sci}，与拟归并学名 ${sci} 不一致` });
    }
    // 学名不一致：历史环志记录（指出冲突记录）
    const hitRecords = rings.filter((record) => record.speciesCn === alias && record.speciesSci && sci && normSci(record.speciesSci) !== normSci(sci));
    if (hitRecords.length) {
      conflicts.push({
        type: 'sci-mismatch',
        message: `别名「${alias}」在 ${hitRecords.length} 条环志记录中的学名与「${sci}」不一致`,
        records: conflictRecords(hitRecords),
      });
    }
  });

  // 标准名自身的学名一致性：名录 + 历史环志记录
  const catalogStd = SPECIES_CATALOG.find((item) => item.cn === cn);
  if (catalogStd && sci && normSci(catalogStd.sci) !== normSci(sci)) {
    conflicts.push({ type: 'sci-mismatch', message: `标准名「${cn}」在名录中的学名为 ${catalogStd.sci}，与填写学名 ${sci} 不一致` });
  }
  const stdRecords = rings.filter((record) => record.speciesCn === cn && record.speciesSci && sci && normSci(record.speciesSci) !== normSci(sci));
  if (stdRecords.length) {
    conflicts.push({
      type: 'sci-mismatch',
      message: `标准名「${cn}」在 ${stdRecords.length} 条环志记录中的学名与「${sci}」不一致`,
      records: conflictRecords(stdRecords),
    });
  }

  return conflicts;
}
