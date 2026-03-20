# 时刻表驱动列车生成 + 晚点扩散指示器 设计文档

## 概述

将列车生成从随机概率模式改为时刻表驱动模式，同时新增晚点扩散三角形指示器，让玩家清楚看到自己的调度操作对列车晚点的影响。

## 目标

1. 列车按时刻表出现在等待区，而非随机概率触发
2. 列车到达等待区前，早点/晚点状态持续变化（模拟区间运行不确定性）
3. 左侧面板准点文字后显示三角形指示器，反映玩家操作对晚点的影响
4. 时刻表数据为后续弹窗 UI 做好数据层准备

## 数据模型

### ScheduleEntry — 时刻表条目

```typescript
interface ScheduleEntry {
  id: string                    // 车次号，如 'G1234'
  direction: 'up' | 'down'     // 上行（偶数，向右）/ 下行（奇数，向左）
  model: TrainModel             // 车型
  line?: string                 // 线路标签（仅多线路车站）

  // 时刻（单位：tick）
  scheduledArriveTick: number   // 计划到站时刻
  scheduledStopDuration: number // 计划停站时长
  scheduledDepartTick: number   // 计划出站时刻（= arrive + stop）

  // 实际偏差（到达等待区前持续变化）
  currentDelay: number          // 当前延误 ticks（正=晚点，负=早点）

  // 交接追踪
  handoverDelay?: number        // 交接时刻（到达等待区）锁定的延误值
  reactionGraceTicks?: number   // 反应时间宽限（30~60秒 × 60 ticks）
  finalDelay?: number           // 出站时的最终延误

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

## 时刻表生成

### 配置（来自车站定义）

```typescript
interface ScheduleConfig {
  peakIntervalRange: [number, number]       // 高峰间隔，如 [2, 3] 分钟
  offPeakIntervalRange: [number, number]    // 低谷间隔，如 [6, 10] 分钟
  peakWindows: [number, number][]           // 高峰时段，如 [[7*60, 9*60], [17*60, 19*60]]（游戏分钟）
  lines?: string[]                          // 多线路车站的线路列表
  lineTrafficWeight?: Record<string, number> // 各线路流量权重
}
```

### 生成算法

1. 从 `startTick` 开始，根据当前是高峰/低谷选择间隔范围
2. 在间隔范围内随机取值，确定下一趟列车的计划到站时刻
3. 多线路车站：按权重分配线路标签，线路多的加更多车
4. 随机分配方向（上/下行）、车型、停站时长（30~60 秒）
5. 生成的条目加入 `scheduleEntries` 数组

### 滚动补充

调用 `ensureFutureSchedule(currentTick)` 保证未来 30 分钟（108000 ticks）的时刻表完整。主循环每 tick 调用。

## 延误模拟

对 `status === 'upcoming'` 的列车，每 tick 更新 `currentDelay`：

- **初始延误**：根据难度在 ±N ticks 范围内随机
- **逐 tick 微调**：小概率随机游走，幅度随难度增大
- **到达等待区**：当 `currentTick >= scheduledArriveTick + currentDelay` 时，`status` 变为 `'waiting'`，延误停止变化，`handoverDelay` 锁定为当前 `currentDelay`

## 反应时间宽限

### 基础宽限

```
基础宽限 = lerp(60秒, 30秒, 当前密度 / 最大密度)
```

- 高峰时段密度大 → 宽限短（30 秒）
- 低谷时段密度小 → 宽限长（60 秒）

### 自适应调节

- 维护"连续困难计数器"：列车出站时若 `delta > 0`（晚点扩散），计数 +1；否则清零
- 当计数 ≥ 8：宽限额外 +15 秒（上限封顶，比如最多额外 +30 秒）

## 与 App.vue 的交互

```
主循环每 tick:
  1. scheduleManager.ensureFutureSchedule(currentTick)  // 补充时刻表
  2. scheduleManager.updateDelays(currentTick)           // 更新 upcoming 列车延误
  3. scheduleManager.checkArrivals(currentTick)          // 到时间的列车 → waiting
  4. waitingQueue 从 scheduleManager 获取 waiting 状态的条目
```

替换现有 App.vue 中的随机概率队列补充逻辑（第 199-213 行）。

## 三角形晚点扩散指示器

### 显示位置

左侧面板 (LeftPanel.vue) 列车列表中，紧跟在准点文字后面。

### 计算逻辑

```
delta = 当前实际延误 - (交接延误 + 反应宽限)

if delta ≤ -1800 ticks (30秒):  绿色 ▲ 显示 "-X'"
if delta ≥ +1800 ticks (30秒):  红色 ▼ 显示 "+X'"
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
| `src/data/stations.ts` | 修改 | 各车站增加 scheduleConfig 配置 |
| `src/App.vue` | 修改 | 替换随机队列逻辑为 ScheduleManager 调用 |
| `src/components/panels/LeftPanel.vue` | 修改 | 新增三角形指示器渲染 |

## 未来扩展

- 时刻表弹窗 UI：直接消费 ScheduleManager 的 `scheduleEntries` 数据
- 积分系统：基于 `DelaySpread` 的 `delta` 值计算玩家得分
- 调度日志：在 ScheduleManager 中记录事件流
