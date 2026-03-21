# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 语言要求

**强制**：所有交流必须使用中文，包括对话回复、commit 消息、PR 描述等。

## 代码规范

**重要**：编写代码前请先阅读 [代码规范 SOP](./docs/CODING_STANDARDS.md)，包含：

- TypeScript 类型规范（禁止 `any`，使用明确接口）
- Vue 组件规范（Props/Emits 类型定义）
- 函数设计原则（单一职责，早返回，参数精简）
- 代码简化原则（避免嵌套三元，优先清晰）
- 命名规范和代码审查清单

## 项目概述

列车调度模拟器 - 基于 Vue 3 + TypeScript 的交互式铁路调度游戏，玩家通过实时物理模拟控制列车在车站内的运行。

## 技术栈

- **运行时**: Vue 3.5 + Pinia（已引入但未使用 store）
- **构建**: Vite 7, TypeScript 5.9, vue-tsc
- **测试**: Vitest 4 + JSDOM + Vue Test Utils
- **代码质量**: ESLint 9 + Prettier 3
- **Node 要求**: ^20.19.0 || >=22.12.0

## 开发命令

```bash
npm run dev          # 启动开发服务器 (Vite)
npm run build        # 类型检查并构建生产版本
npm run test:unit    # 使用 Vitest 运行单元测试
npm run lint         # ESLint 检查并自动修复
npm run format       # Prettier 格式化代码
npm run type-check   # 仅运行 vue-tsc 类型检查
```

运行单个测试文件：
```bash
npx vitest run src/path/to/test.spec.ts
```

## 架构设计

### 游戏主循环

游戏以 60 ticks/秒 运行，使用 `requestAnimationFrame` 配合固定时间步长累加器模式（防止"死亡螺旋"）。倍速通过调整累加器增量实现（而非改变物理 dt）。`App.vue` 中的主循环协调：

1. **Tick 推进** - 虚拟游戏时间前进（支持 1x, 2x, 5x, 10x 倍速）
2. **队列管理** - 当队列 < 5 辆时自动补充，列车提前 5-10 分钟加入等待队列
3. **物理更新** - `PhysicsEngine.update()` 模拟所有列车移动
4. **出站处理** - 跟踪控制移交和列车移除
5. **状态同步** - Vue 响应式系统自动更新 UI

### 物理引擎 (`src/core/PhysicsEngine.ts`)

模拟核心，每个 tick 执行 5 阶段更新：

1. **乘客逻辑** (`handlePassengerLogic`) - 递减 `boardingTimer`，到期时 `passengerState` 从 `BOARDING` → `READY`
2. **意图计算** (`computeIntent`) - 计算列车移动意图，处理站台自动停车、信号遵守、恢复运行
3. **碰撞检测** (`detectPhysicalCollisions`) - 检测同轨道上的列车物理重叠
4. **冲突解决** (`resolveConflicts`) - 解决两列车同时抢占同一轨道的竞争条件
5. **提交更新** (`commitUpdates`) - 更新轨道占用、转移列车到新轨道、自动设定方向

碰撞或竞争条件触发 `triggerCollision()` → 游戏失败。

关键常量：
- `CAR_PITCH = 30` - 车厢间距（单位长度）
- `DWELL_TIME = 1800-3600` ticks（30-60 秒停站时间）
- `BUFFER_TIME = 3600-5400` ticks（发车后 60-90 秒缓冲）
- `RESUME_SPEED = 60` 单位/秒

**Ghost Mode**: 轨道占用 (`occupiedBy`) 被记录但不阻止移动，仅用碰撞检测保障安全。

### 数据模型

**类型定义** 分布在 `src/core/types.ts`（列车相关）和 `src/core/RailGraph.ts`（轨道相关）：

```
RailMap
├── nodes: Record<string, RailNode>    # 道岔/端点/连接器/车挡
│   ├── type: 'switch' | 'endpoint' | 'connector' | 'buffer_stop'
│   ├── switchState: number            # 当前激活的出边索引
│   └── signalState: 'red' | 'green'   # 信号灯状态
├── edges: Record<string, RailEdge>    # 轨道区段
│   ├── occupiedBy / isPlatform        # 占用状态、站台标记
│   └── control1 / control2            # 贝塞尔曲线控制点
└── platforms: PlatformZone[]          # 站台可视化定义

TrainPhysics
├── id / modelType / isCoupled         # 身份与外观
├── position / speed / direction       # 物理状态（direction: 1 正向, -1 反向）
├── state: 'moving' | 'stopped'        # 运动状态
├── path / visitedPath                 # 导航路径（visitedPath 保留最近 20 段用于尾部渲染）
├── passengerState                     # 'BOARDING' | 'READY'
├── boardingTimer / lastServicedEdgeId # 站台停靠跟踪（lastServicedEdgeId 防止重复停站）
├── isHandedOver                       # 越过出口 400px 后标记为已移交
└── scheduledArriveTick / arrivalTick  # 时刻表相关
```

**列车车型** (`TrainModel`): `'CR400AF'` | `'CR400BF'` | `'CRH380A'`

### 道岔逻辑

- **分岔点 (Facing Point)**：列车离开道岔 → 根据 `switchState` 索引选择出边
- **汇入点 (Trailing Point)**：列车驶入道岔 → 忽略 `switchState`，取第一个匹配候选边
- 道岔切换：`switchState = (current + 1) % numOutgoingEdges`

### 信号系统

- 信号灯位于节点上，状态为 `'red'` | `'green'`
- 红灯阻止列车在节点边界通过（检查下一个节点的信号）
- 红灯同时阻止停站列车恢复运行

### 组件结构

```
App.vue                    # 游戏状态、主循环、列车生成、发车逻辑（~950行）
├── StartScreen.vue        # 车站选择界面（卡片式，禁用无数据的车站）
├── GameCanvas.vue         # SVG 渲染（2400x600 画布），10层渲染顺序
└── panels/
    ├── LeftPanel.vue      # 合并显示等待队列 + 在途列车，含状态徽章和准点信息
    └── RightPanel.vue     # 时钟、选中列车信息、ADMIT/DEPART/STOP 按钮、倍速控制
```

**GameCanvas 渲染层级**（从底到顶）：站台 → 道床 → 钢轨 → 道岔高亮 → 控制圆点 → 车挡 → 信号灯 → 列车 → 发车按钮 → 键盘标签

**列车渲染**: 每列车渲染 8 或 16 节独立车厢，通过 `visitedPath` 回溯计算尾部车厢位置，沿贝塞尔曲线插值并计算旋转角度。车型配色：CR400AF 红色条纹、CR400BF 金色条纹、CRH380A 蓝色条纹。

### 列车生命周期

1. **队列** → 队列 < 5 时自动补充，提前 5-10 分钟出现在等待列表
2. **接入 (ADMIT)** → 玩家将列车放入入口轨道（入口 300px 内有车则阻止）
3. **运行** → 物理引擎沿 `path` 移动列车
4. **站台停靠** → 首次进入站台边自动停车（`lastServicedEdgeId` 防重复），随机停留 30-60 秒
5. **发车 (DEPART)** → 玩家下达出站命令，4 种处理策略：
   - 已在出站轨道 → 直接 BFS 到出口
   - 终端站折返 → 经 `t_rev` 轨道 180° 折返
   - 标准出站 → 移至 `t_out` 轨道后 BFS
   - 兜底 → 直接 BFS 到出口节点
6. **控制移交** → 列车越过出口轨道 400px + 半列车长后标记 `isHandedOver`
7. **移除** → 列车到达轨道终点（减 50px 缓冲）后从数组中删除

### 列车编号规则

- **偶数编号** (G2, G4, ...) → 上行/向右列车
- **奇数编号** (G1, G3, ...) → 下行/向左列车

### 键盘控制系统

通过 `Space` 键切换键盘/鼠标模式：

| 按键 | 功能 |
|------|------|
| `1-9, 0` | 切换道岔（从左到右排列） |
| `Q-P` | 切换信号灯（从左到右排列） |
| `Tab` | 接入列车 (ADMIT) |
| `Shift+G` | 发车 (DEPART) |
| `Shift+A` | 停车 (STOP) |
| `↑/↓` | 选择上/下一列车 |
| `Shift+Space` | 暂停/继续 |
| `Shift+1/2/5/0` | 设置倍速 1x/2x/5x/10x |

## 车站数据 (`src/data/stations.ts`)

车站定义轨道拓扑（节点 + 边）、站台区域和难度等级。目前实现 3 种：

| 车站 | 站台数 | 难度 | 特点 |
|------|--------|------|------|
| 小型车站 (stationSmall) | 4 | ★ | 双岛式布局，教学关卡 |
| 终端车站 (stationTerminal) | 4 | ★★★ | 阶梯式道岔，支持折返运行 |
| 枢纽车站 (stationHub) | 8 | ★★★★ | 占位符，当前复用小型车站数据 |

**轨道命名约定**：
- 入口：`e_entry_L`, `e_entry_R`, `e_in`
- 咽喉：`e_L_t1`, `e_R_in_t1`, `e_s1_t1`
- 站台：`t1`, `t2`, `t3`, `t4`
- 出站：`t1_out`, `e_exit`, `e_out`
- 折返：`t1_rev`（终端站专用）

## 关键模式

- 所有游戏状态使用 Vue `reactive()` 实现 UI 自动更新（未使用 Pinia store）
- 路径查找使用 BFS 算法（`findPath(startNodeId, targetNodeId, railMap)`）
- SVG 坐标基于轨道边的 `control1/control2` 贝塞尔控制点计算，无控制点时回退为直线
- 游戏时间为虚拟时间（随机起始 07:00-19:00，可调倍速）
- 列车方向在 `commitUpdates` 中根据下一条边的拓扑自动确定
