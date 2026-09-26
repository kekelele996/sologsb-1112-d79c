<script setup lang="ts">
import { computed } from 'vue';
import { SPECIES_CATALOG } from '../../utils/stats';
import { resolvePick } from '../../utils/species-merge';
import { useSpeciesStore } from '../../stores/speciesStore';

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

const speciesStore = useSpeciesStore();

interface SpeciesOption {
  label: string;
  value: string;
  /** 是否别名选项（选中后采用标准中文名与学名） */
  alias: boolean;
}

const options = computed<SpeciesOption[]>(() => {
  const base: SpeciesOption[] = SPECIES_CATALOG.map((item) => ({ label: `${item.cn} · ${item.sci}`, value: item.cn, alias: false }));
  const extras: SpeciesOption[] = [];
  speciesStore.merges.forEach((merge) => {
    if (!SPECIES_CATALOG.some((item) => item.cn === merge.standardCn)) {
      extras.push({ label: `${merge.standardCn} · ${merge.standardSci}（归并标准名）`, value: merge.standardCn, alias: false });
    }
    merge.aliases.forEach((alias) => {
      extras.push({ label: `${alias}（别名 → ${merge.standardCn}）`, value: alias, alias: true });
    });
  });
  return [...base, ...extras];
});

function onSpeciesChange(value: string) {
  const picked = resolvePick(value || '', speciesStore.merges);
  emit('update:speciesCn', picked.cn || value || '');
  emit('update:speciesSci', picked.sci);
}

const known = computed(
  () =>
    SPECIES_CATALOG.some((item) => item.cn === props.speciesCn) ||
    speciesStore.merges.some((merge) => merge.standardCn === props.speciesCn),
);
const aliasTotal = computed(() => speciesStore.aliasCount);
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
        placeholder="选择或输入鸟种中文名 / 别名"
        style="width: 260px"
        @update:model-value="onSpeciesChange"
      >
        <el-option v-for="item in options" :key="`${item.alias ? 'a' : 's'}-${item.value}`" :label="item.label" :value="item.value" />
      </el-select>
      <el-tag v-if="speciesCn" :type="known ? 'success' : 'warning'" size="small" effect="plain">
        {{ known ? '名录内鸟种' : '自定义补充鸟种' }}
      </el-tag>
    </div>
    <div class="species-row">
      <span class="species-label">学名</span>
      <el-input
        :model-value="speciesSci"
        placeholder="随中文名自动带出，可手工修正"
        maxlength="60"
        style="width: 260px"
        @update:model-value="(value: string) => emit('update:speciesSci', value)"
      />
      <span class="species-hint">名录共 {{ SPECIES_CATALOG.length }} 种常见环志鸟种 · 归并别名 {{ aliasTotal }} 个（选别名自动采用标准名）</span>
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
</style>
