# 代码规范 SOP (Standard Operating Procedure)

本文档定义了项目的代码编写规范和标准操作流程，确保代码质量、可维护性和一致性。

## 目录

1. [TypeScript 类型规范](#typescript-类型规范)
2. [Vue 组件规范](#vue-组件规范)
3. [函数设计规范](#函数设计规范)
4. [代码简化原则](#代码简化原则)
5. [命名规范](#命名规范)
6. [代码审查清单](#代码审查清单)

---

## TypeScript 类型规范

### 禁止使用 `any` 类型

```typescript
// ❌ 错误
function process(data: any): any { ... }
const items: any[] = [];

// ✅ 正确
function process(data: TrainPhysics): TrainStatus { ... }
const items: TrainPhysics[] = [];
```

### 定义明确的接口类型

为所有数据结构定义接口，特别是：
- Props 类型
- 事件参数
- API 响应
- 状态对象

```typescript
// ✅ 正确：定义明确的接口
interface QueuedTrain {
  id: string;
  schedule: { arriveTick: number };
  model: TrainModel;
}

interface TrainStatusInfo {
  status: string;
  statusColor: string;
  location: string;
  estimatedTime: string;
}
```

### 使用联合类型和字面量类型

```typescript
// ✅ 正确：使用字面量类型
type TrainModel = 'CR400AF' | 'CR400BF' | 'CRH380A';
type TrainState = 'moving' | 'stopped';
type Direction = 1 | -1;

// ✅ 正确：使用 as const 确保类型推断
const models = ['CR400AF', 'CR400BF', 'CRH380A'] as const;
```

### 空值处理

优先使用空值合并运算符 `??` 而非逻辑或 `||`：

```typescript
// ❌ 当值可能为 0 或空字符串时有问题
const value = input || defaultValue;

// ✅ 正确：只在 null/undefined 时使用默认值
const value = input ?? defaultValue;
const index = node.switchState ?? 0;
```

### 可选链和非空断言

```typescript
// ✅ 正确：使用可选链
const arriveTick = queueTrain.schedule?.arriveTick ?? 0;

// ✅ 正确：在确定非空时使用非空断言
const edge = getActiveEdge(node)!; // 仅当 v-if 已验证非空时
```

---

## Vue 组件规范

### Props 类型定义

```typescript
// ✅ 正确：使用 defineProps 泛型
const props = defineProps<{
  queue: QueuedTrain[];
  trains: TrainPhysics[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}>();
```

### Emits 类型定义

```typescript
// ✅ 正确：使用 defineEmits 泛型
const emit = defineEmits<{
  (e: 'train-action', payload: { id: string; action: string }): void;
  (e: 'select', id: string): void;
}>();
```

### Computed 属性返回类型

```typescript
// ✅ 正确：显式声明返回类型
const selectedTrain = computed((): TrainPhysics | null => {
  return trains.find(t => t.id === selectedId.value) ?? null;
});
```

### 安全的响应式数据访问

```typescript
// ✅ 正确：防御性访问
const safeEdges = computed(() => {
  if (!props.map?.edges) return [];
  return Object.values(props.map.edges).filter(Boolean);
});
```

---

## 函数设计规范

### 单一职责原则

每个函数只做一件事：

```typescript
// ❌ 错误：函数做太多事
function processTrainAndUpdateUI(train: TrainPhysics) {
  // 计算状态
  // 更新 UI
  // 发送事件
  // ...
}

// ✅ 正确：拆分为多个小函数
function getTrainStatus(train: TrainPhysics): TrainStatus { ... }
function updateTrainUI(status: TrainStatus): void { ... }
function emitTrainEvent(train: TrainPhysics): void { ... }
```

### 提取辅助函数

将重复逻辑提取为辅助函数：

```typescript
// ✅ 正确：提取辅助函数
function isEnteringEdge(edgeId: string): boolean {
  return edgeId.includes('entry') || edgeId.includes('_L_t');
}

function isExitingEdge(edgeId: string): boolean {
  return edgeId.includes('exit') || edgeId.includes('out');
}

function isPlatformEdge(edgeId: string): boolean {
  return /t\d+/.test(edgeId);
}
```

### 早返回模式

使用早返回减少嵌套：

```typescript
// ❌ 错误：深层嵌套
function processNode(node: RailNode | undefined) {
  if (node) {
    if (node.type === 'switch') {
      const edges = getOutgoingEdges(node.id);
      if (edges.length > 0) {
        // 处理逻辑
      }
    }
  }
}

// ✅ 正确：早返回
function processNode(node: RailNode | undefined) {
  if (!node) return;
  if (node.type !== 'switch') return;

  const edges = getOutgoingEdges(node.id);
  if (edges.length === 0) return;

  // 处理逻辑
}
```

### 参数精简

移除未使用的参数：

```typescript
// ❌ 错误：未使用的参数
function detectCollisions(trains: TrainPhysics[], _map: RailMap): void {
  // _map 从未使用
}

// ✅ 正确：移除未使用参数
function detectCollisions(trains: TrainPhysics[]): void {
  // ...
}
```

---

## 代码简化原则

### 避免嵌套三元运算符

```typescript
// ❌ 错误：嵌套三元难以阅读
const status = isMoving ? 'moving' : isPlatform ? 'stopped' : isExiting ? 'exiting' : 'unknown';

// ✅ 正确：使用 if-else 或 switch
function getStatus(): string {
  if (isMoving) return 'moving';
  if (isPlatform) return 'stopped';
  if (isExiting) return 'exiting';
  return 'unknown';
}
```

### 使用 switch 替代多重 if-else

```typescript
// ✅ 正确：switch 更清晰
switch (action) {
  case 'ADMIT':
    handleAdmit();
    break;
  case 'DEPART':
    handleDepart();
    break;
  default:
    console.warn('Unknown action:', action);
}
```

### 优先清晰而非简洁

```typescript
// ❌ 过度简洁，难以理解
const r = t.s === 'm' && t.p > 0 ? calcD(t) : t.s === 's' ? 0 : -1;

// ✅ 清晰易读
function getTrainResult(train: TrainPhysics): number {
  if (train.state === 'moving' && train.position > 0) {
    return calculateDistance(train);
  }
  if (train.state === 'stopped') {
    return 0;
  }
  return -1;
}
```

### 消除冗余代码

```typescript
// ❌ 冗余的 try-catch（当错误不可能发生时）
const safeNodes = computed(() => {
  try {
    return Object.values(props.map.nodes);
  } catch {
    return [];
  }
});

// ✅ 简化：使用防御性访问
const safeNodes = computed(() => {
  if (!props.map?.nodes) return [];
  return Object.values(props.map.nodes).filter(Boolean);
});
```

---

## 命名规范

### 变量和函数

| 类型 | 规范 | 示例 |
|------|------|------|
| 变量 | camelCase | `trainSpeed`, `currentEdgeId` |
| 函数 | camelCase, 动词开头 | `getTrainStatus()`, `calculateDistance()` |
| 布尔变量 | is/has/can 前缀 | `isMoving`, `hasPath`, `canDepart` |
| 常量 | UPPER_SNAKE_CASE | `TICKS_PER_SECOND`, `CAR_PITCH` |

### 类型和接口

| 类型 | 规范 | 示例 |
|------|------|------|
| 接口 | PascalCase | `TrainPhysics`, `RailNode` |
| 类型别名 | PascalCase | `TrainModel`, `Direction` |
| 泛型参数 | 单字母大写 | `T`, `K`, `V` |

### 文件命名

| 类型 | 规范 | 示例 |
|------|------|------|
| Vue 组件 | PascalCase | `GameCanvas.vue`, `LeftPanel.vue` |
| TypeScript 模块 | PascalCase | `PhysicsEngine.ts`, `RailGraph.ts` |
| 类型定义 | camelCase 或 PascalCase | `types.ts`, `RailGraph.ts` |

---

## 代码审查清单

### 提交前检查

```bash
# 1. 类型检查
npm run type-check

# 2. Lint 检查
npm run lint

# 3. 构建测试
npm run build

# 4. 单元测试（如有）
npm run test:unit
```

### 代码审查要点

- [ ] **类型安全**：无 `any` 类型，所有函数有明确的参数和返回类型
- [ ] **空值处理**：使用 `??` 而非 `||`，正确处理可能为空的值
- [ ] **函数设计**：单一职责，无未使用参数，早返回模式
- [ ] **代码清晰**：无嵌套三元，无过度简洁的代码
- [ ] **命名规范**：遵循命名约定，变量名有描述性
- [ ] **Vue 规范**：Props/Emits 有类型定义，Computed 有返回类型
- [ ] **无冗余**：移除未使用的导入、变量、函数

### 常见问题修复示例

| 问题 | 修复方式 |
|------|---------|
| `Unexpected any` | 定义具体接口或类型 |
| `'x' is defined but never used` | 移除未使用的变量/参数 |
| `Type 'X \| null' is not assignable to type 'X'` | 添加空值检查或使用 `!` 断言 |
| `Type 'undefined' is not assignable` | 使用 `??` 提供默认值 |

---

## 工具配置

### ESLint 规则

项目使用以下关键 ESLint 规则：

```javascript
{
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-unused-vars": "error",
  "@typescript-eslint/explicit-function-return-type": "warn"
}
```

### VS Code 推荐设置

```json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

---

## 参考资源

- [TypeScript 官方文档](https://www.typescriptlang.org/docs/)
- [Vue 3 风格指南](https://vuejs.org/style-guide/)
- [ESLint TypeScript 规则](https://typescript-eslint.io/rules/)
