/**
 * 鸟种归并台账（taxon）。
 *
 * 野外记录里同一种鸟常以别名/简称登记（如「红点颏」=「红喉歌鸲」），
 * 台账以稳定 id 维护「标准中文名 + 学名 + 别名表」，别名与历史标准名
 * 都映射到同一个 taxon。环志/量度记录的字面内容永不改写，统计与筛选
 * 时再按台账解析到标准种。
 */

/** 标准种更名历史条目（旧标准名自动进入别名，历史档案仍可按旧名查询） */
export interface TaxonRename {
  /** 旧标准中文名 */
  fromCn: string;
  /** 新标准中文名 */
  toCn: string;
  /** 变更时间 ISO */
  at: string;
  /** 变更原因：标准名调整 / 鸟种归并 / 别名提升 */
  reason: '标准名调整' | '鸟种归并' | '别名提升';
}

/** 鸟种归并条目 */
export interface Taxon {
  id: string;
  /** 标准中文名 */
  standardCn: string;
  /** 学名 */
  standardSci: string;
  /** 别名 / 简称 / 历史标准名（均唯一指向本种） */
  aliases: string[];
  /** 标准种更名轨迹 */
  renameHistory: TaxonRename[];
  /** 备注 */
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/** 保存不生效时的冲突类型 */
export type TaxonConflictType =
  | 'alias_owned' // 别名已归属其他鸟种
  | 'alias_duplicate' // 同一批次内别名重复
  | 'sci_mismatch_alias' // 别名字面在历史记录里的学名与标准学名不一致
  | 'sci_taken' // 学名已被另一个标准种占用
  | 'name_taken'; // 标准中文名已被其他鸟种（含别名）占用

/** 冲突涉及的历史记录（保存被拒时指出具体记录） */
export interface TaxonConflictRecord {
  /** 环志记录 id */
  ringId: string;
  /** 金属环号 */
  ringNo: string;
  /** 记录上的原字面鸟种 */
  literalCn: string;
  /** 记录上的学名 */
  literalSci: string;
  ringDate: string;
}

/** 单次保存/归并的校验冲突 */
export interface TaxonConflict {
  type: TaxonConflictType;
  message: string;
  /** 冲突涉及的别名 / 名称 */
  name?: string;
  /** 当前占用该名称的标准中文名（如适用） */
  ownerCn?: string;
  /** 冲突涉及的环志记录 */
  records?: TaxonConflictRecord[];
}

/** 保存结果：冲突非空时本次修改不落库 */
export interface SaveTaxonResult {
  ok: boolean;
  conflicts: TaxonConflict[];
  taxon?: Taxon;
}
