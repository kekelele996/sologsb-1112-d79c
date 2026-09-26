<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import StatBadge from '../components/common/StatBadge.vue';
import { useTaxonStore } from '../stores/taxonStore';
import { useRingStore } from '../stores/ringStore';
import type { Taxon, TaxonConflict } from '../types/taxon';
import type { RingRecord } from '../types/ring-record';
import { formatDate, formatDateTime } from '../utils/format';

const taxonStore = useTaxonStore();
const ringStore = useRingStore();

const keyword = ref('');
const dialogVisible = ref(false);
const mergeVisible = ref(false);
const editingId = ref('');
const conflicts = ref<TaxonConflict[]>([]);

const formCn = ref('');
const formSci = ref('');
const formAliases = ref<string[]>([]);
const formNote = ref('');

const mergeSourceId = ref('');
const mergeTargetId = ref('');

/** 环志记录字面 → 归并到的标准种 id（一次构建，各行复用） */
const ringTaxonMap = computed(() => {
  const map = new Map<string, { taxonId?: string; standardCn: string }>();
  ringStore.rings.forEach((record) => {
    const resolved = taxonStore.resolveCn(record.speciesCn);
    map.set(record.id, { taxonId: resolved.taxonId, standardCn: resolved.standardCn });
  });
  return map;
});

interface LedgerRow {
  taxon: Taxon;
  count: number;
  rings: RingRecord[];
  literals: Array<{ cn: string; count: number }>;
  hasMerged: boolean;
}

const rows = computed<LedgerRow[]>(() => {
  const kw = keyword.value.trim().toLowerCase();
  return taxonStore.taxa
    .map((taxon) => {
      const rings = ringStore.rings.filter((record) => ringTaxonMap.value.get(record.id)?.taxonId === taxon.id);
      const literalCount = new Map<string, number>();
      rings.forEach((record) => literalCount.set(record.speciesCn, (literalCount.get(record.speciesCn) ?? 0) + 1));
      const literals = Array.from(literalCount.entries())
        .map(([cn, count]) => ({ cn, count }))
        .sort((a, b) => b.count - a.count);
      return { taxon, count: rings.length, rings, literals, hasMerged: literals.some((item) => item.cn !== taxon.standardCn) };
    })
    .filter((row) => {
      if (!kw) return true;
      return [row.taxon.standardCn, row.taxon.standardSci, ...row.taxon.aliases, ...row.literals.map((item) => item.cn)]
        .join(' ')
        .toLowerCase()
        .includes(kw);
    })
    .sort((a, b) => b.count - a.count || a.taxon.standardCn.localeCompare(b.taxon.standardCn, 'zh'));
});

const totalAliases = computed(() => taxonStore.taxa.reduce((sum, taxon) => sum + taxon.aliases.length, 0));
const mergedTaxonCount = computed(() => rows.value.filter((row) => row.hasMerged).length);
const coveredRingCount = computed(() => rows.value.reduce((sum, row) => sum + row.count, 0));

function openCreate() {
  editingId.value = '';
  formCn.value = '';
  formSci.value = '';
  formAliases.value = [];
  formNote.value = '';
  conflicts.value = [];
  dialogVisible.value = true;
}

function openEdit(taxon: Taxon) {
  editingId.value = taxon.id;
  formCn.value = taxon.standardCn;
  formSci.value = taxon.standardSci;
  formAliases.value = [...taxon.aliases];
  formNote.value = taxon.note ?? '';
  conflicts.value = [];
  dialogVisible.value = true;
}

async function submit() {
  const result = await taxonStore.saveTaxon({
    id: editingId.value || undefined,
    standardCn: formCn.value,
    standardSci: formSci.value,
    aliases: formAliases.value,
    note: formNote.value,
  });
  if (!result.ok) {
    conflicts.value = result.conflicts;
    ElMessage.error(`保存未生效：检出 ${result.conflicts.length} 项冲突，请按下方提示处理`);
    return;
  }
  ElMessage.success(editingId.value ? `已调整标准种「${result.taxon?.standardCn}」，统计已按新名称重算` : `已新建标准种「${result.taxon?.standardCn}」`);
  dialogVisible.value = false;
}

function openMerge(taxon: Taxon) {
  mergeSourceId.value = taxon.id;
  mergeTargetId.value = '';
  dialogVisible.value = false;
  conflicts.value = [];
  mergeVisible.value = true;
}

const mergeSource = computed(() => taxonStore.taxa.find((item) => item.id === mergeSourceId.value));
const mergeTarget = computed(() => taxonStore.taxa.find((item) => item.id === mergeTargetId.value));
const mergeTargetOptions = computed(() =>
  taxonStore.taxa
    .filter((item) => item.id !== mergeSourceId.value)
    .map((item) => ({ id: item.id, label: `${item.standardCn} · ${item.standardSci}` })),
);

async function submitMerge() {
  if (!mergeSourceId.value || !mergeTargetId.value) {
    ElMessage.warning('请选择归并目标标准种');
    return;
  }
  const result = await taxonStore.mergeTaxon(mergeSourceId.value, mergeTargetId.value);
  if (!result.ok) {
    conflicts.value = result.conflicts;
    ElMessage.error(`归并未生效：检出 ${result.conflicts.length} 项冲突`);
    return;
  }
  ElMessage.success(`已把「${mergeSource.value?.standardCn}」归并到「${result.taxon?.standardCn}」，原标准名保留为别名可查`);
  mergeVisible.value = false;
}

async function remove(taxon: Taxon) {
  const confirmed = await ElMessageBox.confirm(
    `确认从台账删除「${taxon.standardCn}」？其环志/量度记录的原字面保留不删除，但统计将不再归并（按字面独立计数）。`,
    '删除确认',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await taxonStore.removeTaxon(taxon.id);
  ElMessage.success('已从台账删除，历史记录字面保留');
}

/** 展开行：按原字面分组的环志记录 */
function rowRings(taxonId: string): RingRecord[] {
  return ringStore.rings
    .filter((record) => ringTaxonMap.value.get(record.id)?.taxonId === taxonId)
    .sort((a, b) => b.ringDate.localeCompare(a.ringDate));
}

const conflictTypeText: Record<TaxonConflict['type'], string> = {
  alias_owned: '别名已归属其他鸟种',
  alias_duplicate: '别名重复',
  sci_mismatch_alias: '学名不一致',
  sci_taken: '学名被占用',
  name_taken: '名称冲突',
};

const conflictTagType = (type: TaxonConflict['type']) => (type === 'sci_mismatch_alias' || type === 'sci_taken' ? 'danger' : 'warning');
</script>

<template>
  <div>
    <h2 class="page-title">鸟种归并台账</h2>
    <p class="page-desc">
      维护「标准中文名 + 学名 + 别名表」。志愿者选到别名时按标准种登记；旧记录保留原字面，环志计数、量度均值与筛选统一归到同一种。
      别名已归属其他鸟种、学名不一致或名称冲突时保存不生效并列出冲突记录；调整标准种名后旧名自动留为别名，历史档案仍可查。
    </p>

    <el-row :gutter="12" class="stat-row">
      <el-col :xs="12" :md="6">
        <StatBadge label="标准种" :value="taxonStore.taxa.length" unit="种" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="别名 / 历史名" :value="totalAliases" unit="条" status="success" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="存在归并记录的种" :value="mergedTaxonCount" unit="种" status="warning" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="台账覆盖环志" :value="coveredRingCount" unit="条" />
      </el-col>
    </el-row>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">新建标准种</el-button>
      <el-input v-model="keyword" clearable placeholder="搜索标准名 / 学名 / 别名 / 记录字面" style="width: 300px" />
      <el-tag type="info" effect="plain">展开行可查看旧记录原字面与更名轨迹</el-tag>
    </div>

    <el-card shadow="never" class="block">
      <el-table :data="rows" size="small" border row-key="taxon.id">
        <el-table-column type="expand">
          <template #default="scope">
            <div class="expand-box">
              <div class="expand-section">
                <div class="expand-title">归并到本种的环志记录（{{ scope.row.count }} 条，原字面保留）</div>
                <el-table :data="rowRings(scope.row.taxon.id)" size="small" border>
                  <el-table-column prop="ringNo" label="环号" width="110" />
                  <el-table-column label="记录原字面" width="130">
                    <template #default="inner">
                      <span>{{ inner.row.speciesCn }}</span>
                      <el-tag v-if="inner.row.speciesCn !== scope.row.taxon.standardCn" type="warning" size="small" effect="plain" class="literal-tag">
                        别名
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column prop="speciesSci" label="记录学名" min-width="180" show-overflow-tooltip />
                  <el-table-column label="环志日期" width="110">
                    <template #default="inner">{{ formatDate(inner.row.ringDate) }}</template>
                  </el-table-column>
                  <el-table-column prop="ringer" label="环志人" width="90" />
                </el-table>
              </div>
              <div v-if="scope.row.taxon.renameHistory.length" class="expand-section">
                <div class="expand-title">标准名调整 / 归并轨迹</div>
                <el-timeline>
                  <el-timeline-item
                    v-for="(entry, idx) in scope.row.taxon.renameHistory"
                    :key="idx"
                    :timestamp="`${formatDateTime(entry.at)} · ${entry.reason}`"
                    placement="top"
                    type="primary"
                  >
                    {{ entry.fromCn }} → {{ entry.toCn }}
                  </el-timeline-item>
                </el-timeline>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="标准中文名" min-width="140">
          <template #default="scope">
            <span class="std-cn">{{ scope.row.taxon.standardCn }}</span>
            <el-tag v-if="scope.row.hasMerged" type="success" size="small" effect="plain" class="merge-tag">已归并别名</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="taxon.standardSci" label="学名" min-width="180" show-overflow-tooltip />
        <el-table-column label="别名 / 历史名" min-width="200">
          <template #default="scope">
            <el-tag v-for="alias in scope.row.taxon.aliases" :key="alias" size="small" effect="plain" class="alias-tag">{{ alias }}</el-tag>
            <span v-if="!scope.row.taxon.aliases.length" class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="记录字面分布" min-width="160">
          <template #default="scope">
            <el-tag
              v-for="item in scope.row.literals"
              :key="item.cn"
              size="small"
              :type="item.cn === scope.row.taxon.standardCn ? 'info' : 'warning'"
              effect="plain"
              class="alias-tag"
            >
              {{ item.cn }} ×{{ item.count }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="环志数" width="80" align="right" prop="count" />
        <el-table-column label="更名轨迹" width="90" align="center">
          <template #default="scope">
            <el-popover v-if="scope.row.taxon.renameHistory.length" placement="left" :width="280" trigger="click">
              <template #reference>
                <el-button link type="primary">{{ scope.row.taxon.renameHistory.length }} 次</el-button>
              </template>
              <div v-for="(entry, idx) in scope.row.taxon.renameHistory" :key="idx" class="history-line">
                <div>{{ entry.fromCn }} → {{ entry.toCn }}</div>
                <div class="muted">{{ formatDate(entry.at) }} · {{ entry.reason }}</div>
              </div>
            </el-popover>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="scope">
            <el-button link type="success" @click="openMerge(scope.row.taxon)">归并</el-button>
            <el-button link type="primary" @click="openEdit(scope.row.taxon)">调整</el-button>
            <el-button link type="danger" @click="remove(scope.row.taxon)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新建 / 调整标准种 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '调整标准种 / 维护别名' : '新建标准种'" width="640px">
      <el-form label-width="110px">
        <el-form-item label="标准中文名" required>
          <el-input v-model="formCn" maxlength="30" placeholder="如：红喉歌鸲（调整后旧名自动保留为别名）" />
        </el-form-item>
        <el-form-item label="学名" required>
          <el-input v-model="formSci" maxlength="60" placeholder="如：Calliope calliope" />
        </el-form-item>
        <el-form-item label="别名 / 简称">
          <el-select
            v-model="formAliases"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入别名后回车，如：红点颏、滨鹬"
            style="width: 100%"
          >
            <el-option v-for="alias in formAliases" :key="alias" :label="alias" :value="alias" />
          </el-select>
          <div class="form-hint">别名必须全局唯一；若别名在历史记录里的学名与标准学名不一致，保存会被拦截</div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="formNote" type="textarea" :rows="2" maxlength="80" placeholder="命名依据、地方叫法来源等" />
        </el-form-item>
      </el-form>

      <el-alert
        v-for="(conflict, idx) in conflicts"
        :key="idx"
        :type="conflictTagType(conflict.type)"
        show-icon
        :closable="false"
        class="conflict-alert"
        :title="`${conflictTypeText[conflict.type]}：${conflict.message}`"
      >
        <div v-if="conflict.records?.length">
          <div class="conflict-sub">冲突记录：</div>
          <el-table :data="conflict.records" size="small" border>
            <el-table-column prop="ringNo" label="环号" width="100" />
            <el-table-column prop="literalCn" label="记录鸟种" width="100" />
            <el-table-column prop="literalSci" label="记录学名" min-width="150" show-overflow-tooltip />
            <el-table-column label="日期" width="100">
              <template #default="inner">{{ formatDate(inner.row.ringDate) }}</template>
            </el-table-column>
          </el-table>
        </div>
      </el-alert>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 鸟种归并 -->
    <el-dialog v-model="mergeVisible" title="鸟种归并" width="560px">
      <div v-if="mergeSource" class="merge-box">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="归并源（将被吸收）">
            {{ mergeSource.standardCn }} · {{ mergeSource.standardSci }}
          </el-descriptions-item>
          <el-descriptions-item label="归并目标（保留的标准种）">
            <el-select v-model="mergeTargetId" filterable placeholder="选择目标标准种" style="width: 100%">
              <el-option v-for="opt in mergeTargetOptions" :key="opt.id" :label="opt.label" :value="opt.id" />
            </el-select>
          </el-descriptions-item>
        </el-descriptions>
        <el-alert
          v-if="mergeTarget"
          class="merge-tip"
          type="info"
          :closable="false"
          show-icon
          :title="`归并后「${mergeSource.standardCn}」的标准名与别名都并入「${mergeTarget.standardCn}」，环志计数与量度均值合到同一种；旧名保留为别名，历史记录不改写。`"
        />
      </div>

      <el-alert
        v-for="(conflict, idx) in conflicts"
        :key="idx"
        :type="conflictTagType(conflict.type)"
        show-icon
        :closable="false"
        class="conflict-alert"
        :title="`${conflictTypeText[conflict.type]}：${conflict.message}`"
      >
        <div v-if="conflict.records?.length">
          <div class="conflict-sub">冲突记录：</div>
          <el-table :data="conflict.records" size="small" border>
            <el-table-column prop="ringNo" label="环号" width="100" />
            <el-table-column prop="literalCn" label="记录鸟种" width="100" />
            <el-table-column prop="literalSci" label="记录学名" min-width="150" show-overflow-tooltip />
            <el-table-column label="日期" width="100">
              <template #default="inner">{{ formatDate(inner.row.ringDate) }}</template>
            </el-table-column>
          </el-table>
        </div>
      </el-alert>

      <template #footer>
        <el-button @click="mergeVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!mergeTargetId" @click="submitMerge">确认归并</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 4px;
  font-size: 20px;
  color: #1f4a44;
}
.page-desc {
  margin: 0 0 14px;
  color: #6f8480;
  font-size: 13px;
}
.stat-row {
  margin-bottom: 12px;
}
.stat-row .el-col {
  margin-bottom: 12px;
}
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.block {
  border-radius: 8px;
}
.std-cn {
  font-weight: 600;
  color: #1f4a44;
}
.alias-tag,
.merge-tag,
.literal-tag {
  margin: 2px 4px 2px 0;
}
.muted {
  color: #a0aebb;
  font-size: 12px;
}
.expand-box {
  padding: 10px 18px;
  background: #f7faf9;
}
.expand-section {
  margin-bottom: 12px;
}
.expand-title {
  font-size: 13px;
  font-weight: 600;
  color: #2f4a44;
  margin-bottom: 8px;
}
.history-line {
  padding: 4px 0;
  font-size: 13px;
  border-bottom: 1px dashed #e0eae7;
}
.history-line:last-child {
  border-bottom: none;
}
.form-hint {
  font-size: 12px;
  color: #8a99a5;
  margin-top: 4px;
}
.conflict-alert {
  margin-top: 10px;
}
.conflict-sub {
  font-size: 12px;
  margin: 6px 0;
  font-weight: 600;
}
.merge-box {
  margin-bottom: 8px;
}
.merge-tip {
  margin-top: 10px;
}
</style>
