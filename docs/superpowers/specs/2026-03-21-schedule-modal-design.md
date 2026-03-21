# 时刻表弹窗设计文档

## 概述

为列车调度游戏添加时刻表弹窗功能。弹窗覆盖游戏画面，显示时刻表、游戏时间、倍速控制和自定义内容窗口（调度日志 / 晚点扩散警告）。弹窗打开期间游戏不暂停，数据实时更新。

## 新增文件

| 文件 | 职责 |
|------|------|
| `src/components/ScheduleModal.vue` | 弹窗主组件，包含所有 UI 渲染和动画 |
| `src/composables/useDispatchLog.ts` | 调度日志数据管理（组合式函数）。项目首次引入 composables 目录，因为调度日志的生命周期跨越弹窗的打开/关闭，需要独立于弹窗组件管理 |

## 数据层

### 调度日志 `useDispatchLog.ts`

类型定义放在 `src/core/types.ts`（与现有 `ScheduleEntry` 等共享类型一致）：

```typescript
type DispatchEventType = 'admit' | 'depart' | 'stop' | 'platform_stop' | 'handover'

interface DispatchLogEntry {
  tick: number
  gameTime: string       // HH:MM:SS
  trainId: string
  event: DispatchEventType
}
```

- 由 App.vue 在执行玩家操作和系统事件时调用 `addLog()`
- 按时间降序存储（最新在上）
- 上限 200 条，超出移除最旧的

事件采集点（全部在 App.vue 中，不修改 PhysicsEngine）：
- **玩家操作**：在 `handleAction()` 函数中，执行 ADMIT / DEPART / STOP 成功后记录
- **进站停靠**：在主循环 `while` 中，检测列车 `passengerState` 从非 `BOARDING` 变为 `BOARDING` 时记录 `platform_stop`（需要在 `TrainPhysics` 上追加 `prevPassengerState` 临时字段，或在 App.vue 中维护一个 `Set<string>` 记录已触发过的列车 ID）
- **移交完成**：在 `processExitingTrains()` 中，`isHandedOver` 从 false 变为 true 时记录 `handover`（在设置 `isHandedOver = true` 之前检查旧值）

事件显示名映射：
- `admit` → "接入"
- `depart` → "发车"
- `stop` → "停车"
- `platform_stop` → "进站停靠"
- `handover` → "移交完成"

### 晚点扩散警告数据

在 App.vue 中预计算，通过 Props 传入弹窗（见下方 Props 设计）。

### 倍速与暂停统一

`gameSpeed` 从 `[1,2,5,10]` 扩展为 `[0,1,2,5,10]`。`gameSpeed === 0` 统一替代现有 `isPaused` 机制。

修改点：
- **废弃 `isPaused` ref**：统一用 `gameSpeed === 0` 表示暂停状态
- **键盘映射**：`Shift+Space` 改为切换 `gameSpeed` 在 0 和上次非零值之间（保留暂停/恢复体验）；`Shift+0` 保持为 10x（不变）
- App.vue 主循环：当 `gameSpeed === 0` 时累加器不增长
- RightPanel.vue 倍速按钮：从 `[1,2,5,10]` 改为 `[0,1,2,5,10]`（0 显示为 "||" 暂停图标）
- 弹窗内倍速控件使用 `← Nx →` 递增/递减方式，边界限制：0x 时左箭头置灰，10x 时右箭头置灰

## 弹窗组件 `ScheduleModal.vue`

### Props

弹窗为纯展示组件，所有数据在 App.vue 中预计算后传入：

```typescript
interface Props {
  visible: boolean
  gameTime: string
  gameSpeed: number
  currentTick: number
  dispatchLogs: DispatchLogEntry[]
  scheduleEntries: ScheduleEntry[]              // 已过滤排序的条目
  delaySpreadMap: Record<string, DelaySpread>    // key 为 entry.id，预计算的扩散数据
  trainStatusMap: Record<string, string>         // key 为 entry.id，列车当前状态文本
}
```

App.vue 中新增 computed：

```typescript
// 过滤：管制范围内 + 未来30分钟
const modalScheduleEntries = computed(() => {
  if (!scheduleManager.value) return []
  return scheduleManager.value.getAllEntries()
    .filter(e =>
      e.status === 'waiting' ||
      e.status === 'admitted' ||
      (e.status === 'upcoming' &&
       e.scheduledArriveTick + e.currentDelay <= tick.value + SCHEDULE_VISIBLE_WINDOW)
    )
    .sort((a, b) =>
      (a.scheduledArriveTick + a.currentDelay) - (b.scheduledArriveTick + b.currentDelay)
    )
})

// 预计算晚点扩散
const modalDelaySpreadMap = computed(() => {
  const map: Record<string, DelaySpread> = {}
  for (const entry of modalScheduleEntries.value) {
    if (entry.status === 'waiting' || entry.status === 'admitted') {
      map[entry.id] = scheduleManager.value!.computeDelaySpread(entry, tick.value)
    }
  }
  return map
})

// 列车状态文本映射
const modalTrainStatusMap = computed(() => {
  const map: Record<string, string> = {}
  for (const entry of modalScheduleEntries.value) {
    if (entry.status === 'waiting') {
      map[entry.id] = '等待区'
    } else if (entry.status === 'admitted') {
      const train = trains.find(t => t.scheduleEntryId === entry.id)
      if (!train) { map[entry.id] = '在站'; continue }
      const edgeId = train.currentEdgeId
      if (edgeId.includes('entry') || edgeId.includes('_in')) map[entry.id] = '进站'
      else if (edgeId.includes('out') || edgeId.includes('exit')) map[entry.id] = '正在出站'
      else map[entry.id] = '停站'
    }
  }
  return map
})
```

`SCHEDULE_VISIBLE_WINDOW` 常量定义在 `src/core/constants.ts`，值为 `30 * TICKS_PER_MINUTE`（复用已有常量，避免硬编码 30 分钟）。

### Emits

```typescript
interface Emits {
  (e: 'close'): void
  (e: 'speed-change', speed: number): void
}
```

### 布局（响应式，百分比/vw/vh）

```
.modal-overlay (全屏遮罩, backdrop-filter blur, rgba(0,0,0,0.3))
  .modal-container (弹窗主体, max-width: 75vw, max-height: 78vh)
    ├── .close-btn (红色×, hover时条件显示)
    ├── .main-area (flex布局)
    │   ├── .schedule-section (flex: 1, 左侧时刻表)
    │   │   ├── h2 "时刻表"
    │   │   ├── .table-wrapper (蓝色边框 #4A6FA5, 圆角 ~2vw)
    │   │   │   ├── thead (深蓝紫背景 #3D3D6B, 6列, 文字 #E0DAD9)
    │   │   │   └── tbody (动态行数, 文字 #000)
    │   │   └── .pagination (← 页码 →, 深蓝紫背景)
    │   └── .side-panel (~18%宽, 右侧)
    │       ├── .game-time (时钟, 背景 #E0DAD9, 圆角 ~3vw)
    │       ├── .speed-control (← Nx →, 文字 #E0DAD9)
    │       └── .custom-window (背景 #E0DAD9, 圆角 ~3vw)
    │           ├── .tab-title (标签标题)
    │           ├── .tab-content (调度日志 或 晚点扩散警告)
    │           └── .tab-switcher (← 标签名 →)
```

弹窗背景：蓝紫色渐变，从左上深蓝 #2A2A4A 到右下浅紫 #6B6BAA。

圆角（响应式）：
- 弹窗主体：~6vw（对应 2560px 下 154px）
- 白底区域：~3.1vw（对应 80px）
- 表格区域：~2vw（对应 50px）

字体：Exo 2 Bold Italic。通过 `@fontsource/exo-2` npm 包本地加载（不依赖外部 CDN），仅在弹窗组件内 scoped 使用。回退字体栈：`'Exo 2', 'Inter', 'Consolas', sans-serif`。

### 时刻表表格

#### 6 列定义

| 列 | 数据来源 | 显示逻辑 |
|---|---|---|
| 车次 | `entry.id` | 如 G1222 |
| 方向 | `entry.direction` | `up` → "上行"，`down` → "下行" |
| 进站时间 | `scheduledArriveTick + currentDelay` | 已到站显示实际时间；未到站前缀"预计：" |
| 停站时间 | `scheduledStopDuration` | 格式 `M'SS`（如 3'03） |
| 出站时间 | `scheduledDepartTick + currentDelay` | 已出站显示实际；未出站前缀"预计：" |
| 准点情况 | 见下方 | 区分 upcoming 和管制内列车 |

#### 准点情况列逻辑

| 状态 | 显示 |
|---|---|
| `upcoming` | `早点：N'` 或 `晚点：N'`（无▼） |
| `waiting` / `admitted` | 准点情况 + 扩散增量：`早点：2' ▼+3'`，▼和增量红色，从 `delaySpreadMap[entry.id]` 读取 |

#### 动态分页

```typescript
const ROW_HEIGHT = 35
const HEADER_HEIGHT = 40
// 用 VueUse 的 useResizeObserver 监听 .table-wrapper 高度（自动管理生命周期）
const rowsPerPage = computed(() =>
  Math.floor((tableHeight.value - HEADER_HEIGHT) / ROW_HEIGHT)
)
```

分页状态在弹窗关闭后保持（不重置），下次打开时恢复上次页码。若页码超出有效范围则自动回退到最后一页。

### 自定义窗口

两个标签页循环切换：`['调度日志', '晚点扩散警告']`

#### 调度日志

- 每条：`时间  车次  事件名`
- 按时间降序，最新在上
- 列表可滚动

#### 晚点扩散警告

从 `delaySpreadMap` 和 `trainStatusMap` 读取预计算数据。

**分组一：晚点已加剧**（红色 ⚠）
- 条件：`spread.level === 'worsened'`
- 显示：`车次(状态)  早/晚点 N'  ▼ +增量'`
- 状态文本从 `trainStatusMap[entry.id]` 读取

**分组二：晚点即将加剧**（黄色 ⚠）
- 条件：`spread.level === 'neutral'` 且 `spread.delta > 0`
- 显示：`车次(状态)  剩余时间：Ns`
- 剩余时间 = `(SPREAD_THRESHOLD - spread.delta)` 转换为秒，数值标黄

状态文本完整映射规则（基于列车 `currentEdgeId`）：
- `waiting` 状态 → "等待区"
- `admitted` + edgeId 包含 `entry` 或 `_in` → "进站"
- `admitted` + edgeId 包含 `out` 或 `exit` → "正在出站"
- `admitted` + 其他 edgeId → "停站"

### 动画

#### 打开（1.5s ease-out）

```css
from: transform: translateY(100vh) scale(0.3); opacity: 0
to:   transform: translateY(0) scale(1); opacity: 1
/* 背景同步 blur 过渡 */
```

#### 关闭（1.5s ease-in）

```css
from: transform: translateY(0) scale(1); opacity: 1
to:   transform: translateY(100vh) scale(0.3); opacity: 0
```

使用 Vue `<Transition>` 组件。

#### hover 关闭按钮

- `mouseenter`/`mouseleave` 追踪鼠标是否在 `.modal-container` 内
- 鼠标在弹窗外时：
  - 右上角 `border-top-right-radius` 从 ~6vw 变为 ~1.2vw，0.2s transition
  - 其余三角保持 ~6vw
  - 弹窗右上角外侧显示红色圆形 × 按钮（#FF3333 背景 + 白色叉号）
- 点击 × 或点击遮罩层均触发关闭

## App.vue 修改

### 新增状态

```typescript
const showScheduleModal = ref(false)
```

### 新增按钮

游戏界面右上角添加"时刻表"打开按钮（位于 MENU 栏附近）。

### 倍速扩展

```typescript
const SPEED_OPTIONS = [0, 1, 2, 5, 10] as const
```

废弃 `isPaused` ref，统一使用 `gameSpeed === 0` 表示暂停。新增 `lastNonZeroSpeed` ref 用于 `Shift+Space` 切换暂停/恢复。

主循环中 `gameSpeed === 0` 时 accumulator 不增长。

### 事件采集

使用 `useDispatchLog()` 组合式函数，在 App.vue 的 setup 中初始化。采集点见上方"事件采集点"章节。

## RightPanel.vue 修改

倍速按钮从 `[1,2,5,10]` 改为 `[0,1,2,5,10]`，0x 显示为暂停图标 "||"。

## constants.ts 新增

```typescript
export const SCHEDULE_VISIBLE_WINDOW = 30 * TICKS_PER_MINUTE  // 弹窗时刻表显示未来30分钟
```
