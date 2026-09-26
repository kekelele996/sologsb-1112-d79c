<script setup lang="ts">
import { computed } from 'vue';
import { SPECIES_CATALOG } from '../../utils/stats';
import { useTaxonStore } from '../../stores/taxonStore';

const props = withDefaults(
  defineProps<{
    speciesCn: string;
    speciesSci: string;
    allowCustom?: boolean;
    label?: string;
  }>(),
  { allowCustom: true, label: '鸟种' },
);

const emit = defineEmits<{
  (e: 'update:speciesCn', value: string): void;
  (e: 'update:speciesSci', value: string): void;
}>();

const taxonStore = useTaxonStore();

interface PickerOption {
  label: string;
  value: string;
  sci: string;
  /** 志愿者实际选到的字面（别名），提交时统一替换为标准名 */
  pickedCn: string;
  isAlias: boolean;
}

const options = computed<PickerOption[]>(() => {
  // 台账已水合时用标准种 + 别名；否则退回静态名录（录入页挂载时台账通常已就绪）
  if (taxonStore.hydrated && taxonStore.taxa.length) {
    return taxonStore.taxa.flatMap((taxon) => {
      const rows: PickerOption[] = [
        { label: `${taxon.standardCn} · ${taxon.standardSci}`, value: taxon.standardCn, sci: taxon.standardSci, pickedCn: taxon.standardCn, isAlias: false },
      ];
      taxon.aliases.forEach((alias) => {
        rows.push({
          label: `${alias}（标准名：${taxon.standardCn}）`,
          value: alias,
          sci: taxon.standardSci,
          pickedCn: taxon.standardCn,
          isAlias: true,
        });
      });
      return rows;
    });
  }
  return SPECIES_CATALOG.map((item) => ({ label: `${item.cn} · ${item.sci}`, value: item.cn, sci: item.sci, pickedCn: item.cn, isAlias: false }));
});

function onSpeciesChange(value: string) {
  const matched = options.value.find((item) => item.value === value);
  if (matched) {
    // 选到别名时，记录仍写入标准中文名与标准学名
    emit('update:speciesCn', matched.pickedCn);
    emit('update:speciesSci', matched.sci);
  } else {
    emit('update:speciesCn', value || '');
    emit('update:speciesSci', '');
  }
}

const matched = computed(() => taxonStore.resolveCn(props.speciesCn));
const known = computed(() => {
  if (!props.speciesCn) return false;
  return taxonStore.hydrated ? taxonStore.nameIndex.has(props.speciesCn.trim()) : SPECIES_CATALOG.some((item) => item.cn === props.speciesCn);
});
const mergedFromAlias = computed(() => matched.value.merged);
</script>

<template>
  <div class="species-picker">
    <div class="species-row">
      <span class="species-label">{{ label }}（中文名）</span>
      <el-select
        :model-value="speciesCn"
        filterable
        :allow-create="allowCustom"
        default-first-option
        placeholder="选择标准名或别名（自动归并）"
        style="width: 300px"
        @update:model-value="onSpeciesChange"
      >
        <el-option v-for="item in options" :key="item.value" :label="item.label" :value="item.value">
          <span>{{ item.value }}</span>
          <span v-if="item.isAlias" class="opt-alias">→ {{ item.pickedCn }}</span>
          <span class="opt-sci">{{ item.sci }}</span>
        </el-option>
      </el-select>
      <el-tag v-if="speciesCn" :type="known ? 'success' : 'warning'" size="small" effect="plain">
        {{ known ? '台账内鸟种' : '自定义补充鸟种' }}
      </el-tag>
      <el-tag v-if="mergedFromAlias" type="info" size="small" effect="plain">按别名录入，归并为「{{ matched.standardCn }}」</el-tag>
    </div>
    <div class="species-row">
      <span class="species-label">学名</span>
      <el-input
        :model-value="speciesSci"
        placeholder="随中文名自动带出，可手工修正"
        maxlength="60"
        style="width: 300px"
        @update:model-value="(value: string) => emit('update:speciesSci', value)"
      />
      <span class="species-hint">名录共 {{ SPECIES_CATALOG.length }} 种常见环志鸟种，别名在「鸟种归并」台账维护</span>
    </div>
  </div>
</template>

<style scoped>
.species-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.species-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.species-label {
  width: 130px;
  font-size: 13px;
  color: #2f4a44;
}
.species-hint {
  font-size: 12px;
  color: #8a99a5;
}
.opt-alias {
  color: #2f7d6f;
  font-size: 12px;
  margin-left: 8px;
}
.opt-sci {
  float: right;
  color: #a0aebb;
  font-size: 12px;
}
</style>
