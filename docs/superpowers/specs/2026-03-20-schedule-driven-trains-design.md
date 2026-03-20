# 时刻表驱动列车生成 + 晚点扩散指示器 设计文档

## 概述

将列车生成从随机概率模式改为时刻表驱动模式，同时新增晚点扩散三角形指示器，让玩家清楚看到自己的调度操作对列车晚点的影响。

## 目标

1. 列车按时刻表出现在等待区，而非随机概率触发
2. 列车到达等待区前，早点/晚点状态持续变化（模拟区间运行不确定性）
3. 左侧面板准点文字后显示三角形指示器，反映玩家操作对晚点的影响
4. 时刻表数据为后续弹窗 UI 做好数据层准备

## 数据模型

### 与现有类型系统的关系

现有代码中有两套类型系统：

1. **`src/core/types.ts`** — `Schedule`、`Train`、`Station` 等接口（基于早期设计，部分未在运行时使用）
2. **`src/core/RailGraph.ts`** — `TrainPhysics` 接口（运行时实际使用的列车物理状态）
3. **`src/App.vue`** — `QueuedTrain` 接口（等待队列中的列车）

迁移策略：

| 现有类型 | 处理方式 | 说明 |
|---------|---------|------|
| `QueuedTrain` (App.vue) | **替代** | 被 `ScheduleEntry` 完全取代，删除 `QueuedTrain` 接口 |
| `Schedule` (types.ts) | **保留** | 暂不改动，后续统一清理 |
| `Train` (types.ts) | **保留** | 暂不改动，后续统一清理 |
| `TrainPhysics` (RailGraph.ts) | **扩展** | 新增 `scheduleEntryId` 字段，关联回 `ScheduleEntry` |

### ScheduleEntry → TrainPhysics 字段映射

列车被 ADMIT 时，从 `ScheduleEntry` 拷贝到 `TrainPhysics` 的字段：

```
ScheduleEntry.id             → TrainPhysics.id
ScheduleEntry.model          → TrainPhysics.modelType
ScheduleEntry.direction      → TrainPhysics.direction (up=1, down=-1)
ScheduleEntry.id             → TrainPhysics.scheduleEntryId (新增，用于反查)
ScheduleEntry.scheduledArriveTick → TrainPhysics.scheduledArriveTick
```

ScheduleManager 通过 `scheduleEntryId` 查找对应条目，更新状态和计算 delta。

### ScheduleEntry — 时刻表条目

```typescript
interface ScheduleEntry {
  id: string                    // 车次号，如 'G1234'
  direction: 'up' | 'down'     // 上行（偶数，向右）/ 下行（奇数，向左）
  model: TrainModel             // 车型
  line?: string                 // 线路标签（仅多线路车站）

  // 时刻（单位：tick，1 tick = 1/60 秒）
  scheduledArriveTick: number   // 计划到站时刻
  scheduledStopDuration: number // 计划停站时长（1800-3600 ticks，即 30-60 秒）
  scheduledDepartTick: number   // 计划出站时刻（= arrive + stopDuration）

  // 实际偏差（到达等待区前持续变化，单位：ticks）
  currentDelay: number          // 当前延误（正=晚点，负=早点）

  // 交接追踪
  handoverDelay?: number        // 交接时刻（到达等待区）锁定的延误值
  handoverTick?: number         // 交接时刻的 tick（用于计算 delta 基准）
  reactionGraceTicks?: number   // 反应时间宽限（1800-3600 ticks，即 30-60 秒）
  finalDelay?: number           // 出站移交时的最终延误

  // 状态
  status: 'upcoming' | 'waiting' | 'admitted' | 'departed'
}
```

### DelaySpread — 晚点扩散结果

```typescript
interface DelaySpread {
  delta: number                 // 最终延误 - (交接延误 + 宽限)，单位 ticks
  level: 'improved' | 'neutral' | 'worsened'  // ≥30秒改善 | <30秒变化 | ≥30秒恶化
}
```

## 架构：集中式 ScheduleManager

新建 `src/core/ScheduleManager.ts`，独立于 App.vue，负责时刻表的生成、滚动补充和准点追踪。

### 选择理由

- App.vue 已约 950 行，不适合继续堆积逻辑
- 时刻表是独立的数据层概念，后续弹窗 UI 可直接消费
- 便于单元测试

### 公开 API

```typescript
class ScheduleManager {
  constructor(config: ScheduleConfig, startTick: number)

  // 主循环调用
  ensureFutureSchedule(currentTick: number): void
  updateDelays(currentTick: number): void
  checkArrivals(currentTick: number): void

  // 查询
  getWaitingEntries(): ScheduleEntry[]
  getEntryById(id: string): ScheduleEntry | undefined
  getAllEntries(): ScheduleEntry[]

  // 状态转移（由 App.vue 在对应操作时调用）
  markAdmitted(entryId: string, currentTick: number): void
  markDeparted(entryId: string, currentTick: number): void

  // 晚点扩散计算
  computeDelaySpread(entry: ScheduleEntry, currentTick: number): DelaySpread
}
```

## 时刻表生成

### 配置（来自车站定义）

```typescript
interface ScheduleConfig {
  peakIntervalRange: [number, number]       // 高峰间隔（分钟），如 [2, 3]
  offPeakIntervalRange: [number, number]    // 低谷间隔（分钟），如 [6, 10]
  peakWindows: [number, number][]           // 高峰时段（游戏分钟），如 [[420, 540], [1020, 1140]]
  directionRatio: number                    // 上行列车占比，如 0.5 表示均分，0.6 表示上行偏多
  lines?: string[]                          // 多线路车站的线路列表
  lineTrafficWeight?: Record<string, number> // 各线路流量权重
}
```

### 生成算法

1. 从 `startTick` 开始，根据当前是高峰/低谷选择间隔范围
2. 在间隔范围内随机取值，确定下一趟列车的计划到站时刻
3. 多线路车站：按权重分配线路标签，线路多的加更多车
4. 按 `directionRatio` 概率分配方向，偶数编号=上行，奇数编号=下行
5. 随机分配车型、停站时长（1800-3600 ticks）
6. 生成的条目加入 `scheduleEntries` 数组

### 滚动补充

调用 `ensureFutureSchedule(currentTick)` 保证未来 30 分钟（108000 ticks）的时刻表完整。

**节流策略**：记录上次生成的最后一条 entry 的 `scheduledArriveTick`，仅当该值距 `currentTick` 不足 108000 ticks 时才触发生成，避免每 tick 重复检查。

## 延误模拟

对 `status === 'upcoming'` 的列车，每 tick 更新 `currentDelay`。

### 具体参数

```
难度系数 difficulty: 1（小型站）~ 4（枢纽站）

初始延误: uniform(-difficulty * 1800, +difficulty * 1800)
  → 小型站: ±30秒，枢纽站: ±2分钟

每 tick 变化概率: 0.002
每次变化幅度: uniform(-30, +30) * difficulty
  → 小型站: ±0.5秒，枢纽站: ±2秒

延误上限: ±36000 ticks (±10 分钟)
```

### 到达等待区

当 `currentTick >= scheduledArriveTick + currentDelay` 时：
- `status` → `'waiting'`
- `handoverDelay` 锁定为当前 `currentDelay`
- `handoverTick` 记录为 `currentTick`
- 延误停止变化

## 反应时间宽限

### 基础宽限

```
基础宽限 = lerp(3600, 1800, 当前密度 / 最大密度)  // 单位 ticks（60秒~30秒）
```

- 高峰时段密度大 → 宽限短（1800 ticks = 30 秒）
- 低谷时段密度小 → 宽限长（3600 ticks = 60 秒）

### 自适应调节

- 维护"困难计数器"：列车出站时若 `delta > 0`（晚点扩散），计数 +1；否则 `count = max(0, count - 1)`（衰减而非直接清零）
- 当计数 ≥ 8：宽限额外 +900 ticks（15 秒），上限封顶额外 +1800 ticks（30 秒）

## 与 App.vue 的交互

### 主循环集成

```
主循环每 tick:
  1. scheduleManager.ensureFutureSchedule(currentTick)  // 内部节流，仅在需要时生成
  2. scheduleManager.updateDelays(currentTick)           // 更新 upcoming 列车延误
  3. scheduleManager.checkArrivals(currentTick)          // 到时间的列车 → waiting
  4. waitingQueue 从 scheduleManager.getWaitingEntries() 获取
```

替换现有 App.vue 中的随机概率队列补充逻辑（第 199-213 行）和 `QueuedTrain` 接口。

### 状态同步职责划分

| 状态转移 | 触发者 | 操作 |
|---------|--------|------|
| upcoming → waiting | ScheduleManager.checkArrivals() | 自动，到时间即转 |
| waiting → admitted | App.vue ADMIT 函数 | 调用 `scheduleManager.markAdmitted(id, tick)` |
| admitted → departed | App.vue 出站移交逻辑 | 调用 `scheduleManager.markDeparted(id, tick)` |

ScheduleManager **不持有** `TrainPhysics` 的引用。delta 计算所需的"当前实际延误"通过 `currentTick` 与 `scheduledDepartTick` 的差值推导，不依赖物理引擎状态。

## 三角形晚点扩散指示器

### 显示位置

左侧面板 (LeftPanel.vue) 列车列表中，紧跟在准点文字后面。

### 各状态下的 delta 计算公式

```
对于所有已交接（waiting/admitted/departed）的列车：

基准延误 = handoverDelay + reactionGraceTicks
当前延误 = currentTick - scheduledDepartTick  // 相对于计划出站时刻的偏差

delta = 当前延误 - 基准延误

对于 departed 状态：delta 使用 finalDelay 替代当前延误，固定不变
```

具体来说：
- **waiting 状态**：列车在等待区，玩家尚未接入。此时 `当前延误` 持续增长（因为列车在等待区每多待一个 tick，出站就会晚一个 tick）。宽限期内 delta 通常为负或接近零。
- **admitted 状态**：列车在站内运行/停靠。`当前延误` 取决于玩家调度效率。
- **departed 状态**：`delta = finalDelay - 基准延误`，固定值。

### 判定与显示

```
if delta ≤ -1800 ticks (30秒):  绿色 ▲ 显示 "-X'"（X 为分钟数）
if delta ≥ +1800 ticks (30秒):  红色 ▼ 显示 "+X'"（X 为分钟数）
if |delta| < 1800 ticks:        黄色 ▲ 不显示时间
```

### 显示示例

```
G1234  [停站中]   晚点 3' ▼+2'      红色，恶化了2分钟
G5678  [可出站]   准点 ▲-1'          绿色，改善了1分钟
D2046  [等待进站] 晚点 1' ▲          黄色，变化<30秒
```

### 显示时机

| 列车状态 | 三角形显示 |
|---------|-----------|
| upcoming（未到等待区） | 不显示 |
| waiting（等待区，含宽限期） | 显示，实时计算 |
| admitted（已接入运行中） | 实时更新 |
| departed（已出站移交） | 固定为最终结果 |

### 颜色

与现有准点显示颜色体系一致：
- 绿色 `#2ecc71` — 改善
- 红色 `#e74c3c` — 恶化
- 黄色 `#f1c40f` — 持平/微小变化

## 涉及文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/core/ScheduleManager.ts` | 新建 | 时刻表管理器核心逻辑 |
| `src/core/types.ts` | 修改 | 新增 ScheduleEntry、DelaySpread、ScheduleConfig 类型 |
| `src/core/RailGraph.ts` | 修改 | TrainPhysics 新增 `scheduleEntryId` 字段 |
| `src/data/stations.ts` | 修改 | 各车站增加 scheduleConfig 配置 |
| `src/App.vue` | 修改 | 删除 QueuedTrain 和随机队列逻辑，集成 ScheduleManager |
| `src/components/panels/LeftPanel.vue` | 修改 | 新增三角形指示器渲染，接收 ScheduleEntry 数据 |

## 关键测试场景

1. **时刻表生成** — 高峰/低谷切换时生成间隔是否在配置范围内
2. **延误随机游走** — 延误不超过 ±36000 ticks 上限
3. **状态转换** — upcoming → waiting 在正确的 tick 触发
4. **delta 计算** — 各种边界条件（宽限期内、刚好 30 秒阈值、departed 固定值）
5. **自适应宽限** — 困难计数器衰减和额外宽限封顶
6. **多线路权重** — 线路流量权重正确影响分配比例

## 未来扩展

- 时刻表弹窗 UI：直接消费 ScheduleManager 的 `scheduleEntries` 数据
- 积分系统：基于 `DelaySpread` 的 `delta` 值计算玩家得分
- 调度日志：在 ScheduleManager 中记录事件流
