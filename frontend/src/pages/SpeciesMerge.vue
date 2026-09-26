<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import StatBadge from '../components/common/StatBadge.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import { useSpeciesStore } from '../stores/speciesStore';
import { useRingStore } from '../stores/ringStore';
import { SPECIES_CATALOG } from '../utils/stats';
import { formerNamesOf, recordsOf, resolveName } from '../utils/species-merge';
import { formatDate, formatDateTime } from '../utils/format';
import type { MergeConflict, SpeciesMerge } from '../types/species-merge';

const speciesStore = useSpeciesStore();
const ringStore = useRingStore();

const createVisible = ref(false);
const createForm = ref({ standardCn: '', standardSci: '', aliases: [] as string[], note: '' });
const createConflicts = ref<MergeConflict[]>([]);

const editVisible = ref(false);
const editingId = ref('');
const editForm = ref({ aliases: [] as string[], note: '' });
const editConflicts = ref<MergeConflict[]>([]);

const renameVisible = ref(false);
const renamingId = ref('');
const renameForm = ref({ standardCn: '', standardSci: '' });
const renameConflicts = ref<MergeConflict[]>([]);

// 档案弹窗开关：仅选中条目时为字符串 id，关闭时为 null（el-dialog 的 v-model 期望布尔值，不用空字符串占位）
const archiveId = ref<string | null>(null);

const editingMerge = computed(() => speciesStore.merges.find((merge) => merge.id === editingId.value));
const renamingMerge = computed(() => speciesStore.merges.find((merge) => merge.id === renamingId.value));
const archive = computed(() => speciesStore.merges.find((merge) => merge.id === archiveId.value));
const archiveRecords = computed(() => (archive.value ? recordsOf(archive.value, ringStore.rings) : []));

const recordCountOf = (merge: SpeciesMerge) => recordsOf(merge, ringStore.rings).length;
/** 原字面与归并结果不一致的环志记录数（被归并的记录） */
const mergedRecordCount = computed(
  () => ringStore.rings.filter((record) => resolveName(record.speciesCn, speciesStore.merges) !== record.speciesCn).length,
);

function catalogSci(cn: string): string {
  return SPECIES_CATALOG.find((item) => item.cn === cn)?.sci ?? '';
}

function openCreate() {
  createForm.value = { standardCn: '', standardSci: '', aliases: [], note: '' };
  createConflicts.value = [];
  createVisible.value = true;
}

function onCreateCnChange(value: string) {
  createForm.value.standardCn = value;
  const sci = catalogSci(value);
  if (sci) createForm.value.standardSci = sci;
}

function openEdit(merge: SpeciesMerge) {
  editingId.value = merge.id;
  editForm.value = { aliases: [...merge.aliases], note: merge.note ?? '' };
  editConflicts.value = [];
  editVisible.value = true;
}

function openRename(merge: SpeciesMerge) {
  renamingId.value = merge.id;
  renameForm.value = { standardCn: merge.standardCn, standardSci: merge.standardSci };
  renameConflicts.value = [];
  renameVisible.value = true;
}

function onRenameCnChange(value: string) {
  renameForm.value.standardCn = value;
  const sci = catalogSci(value);
  if (sci) renameForm.value.standardSci = sci;
}

/** 保存归并：store 校验命中冲突时保存不生效，冲突逐条展示在弹窗内 */
async function submitCreate() {
  if (!createForm.value.standardCn.trim()) {
    ElMessage.warning('请填写标准中文名');
    return;
  }
  if (createForm.value.aliases.length === 0) {
    ElMessage.warning('请至少登记一个别名');
    return;
  }
  const result = await speciesStore.addMerge(createForm.value);
  if (result.conflicts.length) {
    createConflicts.value = result.conflicts;
    return;
  }
  createVisible.value = false;
  ElMessage.success(`已登记归并：${result.merge!.aliases.join('、')} → ${result.merge!.standardCn}`);
}

async function submitEdit() {
  if (editForm.value.aliases.length === 0) {
    ElMessage.warning('请至少保留一个别名；不再需要归并时请使用「解除」');
    return;
  }
  const result = await speciesStore.updateMerge(editingId.value, editForm.value);
  if (result.conflicts.length) {
    editConflicts.value = result.conflicts;
    return;
  }
  editVisible.value = false;
  ElMessage.success(`已更新「${editingMerge.value?.standardCn ?? ''}」的归并别名`);
}

async function submitRename() {
  if (!renameForm.value.standardCn.trim()) {
    ElMessage.warning('请填写新标准中文名');
    return;
  }
  const from = renamingMerge.value?.standardCn ?? '';
  const result = await speciesStore.renameMerge(renamingId.value, renameForm.value);
  if (result.conflicts.length) {
    renameConflicts.value = result.conflicts;
    return;
  }
  renameVisible.value = false;
  ElMessage.success(`已将标准名「${from}」调整为「${renameForm.value.standardCn}」，统计按新名称重算`);
}

async function remove(merge: SpeciesMerge) {
  const confirmed = await ElMessageBox.confirm(
    `解除后「${merge.aliases.join('、')}」不再归并到「${merge.standardCn}」，统计将按原字面拆分。确认解除该归并？`,
    '解除归并',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await speciesStore.removeMerge(merge.id);
  ElMessage.success('已解除归并');
}
</script>

<template>
  <div>
    <h2 class="page-title">鸟种归并台账</h2>
    <p class="page-desc">
      野外记录里的别名 / 简称归并到标准鸟种：志愿者选到别名时采用标准中文名与学名，旧记录保留原字面，环志计数、量度均值与筛选归到同一种。别名冲突或学名不一致时保存不生效。
    </p>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">新建归并</el-button>
      <el-tag type="info" effect="plain">
        条目 {{ speciesStore.merges.length }} 个 · 别名 {{ speciesStore.aliasCount }} 个 · 被归并记录 {{ mergedRecordCount }} 条
      </el-tag>
    </div>

    <el-row :gutter="12" class="stat-row">
      <el-col :xs="12" :md="6">
        <StatBadge label="归并条目" :value="speciesStore.merges.length" unit="条" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="归并别名" :value="speciesStore.aliasCount" unit="个" status="success" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="被归并记录" :value="mergedRecordCount" unit="条" status="warning" hint="原字面保留，统计归到标准名" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="标准名调整" :value="speciesStore.renameCount" unit="次" hint="旧名仍可查档案" />
      </el-col>
    </el-row>

    <EmptyPanel v-if="speciesStore.merges.length === 0" description="暂无归并条目，先把野外别名登记到标准鸟种" action-text="新建归并" @action="openCreate" />

    <el-card v-else shadow="never" class="block">
      <el-table :data="speciesStore.merges" size="small" border>
        <el-table-column prop="standardCn" label="标准中文名" width="120" />
        <el-table-column prop="standardSci" label="标准学名" min-width="160" show-overflow-tooltip />
        <el-table-column label="别名 / 简称" min-width="180">
          <template #default="scope">
            <el-tag v-for="alias in scope.row.aliases" :key="alias" size="small" effect="plain" class="alias-tag">{{ alias }}</el-tag>
            <span v-if="scope.row.aliases.length === 0">—</span>
          </template>
        </el-table-column>
        <el-table-column label="曾用标准名" width="140">
          <template #default="scope">
            <el-tag v-for="name in formerNamesOf(scope.row)" :key="name" size="small" type="info" effect="plain" class="alias-tag">{{ name }}</el-tag>
            <span v-if="formerNamesOf(scope.row).length === 0">—</span>
          </template>
        </el-table-column>
        <el-table-column label="归并记录" width="90" align="right">
          <template #default="scope">{{ recordCountOf(scope.row) }} 条</template>
        </el-table-column>
        <el-table-column label="更新时间" width="150">
          <template #default="scope">{{ formatDateTime(scope.row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="archiveId = scope.row.id">档案</el-button>
            <el-button link type="warning" @click="openRename(scope.row)">调整标准名</el-button>
            <el-button link type="primary" @click="openEdit(scope.row)">编辑别名</el-button>
            <el-button link type="danger" @click="remove(scope.row)">解除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="createVisible" title="新建鸟种归并" width="620px">
      <el-form label-width="110px">
        <el-form-item label="标准中文名" required>
          <el-select
            v-model="createForm.standardCn"
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入标准中文名"
            style="width: 280px"
            @change="onCreateCnChange"
          >
            <el-option v-for="item in SPECIES_CATALOG" :key="item.cn" :label="`${item.cn} · ${item.sci}`" :value="item.cn" />
          </el-select>
        </el-form-item>
        <el-form-item label="标准学名">
          <el-input v-model="createForm.standardSci" placeholder="随标准名自动带出，可手工修正" maxlength="60" style="width: 280px" />
        </el-form-item>
        <el-form-item label="别名 / 简称" required>
          <el-select
            v-model="createForm.aliases"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入别名后回车，可登记多个"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="createForm.note" type="textarea" :rows="2" maxlength="60" placeholder="别名来源、常见写法等" />
        </el-form-item>
      </el-form>
      <el-alert v-if="createConflicts.length" type="error" show-icon :closable="false" title="保存未生效：存在以下冲突" class="conflict-alert">
        <ul class="conflict-list">
          <li v-for="(conflict, index) in createConflicts" :key="index">
            {{ conflict.message }}
            <template v-if="conflict.records?.length">
              （冲突记录：
              <el-tag v-for="record in conflict.records.slice(0, 6)" :key="record.id" size="small" type="danger" effect="plain" class="alias-tag">
                {{ record.ringNo }}
              </el-tag>
              <span v-if="conflict.records.length > 6">等 {{ conflict.records.length }} 条</span>
              ）
            </template>
          </li>
        </ul>
      </el-alert>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="submitCreate">保存归并</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editVisible" :title="`编辑归并别名 · ${editingMerge?.standardCn ?? ''}`" width="620px">
      <el-form label-width="110px">
        <el-form-item label="标准鸟种">
          <span>{{ editingMerge?.standardCn }} · {{ editingMerge?.standardSci }}（调整标准名请用「调整标准名」）</span>
        </el-form-item>
        <el-form-item label="别名 / 简称" required>
          <el-select
            v-model="editForm.aliases"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入别名后回车，可登记多个"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="editForm.note" type="textarea" :rows="2" maxlength="60" placeholder="别名来源、常见写法等" />
        </el-form-item>
      </el-form>
      <el-alert v-if="editConflicts.length" type="error" show-icon :closable="false" title="保存未生效：存在以下冲突" class="conflict-alert">
        <ul class="conflict-list">
          <li v-for="(conflict, index) in editConflicts" :key="index">
            {{ conflict.message }}
            <template v-if="conflict.records?.length">
              （冲突记录：
              <el-tag v-for="record in conflict.records.slice(0, 6)" :key="record.id" size="small" type="danger" effect="plain" class="alias-tag">
                {{ record.ringNo }}
              </el-tag>
              <span v-if="conflict.records.length > 6">等 {{ conflict.records.length }} 条</span>
              ）
            </template>
          </li>
        </ul>
      </el-alert>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="renameVisible" title="调整标准种名" width="620px">
      <el-alert
        type="info"
        show-icon
        :closable="false"
        title="调整后别名与历史记录保持归并，统计按新名称重算；旧名记入改名历史，仍可按旧名查到档案。"
      />
      <el-form label-width="110px" class="rename-form">
        <el-form-item label="当前标准名">
          <span>{{ renamingMerge?.standardCn }} · {{ renamingMerge?.standardSci }}</span>
        </el-form-item>
        <el-form-item label="新标准名" required>
          <el-select
            v-model="renameForm.standardCn"
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入新标准中文名"
            style="width: 280px"
            @change="onRenameCnChange"
          >
            <el-option v-for="item in SPECIES_CATALOG" :key="item.cn" :label="`${item.cn} · ${item.sci}`" :value="item.cn" />
          </el-select>
        </el-form-item>
        <el-form-item label="新学名">
          <el-input v-model="renameForm.standardSci" placeholder="随标准名自动带出，可手工修正" maxlength="60" style="width: 280px" />
        </el-form-item>
      </el-form>
      <el-alert v-if="renameConflicts.length" type="error" show-icon :closable="false" title="保存未生效：存在以下冲突" class="conflict-alert">
        <ul class="conflict-list">
          <li v-for="(conflict, index) in renameConflicts" :key="index">
            {{ conflict.message }}
            <template v-if="conflict.records?.length">
              （冲突记录：
              <el-tag v-for="record in conflict.records.slice(0, 6)" :key="record.id" size="small" type="danger" effect="plain" class="alias-tag">
                {{ record.ringNo }}
              </el-tag>
              <span v-if="conflict.records.length > 6">等 {{ conflict.records.length }} 条</span>
              ）
            </template>
          </li>
        </ul>
      </el-alert>
      <template #footer>
        <el-button @click="renameVisible = false">取消</el-button>
        <el-button type="primary" @click="submitRename">保存调整</el-button>
      </template>
    </el-dialog>

    <el-dialog v-if="archiveId" :model-value="true" :title="`归并档案 · ${archive?.standardCn ?? ''}`" width="780px" @close="archiveId = null">
      <template v-if="archive">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="标准中文名">{{ archive.standardCn }}</el-descriptions-item>
          <el-descriptions-item label="标准学名">{{ archive.standardSci }}</el-descriptions-item>
          <el-descriptions-item label="别名 / 简称">
            <el-tag v-for="alias in archive.aliases" :key="alias" size="small" effect="plain" class="alias-tag">{{ alias }}</el-tag>
            <span v-if="archive.aliases.length === 0">—</span>
          </el-descriptions-item>
          <el-descriptions-item label="曾用标准名">
            <el-tag v-for="name in formerNamesOf(archive)" :key="name" size="small" type="info" effect="plain" class="alias-tag">{{ name }}</el-tag>
            <span v-if="formerNamesOf(archive).length === 0">—</span>
          </el-descriptions-item>
          <el-descriptions-item label="备注">{{ archive.note ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="更新于">{{ formatDateTime(archive.updatedAt) }}</el-descriptions-item>
        </el-descriptions>

        <template v-if="archive.renames.length">
          <el-divider content-position="left">标准种名调整历史</el-divider>
          <div v-for="(rename, index) in archive.renames" :key="index" class="rename-row">
            <el-tag size="small" type="info" effect="plain">{{ rename.fromCn }} · {{ rename.fromSci }}</el-tag>
            <span class="rename-arrow">→</span>
            <el-tag size="small" type="success" effect="plain">{{ rename.toCn }} · {{ rename.toSci }}</el-tag>
            <span class="rename-time">{{ formatDateTime(rename.changedAt) }}</span>
          </div>
        </template>

        <el-divider content-position="left">涉及环志记录（原字面保留，统计归并为「{{ archive.standardCn }}」）</el-divider>
        <el-empty v-if="archiveRecords.length === 0" description="暂无环志记录命中该归并" :image-size="60" />
        <el-table v-else :data="archiveRecords" size="small" border max-height="300">
          <el-table-column prop="ringNo" label="金属环号" width="110" />
          <el-table-column prop="speciesCn" label="原字面鸟种" width="110" />
          <el-table-column label="归并为" width="110">
            <template #default="scope">{{ resolveName(scope.row.speciesCn, speciesStore.merges) }}</template>
          </el-table-column>
          <el-table-column label="环志日期" width="110">
            <template #default="scope">{{ formatDate(scope.row.ringDate) }}</template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="80" />
          <el-table-column prop="ringer" label="环志人" width="90" />
          <el-table-column prop="remark" label="备注" show-overflow-tooltip />
        </el-table>
      </template>
      <template #footer>
        <el-button type="primary" @click="archiveId = null">关闭</el-button>
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
  margin: 0 0 12px;
  color: #6f8480;
  font-size: 13px;
}
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.stat-row {
  margin-bottom: 12px;
}
.stat-row .el-col {
  margin-bottom: 12px;
}
.block {
  border-radius: 8px;
}
.alias-tag {
  margin: 0 4px 2px 0;
}
.conflict-alert {
  margin-top: 8px;
}
.conflict-list {
  margin: 4px 0 0;
  padding-left: 18px;
}
.rename-form {
  margin-top: 12px;
}
.rename-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 13px;
}
.rename-arrow {
  color: #8a99a5;
}
.rename-time {
  margin-left: auto;
  color: #8a99a5;
  font-size: 12px;
}
</style>
