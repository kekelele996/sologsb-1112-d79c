/** 标准种名调整记录（改名历史：保留旧名，历史档案仍可追溯） */
export interface SpeciesRename {
  /** 原标准中文名 */
  fromCn: string;
  /** 原学名 */
  fromSci: string;
  /** 新标准中文名 */
  toCn: string;
  /** 新学名 */
  toSci: string;
  /** 调整时间 ISO */
  changedAt: string;
}

/** 鸟种归并条目：把野外记录里的别名 / 简称归并到一个标准鸟种 */
export interface SpeciesMerge {
  id: string;
  /** 标准中文名（归并目标，统计以此名为准） */
  standardCn: string;
  /** 标准学名 */
  standardSci: string;
  /** 别名 / 简称列表 */
  aliases: string[];
  /** 标准种名调整历史（旧名仍归并到本条目） */
  renames: SpeciesRename[];
  /** 备注 */
  note?: string;
  /** 创建时间 ISO */
  createdAt: string;
  /** 最近更新时间 ISO */
  updatedAt: string;
}

/** 归并条目录入 / 编辑输入 */
export interface MergeInput {
  standardCn: string;
  standardSci: string;
  aliases: string[];
  note?: string;
}

/** 归并校验冲突类型 */
export type MergeConflictType =
  /** 别名已归属其他鸟种 */
  | 'alias-taken'
  /** 与现有别名 / 标准名冲突 */
  | 'alias-clash'
  /** 学名不一致（名录或历史记录） */
  | 'sci-mismatch'
  /** 标准名已被占用 */
  | 'name-taken';

/** 归并校验冲突（保存不生效时逐条指出） */
export interface MergeConflict {
  type: MergeConflictType;
  message: string;
  /** 冲突来源归并条目 id（冲突来自其他条目时） */
  mergeId?: string;
  /** 冲突的环志记录（学名不一致时指出具体记录） */
  records?: Array<{ id: string; ringNo: string; speciesCn: string; speciesSci: string }>;
}
