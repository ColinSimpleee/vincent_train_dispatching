# Headway

> 列车调度模拟器 —— 你是调度员，时刻表不会停。

基于 Vue 3 + TypeScript + SVG 的实时铁路调度游戏。玩家通过道岔与信号控制列车在车站咽喉区域内进站、停靠、发车、移交，目标是 **安全 + 准点 + 吞吐**。

## 项目结构

```
src/
├── App.vue                 # 顶层视图、主循环、键盘监听
├── components/
│   ├── StartScreen.vue     # 开始页（车站选择）
│   ├── GameCanvas.vue      # 主线路图 SVG
│   ├── ScheduleModal.vue   # 时刻表弹窗
│   ├── Onboarding.vue      # 首次进入引导
│   ├── Toast.vue           # 顶部提示堆叠
│   └── panels/
│       ├── LeftPanel.vue   # 列车列表
│       └── RightPanel.vue  # 时钟 / 详情 / 指令 / 倍速
├── core/                   # 物理引擎、调度管理、类型定义
└── data/stations.ts        # 6 个车站的拓扑、时刻表配置
```

## 开发命令

```sh
npm install        # 安装依赖
npm run dev        # 启动开发服务器 (Vite)
npm run build      # 类型检查并构建生产版本
npm run test:unit  # 运行单元测试 (Vitest)
npm run lint       # ESLint 自动修复
npm run type-check # 仅类型检查 (vue-tsc)
```

Node 版本要求：`^20.19.0 || >=22.12.0`

## 进一步阅读

- 代码规范：[`docs/CODING_STANDARDS.md`](./docs/CODING_STANDARDS.md)
- 项目说明：[`CLAUDE.md`](./CLAUDE.md)
