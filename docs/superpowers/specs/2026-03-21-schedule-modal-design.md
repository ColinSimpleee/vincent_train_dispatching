# 时刻表弹窗设计文档

## 概述

为列车调度游戏添加时刻表弹窗功能。弹窗覆盖游戏画面，显示时刻表、游戏时间、倍速控制和自定义内容窗口（调度日志 / 晚点扩散警告）。弹窗打开期间游戏不暂停，数据实时更新。

## 新增文件

| 文件 | 职责 |
|------|------|
| `src/components/ScheduleModal.vue` | 弹窗主组件，包含所有 UI 渲染和动画 |
| `src/composables/useDispatchLog.ts` | 调度日志数据管理（组合式函数） |

## 数据层

### 调度日志 `useDispatchLog.ts`

```typescript
interface DispatchLogEntry {
  tick: number
  gameTime: string       // HH:MM:SS
  trainId: string
  event: 'admit' | 'depart' | 'stop' | 'platform_stop' | 'handover'
}
```

- 由 App.vue 在执行玩家操作和系统事件时调用 `addLog()`
- 按时间降序存储（最新在上）
- 上限 200 条，超出移除最旧的

事件采集点（App.vue）：
- **玩家操作**：`handleAction('ADMIT')` / `handleAction('DEPART')` / `handleAction('STOP')` 时记录
- **系统事件**：列车首次停靠站台时记录 `platform_stop`；`isHandedOver` 变为 true 时记录 `handover`

事件显示名映射：
- `admit` → "接入"
- `depart` → "发车"
- `stop` → "停车"
- `platform_stop` → "进站停靠"
- `handover` → "移交完成"

### 晚点扩散警告数据

直接复用 `ScheduleManager.computeDelaySpread()`，在弹窗组件内实时计算。

### 倍速统一

`gameSpeed` 从 `[1,2,5,10]` 扩展为 `[0,1,2,5,10]`。`0` 等价于暂停。

修改点：
- App.vue 主循环：当 `gameSpeed === 0` 时累加器不增长
- RightPanel.vue 倍速按钮：从 `[1,2,5,10]` 改为 `[0,1,2,5,10]`（0 显示为暂停图标或 "0x"）
- 弹窗内倍速控件使用 `← Nx →` 递增/递减方式

## 弹窗组件 `ScheduleModal.vue`

### Props

```typescript
interface Props {
  visible: boolean
  gameTime: string
  gameSpeed: number
  currentTick: number
  dispatchLogs: DispatchLogEntry[]
  scheduleManager: ScheduleManager | null
}
```

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

字体：Exo 2 Bold Italic（全局）。

### 时刻表表格

#### 数据来源

从 `ScheduleManager.getAllEntries()` 过滤：

```typescript
const visibleEntries = computed(() => {
  const all = scheduleManager.getAllEntries()
  return all.filter(e =>
    e.status === 'waiting' ||
    e.status === 'admitted' ||
    (e.status === 'upcoming' &&
     e.scheduledArriveTick + e.currentDelay <= currentTick + 30 * TICKS_PER_MINUTE)
  ).sort((a, b) =>
    (a.scheduledArriveTick + a.currentDelay) - (b.scheduledArriveTick + b.currentDelay)
  )
})
```

显示范围：管制区域内的列车（waiting + admitted）+ 未来 30 分钟到达的（upcoming）。

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
| `waiting` / `admitted` | 准点情况 + 扩散增量：`早点：2' ▼+3'`，▼和增量红色，用 `computeDelaySpread()` |

#### 动态分页

```typescript
const ROW_HEIGHT = 35
const HEADER_HEIGHT = 40
// 用 ResizeObserver 监听 .table-wrapper 实际高度
const rowsPerPage = computed(() =>
  Math.floor((tableHeight.value - HEADER_HEIGHT) / ROW_HEIGHT)
)
```

页码变化时自动回退到有效范围。

### 自定义窗口

两个标签页循环切换：`['调度日志', '晚点扩散警告']`

#### 调度日志

- 每条：`时间  车次  事件名`
- 按时间降序，最新在上
- 列表可滚动

#### 晚点扩散警告

遍历 `waiting` + `admitted` 的 `ScheduleEntry`，调用 `computeDelaySpread()`。

**分组一：晚点已加剧**（红色 ⚠）
- 条件：`spread.level === 'worsened'`
- 显示：`车次(状态)  早/晚点 N'  ▼ +增量'`
- 状态映射：waiting → "等待区"，admitted → 根据列车实际位置显示"停站"/"正在出站"等

**分组二：晚点即将加剧**（黄色 ⚠）
- 条件：`spread.level === 'neutral'` 且 `spread.delta > 0`
- 显示：`车次(状态)  剩余时间：Ns`
- 剩余时间 = `(SPREAD_THRESHOLD - spread.delta)` 转换为秒，数值标黄

### 动画

#### 打开（1.5s ease-out）

```css
/* 进入 */
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

游戏界面右上角添加"时刻表"打开按钮。

### 倍速扩展

```typescript
const SPEED_OPTIONS = [0, 1, 2, 5, 10] as const
```

主循环中 `gameSpeed === 0` 时 accumulator 不增长（等价于暂停）。

### 事件采集

在 `handleAction()`、站台停靠逻辑、移交逻辑中调用 `dispatchLog.addLog()`。

## RightPanel.vue 修改

倍速按钮从 `[1,2,5,10]` 改为 `[0,1,2,5,10]`，0x 显示为暂停。
