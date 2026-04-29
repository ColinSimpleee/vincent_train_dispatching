# Headway 项目总览

> 列车调度模拟器 —— 你是调度员，时刻表不会停。

本文档是项目的**人类可读总览**，定位介于：

- [`README.md`](../README.md)：快速上手 / 一页纸介绍
- [`CLAUDE.md`](../CLAUDE.md)：面向 AI 协作者的架构细节
- 本文档：项目背景、玩法、整体目录导航、当前阶段与里程碑

如果你是第一次接触这个项目，建议从这里开始。

---

## 1. 项目是什么

Headway 是一个基于 Vue 3 + TypeScript + 原生 SVG 的**实时铁路调度游戏**。

玩家扮演调度员，在一个车站的咽喉区域（道岔、信号、站台、入/出站口）内，控制：

- **道岔状态**（决定列车从分岔点走哪条线）
- **信号灯**（红/绿，控制是否放行）
- **接入 / 发车 / 停车** 三类指令

目标是把按时刻表抵达的列车，**安全 + 准点 + 高吞吐** 地送进站台、停靠、再发出去。

游戏核心张力来自：

- 列车以固定时间步长持续运行（60 ticks/秒，倍速 1×/2×/5×/10×）
- 同一时刻多列车并发，玩家必须并行决策
- 任何碰撞或两列车抢占同一区段都会立即判负

---

## 2. 技术栈

| 类别 | 选型 |
|------|------|
| 框架 | Vue 3.5（Composition API + `reactive`，未引入 Pinia store） |
| 语言 | TypeScript 5.9，严格类型，禁止 `any` |
| 构建 | Vite 7 + vue-tsc |
| 测试 | Vitest 4 + JSDOM + Vue Test Utils（含一个独立 fuzz 测试） |
| 渲染 | 原生 SVG，2400×600 画布，10 层堆叠 |
| 代码质量 | ESLint 9 + Prettier 3 |
| Node | `^20.19.0 || >=22.12.0` |

**没有引入**：Canvas/WebGL、状态管理库、UI 组件库、CSS 框架。整套渲染走 SVG + 响应式 ref，刻意保持极简。

---

## 3. 顶层目录导航

```
列车调度游戏v2.0/
├── src/                       # 应用代码（Vue 入口）
│   ├── App.vue                # 顶层视图、主循环、键盘监听
│   ├── main.ts                # Vue 应用挂载
│   ├── components/            # UI 组件
│   │   ├── StartScreen.vue    # 车站选择
│   │   ├── GameCanvas.vue     # SVG 主线路图
│   │   ├── ScheduleModal.vue  # 时刻表弹窗
│   │   ├── ReplayPanel.vue    # 回放控制面板
│   │   ├── Onboarding.vue     # 首次进入引导
│   │   ├── Toast.vue          # 顶部提示堆叠
│   │   └── panels/
│   │       ├── LeftPanel.vue  # 列车列表（队列 + 在途）
│   │       └── RightPanel.vue # 时钟 / 详情 / 指令 / 倍速
│   ├── core/                  # 物理引擎与数据模型（应用侧封装）
│   │   ├── PhysicsEngine.ts   # 5 阶段 tick 更新
│   │   ├── RailGraph.ts       # 节点 / 边 / 站台类型
│   │   ├── ScheduleManager.ts # 时刻表、列车生成、PRNG
│   │   ├── types.ts           # 列车、车型、状态枚举
│   │   ├── constants.ts       # 物理常数（CAR_PITCH、DWELL_TIME 等）
│   │   └── utils.ts           # BFS 路径、几何工具
│   ├── game/                  # 玩法层（事件、录制、回放）
│   │   ├── EventBus.ts        # 引擎事件流
│   │   ├── InputRecorder.ts   # 玩家输入录制
│   │   └── ReplayPlayer.ts    # 回放与分叉点定位
│   ├── composables/           # Vue 组合函数
│   ├── data/stations.ts       # 6 个车站的拓扑、时刻表
│   └── assets/                # 静态资源
│
├── packages/engine/           # 纯逻辑引擎包（与 Vue 解耦）
│   └── src/
│       ├── step.ts            # 单步推进入口
│       ├── phases/            # 拆分后的物理阶段
│       ├── adjacency.ts       # 轨道邻接关系
│       ├── invariants.ts      # 不变式校验
│       ├── prng.ts            # 可复现伪随机
│       ├── events.ts          # 事件类型
│       ├── constants.ts
│       ├── types.ts
│       └── index.ts
│
├── docs/
│   ├── CODING_STANDARDS.md    # 代码规范 SOP（必读）
│   └── PROJECT_OVERVIEW.md    # 本文件
│
├── public/                    # 公开静态资源
├── 图片/                      # 美术稿、参考图
├── 新需求文档/                # 产品需求草案
├── 日志/                      # 开发日志
├── claudedocs/                # AI 协作过程记录
├── README.md
├── CLAUDE.md
└── package.json
```

---

## 4. 架构关键点

### 4.1 双层引擎结构

历史上引擎逻辑只在 `src/core/PhysicsEngine.ts`。当前正在向**纯函数式独立引擎包**迁移：

- `packages/engine/`：纯 TypeScript，无 Vue 依赖，对外暴露 `step()` 单步推进入口
- `src/core/PhysicsEngine.ts`：现作为应用侧的薄封装/镜像层，逐步切换到 `packages/engine`

最近几次提交（`refactor: App.vue 切换到 packages/engine 的 step() 入口（镜像式集成）` 等）都在推进这件事。

### 4.2 主循环 & 时间步长

- 60 ticks/秒，`requestAnimationFrame` + 固定步长累加器
- 倍速通过**累加器增量**实现，不修改物理 dt（避免数值不稳定 / "死亡螺旋"）
- 每 tick 5 阶段：乘客逻辑 → 意图计算 → 碰撞检测 → 冲突解决 → 提交更新

### 4.3 数据模型

- **RailMap**：`nodes`（道岔/端点/连接器/车挡）+ `edges`（轨道区段，含贝塞尔控制点）+ `platforms`
- **TrainPhysics**：身份（车型/编组）、物理（位置/速度/方向）、导航（path/visitedPath）、乘客（BOARDING/READY）、时刻表（scheduledArriveTick/arrivalTick）
- 列车编号约定：偶数上行向右、奇数下行向左

### 4.4 渲染

SVG 10 层堆叠，从底到顶：站台 → 道床 → 钢轨 → 道岔高亮 → 控制圆点 → 车挡 → 信号灯 → 列车 → 发车按钮 → 键盘标签。每列车按 8 / 16 节车厢独立渲染，沿贝塞尔曲线插值定位与旋转。

### 4.5 回放系统

`game/InputRecorder` 记录所有玩家输入与初始 PRNG 种子，`ReplayPlayer` 根据 seed 复现完整局面，可定位分叉点。这要求**所有随机性必须走 `packages/engine/prng.ts`**，业务代码内不允许调用 `Math.random`。

---

## 5. 玩法速览

### 5.1 三类玩家指令

| 指令 | 触发 | 作用 |
|------|------|------|
| ADMIT（接入） | `Tab` 或按钮 | 把队列里的列车放进入口轨道 |
| DEPART（发车） | `Shift+G` 或按钮 | 让停靠中的列车出站，4 种策略（直接出站 / 终端折返 / 经出站轨道 / 兜底 BFS） |
| STOP（停车） | `Shift+A` 或按钮 | 强制停下当前列车 |

### 5.2 道岔与信号

- `1-9, 0`：从左到右切换道岔
- `Q-P`：从左到右切换信号灯
- `Space`：切换键盘 / 鼠标模式
- `↑↓`：选择列车
- `Shift+1/2/5/0`：1× / 2× / 5× / 10× 倍速
- `Shift+Space`：暂停

### 5.3 列车生命周期

队列 → ADMIT → 物理沿 path 运行 → 首次进站台自动停车（30–60 秒随机停留）→ DEPART → 越过出口 400 px 后标记为已移交 → 到达轨道终点后销毁。

---

## 6. 车站

定义在 `src/data/stations.ts`。CLAUDE.md 中列出 3 个，README 提到 6 个，迁移过程中以代码实际为准。

典型布局难度梯度：

| 类型 | 示例 | 特点 |
|------|------|------|
| 小型双岛 | stationSmall | 教学关 |
| 终端站 | stationTerminal | 阶梯道岔，支持折返 |
| 枢纽站 | stationHub | 多站台高吞吐 |

轨道命名约定（重要）：
- 入口：`e_entry_*` / `e_in`
- 咽喉：`e_*_t*`
- 站台：`t1` ~ `tN`
- 出站：`t*_out` / `e_exit` / `e_out`
- 折返：`t*_rev`（终端站专用）

---

## 7. 当前阶段与里程碑

从 `git log` 可见最近的工作集中在：

1. **引擎独立**：把物理逻辑从 Vue 项目里抽到 `packages/engine`
2. **PRNG 接入**：`ScheduleManager` 与 spawn 全部走可复现 PRNG
3. **事件总线**：`EventBus` 接入引擎事件流，支持导出
4. **回放闭环**：`InputRecorder` + `ReplayPanel` 完成完整 replay 包导出/载入

下一步可能的方向（推断，仅供参考）：

- 完成 `packages/engine` 的全量迁移并在 CI 中独立测试
- 多车站 / 关卡进度系统
- 难度曲线 / 评分系统正式化

---

## 8. 关键约束

### 8.1 编码

- 强制中文交流（含 commit、PR）
- 严格 TypeScript：禁止 `any`，明确接口
- Vue 组件 Props/Emits 必须类型化
- 函数单一职责、早返回、参数精简
- 提交粒度：**做一步提交一步**，避免"一坨"大 commit
- 详见 [`docs/CODING_STANDARDS.md`](./CODING_STANDARDS.md)

### 8.2 引擎

- 不允许在游戏逻辑中使用 `Math.random`，必须走 PRNG
- 物理状态变更必须通过 `commitUpdates` 阶段
- Ghost Mode：轨道占用 `occupiedBy` 仅用于碰撞检测，不阻止移动

---

## 9. 历史备注：旧目录 `headway-phase1-engine`

项目早期曾以英文目录名 `E:/headway-phase1-engine` 存在，phase1 引擎抽离阶段后整体迁入当前中文目录 `列车调度游戏v2.0`。旧目录内的源码已全部迁移完毕，只残留 Vite 自动生成的空缓存（`.vite/deps/`），已于 2026-04-29 清理删除。

如未来再看到 `headway-phase1-engine` 字样，对应的现行代码均在本仓库 `packages/engine/` 中。

---

## 10. 开发命令速查

```sh
npm install        # 安装依赖
npm run dev        # 启动开发服务器
npm run build      # 类型检查 + 生产构建
npm run test:unit  # 单元测试
npm run test:fuzz  # 长时 fuzz 测试（10 分钟超时）
npm run lint       # ESLint 自动修复
npm run format     # Prettier 格式化
npm run type-check # 仅类型检查

npx vitest run src/path/to/test.spec.ts   # 运行单个测试
```
