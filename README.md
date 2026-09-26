# 鸟类环志记录与鸟点地图（gbbirdring）

面向环志站与鸟类监测志愿者：登记环志编号、鸟种与量度（喙/翅/尾/体重）、鸟点生境与调查批次，并在地图上查看鸟点分布。地图使用高德地图 JS API（key 走 `VITE_AMAP_KEY`），**未配置 key 时自动退化为本地 SVG 网格视图，构建与运行均不依赖该 key**。纯前端单页应用，数据全部保存在浏览器本地。

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21812>

停止并清理：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript（`<script setup>`） |
| 构建 | Vite 6（`npm run build` 含 `vue-tsc --noEmit` 类型检查） |
| UI | Element Plus 2 |
| 路由 | Vue Router 4（6 条业务路由 + 404） |
| 状态 | Pinia（ringStore / measureStore / siteStore / sessionStore / speciesStore） |
| 地图 | 高德地图 JS API（可选，按需动态加载）+ 本地 SVG 网格退化视图 |
| 存储 | IndexedDB（Dexie，库名 `gbbirdring-db`） |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 地图 key 说明（可选）

- 未配置 `VITE_AMAP_KEY`：`<SiteMap>` 渲染本地 SVG 网格视图，标记按生境配色落在对应格位，表单拾取坐标即落到格位中心；**构建与运行都不依赖该 key**。
- 配置后：`.env` 里填 `VITE_AMAP_KEY=<你的 key>`，再 `docker compose up -d --build`（compose 通过 build args 传入，Dockerfile 用 `ARG VITE_AMAP_KEY` 注入 Vite）。高德控制台需为该访问域名开启 JS API。

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21812
npm run build    # 类型检查 + 生产构建
```

## 目录结构

```
.
├── docker-compose.yml         # 顶层 name / COMPOSE_PROJECT_NAME 容器名 / 端口映射 / 可选 VITE_AMAP_KEY build arg
├── .env.example               # COMPOSE_PROJECT_NAME、FRONTEND_PORT、可选 VITE_AMAP_KEY
├── frontend/
│   ├── Dockerfile             # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf             # try_files SPA 回退 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/             # ring-record / morphometrics / bird-site / session / species-merge（+ ui.ts）
│       ├── stores/            # ringStore / measureStore / siteStore / sessionStore / speciesStore
│       ├── components/common/ # SiteMap / MeasureInput / RingCodeInput / SpeciesPicker / StatBadge / FilterBar / EmptyPanel
│       ├── hooks/             # useSiteFilter / useAmap
│       ├── pages/             # RingBoard / RingList / SpeciesMerge / MeasureEntry / SiteList / SessionList
│       ├── router/index.ts    # 路由表
│       └── utils/             # stats.ts / species-merge.ts / geo.ts / db.ts / export.ts（+ seed.ts / id.ts / plain.ts / format.ts）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 统计台 | 鸟种数、初捕/重捕比、鸟点分布图、鸟种计数与生境分布（鸟种按归并后的标准名汇总） |
| `/rings` | 环志记录 | 金属环号 + 彩环双段录入与自动查重，重复时提示并跳转历史记录；鸟种筛选与搜索按归并标准名命中别名记录 |
| `/species` | 鸟种归并 | 别名 / 简称归并到标准鸟种：选别名自动采用标准名与学名，冲突（别名被占 / 学名不一致 / 与现有别名冲突）保存不生效并指出冲突记录；调整标准名保留改名历史，统计按新名重算 |
| `/measure` | 量度测量 | 6 项量度带单位与范围校验，与同鸟种（归并后）历史均值比对给出偏离提示 |
| `/sites` | 鸟点台账 | 地图 / SVG 网格双模式切换，表单拾取坐标即时落点，点位间距提示 |
| `/sessions` | 调查批次 | 观测条件录入，关闭批次后统计鸟种数（按归并标准种计）、初捕数与重捕数 |

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbbirdring-db`），表：`rings`、`morphs`、`sites`、`sessions`、`merges`、`meta`。
- `db.version(1)` 建表声明索引；`db.version(2).upgrade(...)` 为环志表增加 `[speciesCn+ringDate]` 复合索引并回填历史彩环字段；`db.version(3)` 新增鸟种归并台账表 `merges`。升级前可用顶栏「导出备份」导出全量 JSON。
- 首次打开且表为空时写入示例数据（6 个鸟点、4 个调查批次、20 条环志记录与 14 条量度、2 条归并条目，其中 2 条环志记录按别名字面登记以演示归并）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。

## 鸟种归并说明

- 归并条目 = 标准中文名 + 标准学名 + 若干别名 / 简称；旧记录**保留原字面**不改库，统计台计数、量度均值、批次鸟种数与环志筛选先经归并视图（`canonicalRings`）再分组，即归到同一种。
- 鸟种选择器会列出别名选项（`别名 → 标准名`），志愿者选到别名时记录采用标准中文名与学名。
- 保存归并时校验：别名已归属其他鸟种、与现有别名 / 标准名冲突、学名与名录或历史记录不一致，任一命中则保存不生效，并在弹窗内逐条指出冲突（学名不一致会列出冲突环志记录的环号）。
- 调整标准种名：别名与历史记录保持归并，旧名记入改名历史（仍归并到本条目、可在档案中查到），统计按新名称重算；解除归并后统计按原字面拆回。
