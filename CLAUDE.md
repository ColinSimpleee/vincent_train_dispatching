# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 代码规范

**重要**：编写代码前请先阅读 [代码规范 SOP](./docs/CODING_STANDARDS.md)，包含：

- TypeScript 类型规范（禁止 `any`，使用明确接口）
- Vue 组件规范（Props/Emits 类型定义）
- 函数设计原则（单一职责，早返回，参数精简）
- 代码简化原则（避免嵌套三元，优先清晰）
- 命名规范和代码审查清单

## 项目概述

列车调度模拟器 - 基于 Vue 3 + TypeScript 的交互式铁路调度游戏，玩家通过实时物理模拟控制列车在车站内的运行。

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

游戏以 60 ticks/秒 运行，使用 `requestAnimationFrame` 配合固定时间步长累加器模式（防止"死亡螺旋"）。`App.vue` 中的主循环协调：

1. **Tick 推进** - 虚拟游戏时间前进（支持 1x, 2x, 5x, 10x 倍速）
2. **队列管理** - 列车提前 5-10 分钟自动加入等待队列
3. **物理更新** - `PhysicsEngine.update()` 模拟所有列车移动
4. **状态同步** - Vue 响应式系统自动更新 UI

### 物理引擎 (`src/core/PhysicsEngine.ts`)

模拟核心，每个 tick 执行 4 阶段更新：

1. **乘客逻辑** - 跟踪上下客状态转换
2. **意图计算** - 计算列车移动意图（支持双向运行）
3. **碰撞检测** - 检测同一/相邻轨道上的列车物理碰撞
4. **冲突解决** - 解决竞争性移动意图
5. **提交更新** - 将验证后的状态变更应用到列车和轨道

关键常量：
- `CAR_PITCH = 30` - 车厢间距（单位长度）
- `DWELL_TIME = 1800-3600` ticks（30-60 秒停站时间）
- `BUFFER_TIME = 3600-5400` ticks（发车后 60-90 秒缓冲）
- `RESUME_SPEED = 60` 单位/秒

### 数据模型 (`src/core/RailGraph.ts`)

```
RailMap
├── nodes: Record<string, RailNode>    # 道岔/端点/连接器/车挡
├── edges: Record<string, RailEdge>    # 轨道区段（含占用状态）
└── platforms: PlatformZone[]          # 站台可视化定义

TrainPhysics
├── position/speed/direction           # 物理状态（direction: 1 正向, -1 反向）
├── path/visitedPath                   # 导航（BFS 计算路径）
├── passengerState                     # 'BOARDING' | 'READY'
└── boardingTimer/lastServicedEdgeId   # 站台停靠跟踪
```

### 道岔逻辑

- **分岔点 (Facing Point)**：列车离开道岔 → 根据 `switchState` 选择出路
- **汇入点 (Trailing Point)**：列车驶入道岔 → 忽略 `switchState`，直接通过

### 组件结构

```
App.vue                    # 游戏状态、主循环、列车生成
├── StartScreen.vue        # 车站选择界面
├── GameCanvas.vue         # SVG 渲染轨道、列车、信号
└── panels/
    ├── LeftPanel.vue      # 等待队列、在途列车列表
    └── RightPanel.vue     # 控制按钮、游戏倍速
```

### 列车生命周期

1. **队列** → 列车出现在等待列表（提前 5-10 分钟）
2. **接入 (ADMIT)** → 玩家将列车放入入口轨道
3. **运行** → 物理引擎沿路径移动列车
4. **站台停靠** → 自动停站，随机停留时间
5. **发车 (DEPART)** → 玩家下达出站命令，BFS 计算路径
6. **控制移交** → 列车越过出口轨道 400px 后移交控制权
7. **移除** → 列车到达轨道终点后删除

### 列车编号规则

- **偶数编号** (G2, G4, ...) → 上行/向右列车
- **奇数编号** (G1, G3, ...) → 下行/向左列车

## 车站数据 (`src/data/stations.ts`)

车站定义轨道拓扑（节点 + 边）、站台区域和难度等级。目前实现：
- 小型车站（4 站台，教学关卡）
- 枢纽车站（8 站台，复杂调度）

## 关键模式

- 所有游戏状态使用 Vue `reactive()` 实现 UI 自动更新
- 路径查找使用 BFS 算法（`findExitPath()`）
- SVG 坐标基于轨道边的 `control1/control2` 贝塞尔控制点计算
- 游戏时间为虚拟时间（随机起始 07:00-19:00，可调倍速）
