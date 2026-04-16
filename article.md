# 深度拆解 Notion 架构：从后端视角手撸一个协作文档系统

> 本文从后端开发者视角，深度剖析 Notion 的核心技术架构——Block 数据模型、分库分表、Operation 操作日志、WebSocket 协作、AI 集成，并手把手实现一个可运行的 Demo（附完整源码）。不讲废话，直接上干货。

---

## 一、Notion 凭什么能撑起亿级文档？

Notion 看似只是一个"好用的笔记工具"，但它的后端架构设计远比你想象的复杂。它彻底抛弃了传统的"一个文档存一条记录"的思路，转而采用了一套**原子化的 Block 存储架构**。

当你打开一个 Notion 页面时，浏览器拿到的不是一个 HTML 或 Markdown 文件，而是一组从数据库中 `SELECT` 出来的结构化数据行。

核心设计原则：

| 原则 | 说明 |
| --- | --- |
| Everything is a Block | 标题、段落、代码块、甚至页面本身都是 Block |
| 树形结构 | Block 之间通过 `parent_id` 形成树状嵌套 |
| 操作驱动 | 每次编辑产生 Operation，而非覆盖整个文档 |
| 水平扩展 | 按 `space_id`（工作区）分库分表 |

本文会**逐一拆解**这些设计，并通过代码实现让你真正理解。

---

## 二、数据模型：一切皆 Block

### 2.1 Block 表设计

这是 Notion 最核心的一张表。在真实 Notion 中，这是一张按 `space_id` 做水平拆分（Sharding）的 PostgreSQL 表：

```sql
CREATE TABLE blocks (
    id          UUID PRIMARY KEY,
    type        VARCHAR(50) NOT NULL,    -- 'page' | 'paragraph' | 'heading1' | 'code' | ...
    parent_id   UUID REFERENCES blocks(id),  -- 父 Block ID，构成树形结构
    space_id    UUID NOT NULL,           -- 工作区 ID，分库分表的 sharding key
    content     JSONB,                   -- 文本内容
    properties  JSONB DEFAULT '{}',      -- 扩展属性（如 todo 的 checked、code 的 language）
    version     INTEGER DEFAULT 1,       -- 乐观锁版本号，每次修改自增
    position    FLOAT DEFAULT 0,         -- 排序权重（分数排序法）
    alive       BOOLEAN DEFAULT TRUE,    -- 软删除标记（支持回收站）
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    created_by  UUID
);

-- 核心索引：按父节点查子节点，这是最频繁的查询
CREATE INDEX idx_blocks_parent ON blocks(parent_id, position);
-- 分片索引：按工作区定位数据在哪个分片
CREATE INDEX idx_blocks_space  ON blocks(space_id);
```

**关键设计决策解读：**

**1) Page 也是 Block**

```
Space (space-001)
 └── Page Block (type='page', parent_id=null)
      ├── Heading Block (type='heading1', parent_id='page-id')
      ├── Paragraph Block (type='paragraph', parent_id='page-id')
      ├── Code Block (type='code', parent_id='page-id')
      └── Sub-Page Block (type='page', parent_id='page-id')  ← 子页面！
           ├── ...
```

这意味着"创建子页面"在数据库层面只是 `INSERT INTO blocks (type, parent_id) VALUES ('page', '父页面ID')`。无限嵌套的文档结构天然形成。

**2) position 用浮点数而非整数**

为什么不用 `1, 2, 3, 4` 这样的整数排序？因为在两个 Block 之间插入时，整数需要更新后面所有行的 position：

```
-- 整数排序：在 pos=2 和 pos=3 之间插入，需要更新 3, 4, 5... 全部 +1
UPDATE blocks SET position = position + 1 WHERE parent_id = ? AND position >= 3;

-- 浮点排序：直接取中间值 2.5，零额外更新
INSERT INTO blocks (position) VALUES (2.5);
```

这就是**分数排序法（Fractional Indexing）**。当精度不够时（极端场景），才做一次全量重排。

我们的 Demo 中对应的实现：

```javascript
// server/index.js
function generatePosition(afterPos, beforePos) {
    if (afterPos == null && beforePos == null) return 1.0;
    if (afterPos == null) return beforePos - 1.0;
    if (beforePos == null) return afterPos + 1.0;
    return (afterPos + beforePos) / 2;  // 取中间值
}
```

**3) 软删除 `alive` 字段**

Notion 不做物理删除。`DELETE` 操作实际上是 `UPDATE blocks SET alive = false`。好处：

- 支持"回收站"功能：`SELECT * FROM blocks WHERE alive = false AND space_id = ?`
- 支持误操作恢复
- 不破坏 `parent_id` 的引用完整性

```javascript
// 我们的实现
app.delete('/api/documents/:id', (req, res) => {
    const page = blockStore.get(req.params.id);
    page.alive = false;  // 软删除，不是 blockStore.delete()
    // 级联软删除所有子 Block
    getChildBlocks(page.id).forEach(child => { child.alive = false; });
});
```

### 2.2 为什么一定要拆成 Block？

你可能会问：直接存一个大 JSON 或 Markdown 不行吗？答案是**完全不行**，原因有三：

**协作冲突粒度**：如果 A 改第一段，B 改第十段，两人修改的是不同的 `block_id`，在数据库层面完全不冲突。如果是整篇文档存一个字段，两人同时修改就必须做复杂的文本合并。

**精细化权限**：理论上可以对单个 Block 设置权限（Notion 目前在 Page 级别，但架构已预留）。

**按需加载**：一个 10 万字的文档不需要一次性加载。只查 `WHERE parent_id = ? LIMIT 50` 就能做到分页：

```sql
-- 首屏：加载前 50 个 Block
SELECT * FROM blocks 
WHERE parent_id = 'page-001' AND alive = true 
ORDER BY position ASC 
LIMIT 50;

-- 滚动加载：从上次最后一个 position 继续
SELECT * FROM blocks 
WHERE parent_id = 'page-001' AND alive = true AND position > 50.0
ORDER BY position ASC 
LIMIT 50;
```

---

## 三、存储架构：分库分表 + 分布式 ID

### 3.1 按 Space 分片

Notion 的用户量决定了单库扛不住。分片策略是**按 `space_id`（工作区）进行水平拆分**：

```
                    ┌──────────────┐
                    │   Router     │  ← 根据 space_id 路由到对应分片
                    └──────┬───────┘
               ┌───────────┼───────────┐
               ▼           ▼           ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Shard 0  │ │ Shard 1  │ │ Shard 2  │
        │ PG 实例  │ │ PG 实例  │ │ PG 实例  │
        │ space    │ │ space    │ │ space    │
        │ 0-999    │ │ 1000-1999│ │ 2000-2999│
        └──────────┘ └──────────┘ └──────────┘
```

同一个团队的所有 Block 落在同一个分片上，保证查询不跨库。

### 3.2 分布式 ID 生成

Block ID 使用类似 **Snowflake** 的算法：

```
┌────────────┬──────────┬───────────┬──────────┐
│  1 bit     │ 41 bits  │  5 bits   │ 12 bits  │
│  符号位    │ 时间戳   │  机器 ID  │  序列号  │
└────────────┴──────────┴───────────┴──────────┘
```

- 时间有序：ID 天然按创建时间排列
- 不重复：分布式环境下保证唯一
- 高性能：纯内存计算，不依赖数据库

我们的 Demo 用 UUID 简化，但原理相同。

---

## 四、操作日志：Operation 驱动的编辑模型

### 4.1 什么是 Operation？

这是 Notion 协作的基石。**每一次编辑不是"覆盖文档"，而是产生一条操作记录**：

```sql
CREATE TABLE operations (
    id         BIGSERIAL PRIMARY KEY,
    block_id   UUID NOT NULL,
    user_id    UUID NOT NULL,
    type       VARCHAR(50),        -- 'update' | 'create' | 'delete' | 'reorder'
    path       TEXT[],              -- 修改路径: ['content'] 或 ['properties', 'checked']
    args       JSONB,              -- 操作参数: {"value": "新内容"}
    version    INTEGER,            -- 操作后的版本号
    timestamp  TIMESTAMPTZ DEFAULT NOW()
);
```

当你在 Notion 中修改一段文字时，前端发出的不是"把文档内容替换为 XXX"，而是：

```json
{
    "type": "update",
    "block_id": "abc-123",
    "path": ["content"],
    "args": {"value": "修改后的文字"},
    "version": 5
}
```

### 4.2 Operation 的三大用途

**1) 实时协作同步**

```
  用户 A 编辑                     服务端                        用户 B
    │                              │                              │
    │  Operation: update           │                              │
    │  {block: "b1",               │                              │
    │   content: "hello"}          │                              │
    ├─────────────────────────────→│                              │
    │                              │  广播 Operation               │
    │                              ├─────────────────────────────→│
    │                              │                 应用 Operation│
    │                              │                 更新本地 Block│
```

**2) Undo/Redo**

操作日志就是一条天然的操作栈。撤销 = 回放反向操作。

**3) 页面历史**

通过操作日志可以重建任意时间点的文档状态。同时 Notion 会定期将完整页面状态快照到 S3：

```javascript
// 我们的快照实现
function saveSnapshot(pageId) {
    const children = getChildBlocks(pageId);
    const page = blockStore.get(pageId);
    snapshots.get(pageId).push({
        version: page.version,
        timestamp: new Date().toISOString(),
        blocks: children.map(b => ({ id: b.id, type: b.type, content: b.content })),
    });
}
```

### 4.3 版本号与乐观锁

每个 Block 维护一个 `version` 字段。更新时版本号自增：

```javascript
socket.on('block-update', ({ docId, block }) => {
    const record = blockStore.get(block.id);
    if (record && record.alive) {
        record.content = block.content;
        record.version++;  // 版本号自增
        record.updated_at = new Date().toISOString();

        // 记录 Operation
        recordOperation(block.id, userId, 'update', ['content'], {
            value: block.content,
        }, record.version);
    }
    // 广播给其他用户
    socket.to(docId).emit('block-updated', { block });
});
```

在生产环境中，这个版本号还用于**乐观锁冲突检测**：

```sql
-- 只有版本号匹配时才允许更新
UPDATE blocks SET content = ?, version = version + 1
WHERE id = ? AND version = ?;
-- 如果受影响行数 = 0，说明有冲突
```

---

## 五、实时协作：WebSocket + Room

### 5.1 架构设计

```
  ┌──────────┐                  ┌──────────────┐                ┌──────────┐
  │ 客户端 A │◄────WebSocket───►│   服务端      │◄───WebSocket──►│ 客户端 B │
  │ React    │                  │ Socket.IO    │                │ React    │
  │ 文档:d1  │                  │              │                │ 文档:d1  │
  └──────────┘                  │  ┌─────────┐ │                └──────────┘
                                │  │ Room:d1 │ │
                                │  │ A, B    │ │
  ┌──────────┐                  │  └─────────┘ │
  │ 客户端 C │◄────WebSocket───►│  ┌─────────┐ │
  │ 文档:d2  │                  │  │ Room:d2 │ │
  └──────────┘                  │  │ C       │ │
                                │  └─────────┘ │
                                └──────────────┘
```

Socket.IO 的 Room 机制天然对应"同一文档的编辑者"。每个用户加入文档时自动进入对应的 Room。

### 5.2 事件协议

| 事件 | 方向 | 说明 |
| --- | --- | --- |
| `join-document` | 客户端→服务端 | 加入文档编辑房间 |
| `users-update` | 服务端→客户端 | 在线用户列表变更 |
| `block-update` | 客户端→服务端 | 修改 Block 内容 |
| `block-updated` | 服务端→客户端 | 广播 Block 变更 |
| `block-add` | 客户端→服务端 | 新增 Block |
| `block-delete` | 客户端→服务端 | 删除 Block |
| `cursor-update` | 客户端→服务端 | 光标位置同步 |
| `cursor-updated` | 服务端→客户端 | 广播光标位置 |

### 5.3 客户端协作 Hook

```javascript
// src/hooks/useCollaboration.js
export function useCollaboration(docId) {
    const socketRef = useRef(null);
    const [onlineUsers, setOnlineUsers] = useState([]);

    useEffect(() => {
        const socket = io(window.location.origin);
        socketRef.current = socket;

        socket.on('connect', () => {
            socket.emit('join-document', { docId, userName });
        });

        // 监听远程 Block 变更 → 更新本地状态
        socket.on('block-updated', ({ block }) => {
            onBlockUpdated.current?.(block);
        });

        // 监听在线用户变更
        socket.on('users-update', setOnlineUsers);

        return () => socket.disconnect();
    }, [docId]);

    // 本地编辑 → 发送给服务端
    const emitBlockUpdate = (block) => {
        socketRef.current?.emit('block-update', { docId, block });
    };

    return { onlineUsers, emitBlockUpdate, ... };
}
```

**关键设计：乐观更新（Optimistic Update）**

```
用户输入 "hello"
    │
    ├──→ 1. 立即更新本地 UI（用户无感延迟）
    │
    └──→ 2. 异步发送 Operation 到服务端
              │
              └──→ 3. 服务端广播给其他用户
```

本地先改 UI，再同步到服务端。这就是为什么 Notion 编辑时感觉"毫无延迟"——因为你看到的变化是本地先行的。

### 5.4 冲突处理方案对比

| 方案 | 思路 | 代表产品 | 复杂度 |
| --- | --- | --- | --- |
| Last Write Wins | 最后写入者覆盖 | 我们的 Demo | ⭐ |
| OT | 将编辑拆为原子操作并变换 | Google Docs | ⭐⭐⭐⭐ |
| CRDT | 数据结构保证最终一致 | Figma, Notion | ⭐⭐⭐⭐⭐ |

**CRDT（Conflict-free Replicated Data Type）的核心思想**：

```
用户 A: 在位置 3 插入 "hello"  → 生成操作 Op_A
用户 B: 在位置 5 删除 2 字符  → 生成操作 Op_B

无论 Op_A 和 Op_B 以什么顺序到达：
  apply(state, Op_A, Op_B) === apply(state, Op_B, Op_A)

CRDT 数据结构本身保证了这种交换律
```

生产级方案推荐使用 **Y.js** 或 **Automerge** 库，它们提供了开箱即用的 CRDT 实现。

---

## 六、AI 集成：从输入到输出的全链路

### 6.1 设计思路

AI 不是独立模块，而是**嵌入编辑流程**：

```
用户在编辑器中输入 /ai
    │
    ▼
弹出 AI 面板（前端组件）
    │
    ▼
用户输入提示词，如 "帮我续写"
    │
    ▼
前端 POST /api/ai/generate
    ├── prompt: "帮我续写"
    └── context: "前 2000 字的文档内容"  ← 提供上下文给 LLM
    │
    ▼
服务端调用 OpenAI API（兼容格式）
    ├── System Prompt: "你是文档编辑器中的写作助手..."
    ├── User Message 1: 文档上下文
    └── User Message 2: 用户指令
    │
    ▼
返回生成内容 → 用户预览 → 一键插入为 Block
```

### 6.2 后端 AI 服务

```javascript
// server/ai.js
export async function handleAIRequest(prompt, context) {
    // 无 API Key 时使用模拟响应（Demo 开箱即用）
    if (!AI_API_KEY || AI_API_KEY === 'your-api-key-here') {
        return getMockResponse(prompt);
    }

    const messages = [
        { role: 'system', content: '你是文档编辑器中的写作助手...' },
        { role: 'user', content: `当前文档上下文：\n${context}` },
        { role: 'user', content: prompt },
    ];

    const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${AI_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: AI_MODEL, messages, max_tokens: 1024 }),
    });

    const data = await response.json();
    return data.choices[0].message.content;
}
```

支持任何兼容 OpenAI API 格式的服务（DeepSeek、通义千问、本地 Ollama 等），只需修改 `.env`：

```bash
AI_API_KEY=sk-xxx
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat
```

### 6.3 AI 内容智能转 Block

AI 返回的是纯文本，前端会做简单的 Markdown 解析自动转为对应的 Block 类型：

```javascript
const handleAIInsert = (content) => {
    const lines = content.split('\n').filter(l => l.trim());
    lines.forEach(line => {
        let type = 'paragraph', text = line;
        if (line.startsWith('# '))       { type = 'heading1'; text = line.slice(2); }
        else if (line.startsWith('## '))  { type = 'heading2'; text = line.slice(3); }
        else if (line.startsWith('- '))   { type = 'bulleted_list'; text = line.slice(2); }
        else if (/^\d+\.\s/.test(line))   { type = 'numbered_list'; ... }
        onBlockAdd(lastBlockId, type, text);
    });
};
```

---

## 七、前端核心：Block 编辑器

### 7.1 Block 组件架构

```
┌─────────────────────────────────────────────────┐
│  Block Wrapper（hover 时显示操作手柄）            │
│  ┌─────┐  ┌────────────────────────────────┐   │
│  │ ⊕   │  │  contentEditable（普通文本）     │   │
│  │ ⠿⠿  │  │  或 textarea（代码块）          │   │
│  │ 点击 │  │                                │   │
│  │ 弹出 │  │  支持键盘事件：                  │   │
│  │ 菜单 │  │  Enter → 新建 Block            │   │
│  └─────┘  │  Backspace → 删除空 Block       │   │
│            │  / → 打开斜杠命令菜单            │   │
│            │  ↑↓ → Block 间导航              │   │
│            └────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

点击六点手柄弹出操作菜单（和 Notion 一致）：

- **删除**：软删除当前 Block
- **复制**：在下方复制一份
- **转换为**：切换 Block 类型（标题↔段落↔列表↔代码块...）

### 7.2 代码块编辑器

代码块使用 `textarea` 而非 `contentEditable`，提供专业的编码体验：

```javascript
// src/components/CodeBlock.jsx
// 核心功能：
// - 行号显示（自动跟随行数）
// - Tab / Shift+Tab 缩进管理
// - Cmd+A 全选代码块内容（不影响页面）
// - Cmd+Enter 跳出代码块
// - 括号自动匹配 () [] {} "" ''
// - 13 种语言标签切换
// - 一键复制
```

### 7.3 斜杠命令

输入 `/` 弹出命令面板，支持模糊搜索和键盘导航：

```javascript
if (content === '/') {
    const rect = contentRef.current.getBoundingClientRect();
    onSlashMenu({ top: rect.bottom + 4, left: rect.left });
}
```

---

## 八、项目结构与运行

### 8.1 目录结构

```
notion-lite/
├── server/
│   ├── index.js          # Express + Socket.IO + Block 数据层
│   └── ai.js             # AI 写作服务（兼容 OpenAI API）
├── src/
│   ├── App.jsx           # 应用根组件
│   ├── components/
│   │   ├── Editor.jsx    # 编辑器主容器
│   │   ├── Block.jsx     # Block 组件（核心）
│   │   ├── CodeBlock.jsx # 代码编辑器
│   │   ├── BlockMenu.jsx # Block 操作菜单（删除/复制/转换）
│   │   ├── SlashMenu.jsx # 斜杠命令菜单
│   │   ├── AIPanel.jsx   # AI 写作面板
│   │   ├── Sidebar.jsx   # 侧边栏（文档列表/新建/删除）
│   │   └── CollaborationBar.jsx  # 协作状态栏
│   ├── hooks/
│   │   ├── useBlocks.js       # Block CRUD 状态管理
│   │   └── useCollaboration.js # WebSocket 协作 Hook
│   └── utils/
│       └── blockTypes.js      # Block 类型定义
├── package.json
└── vite.config.js
```

### 8.2 快速启动

```bash
git clone <your-repo>
cd notion-lite
npm install
npm run dev
# 前端: http://localhost:5173
# 后端: http://localhost:3001
```

### 8.3 调试接口

后端暴露了几个有用的调试接口，帮助你理解运行时状态：

```bash
# 查看 Block 统计
curl http://localhost:3001/api/stats
# {"totalBlocks":26,"aliveBlocks":26,"pages":2,"operations":0}

# 查看操作日志（编辑文档后会产生记录）
curl http://localhost:3001/api/operations
# [{"id":1,"block_id":"xxx","type":"update","path":["content"],...}]

# 查看页面快照
curl http://localhost:3001/api/documents/doc-001/snapshots
```

### 8.4 多人协作体验

在 2-3 个浏览器标签页中同时打开 `http://localhost:5173`：

- 每个标签页自动分配不同的用户名和颜色
- 编辑内容实时同步到其他标签页
- 顶部状态栏显示在线用户头像
- 打开浏览器控制台的 Network → WS 面板，可以看到实时的 WebSocket 消息流

---

## 九、用 Go 重写后端：技术栈映射与核心代码

我们的 Demo 用 Node.js 实现，但如果你是 Go 开发者，切换成本很低。后端的本质就是三件事：**HTTP API + WebSocket + 内存存储**，Go 生态都有成熟方案。

### 9.1 技术栈映射

| 能力 | Node.js (当前) | Go (替换方案) |
| --- | --- | --- |
| HTTP 框架 | Express | Gin / Echo / Chi |
| WebSocket | Socket.IO | gorilla/websocket / melody / nhooyr/websocket |
| JSON 处理 | 内置 | encoding/json |
| UUID | uuid 包 | google/uuid |
| 并发模型 | 单线程事件循环 | Goroutine + Channel |
| 内存存储 | Map | sync.Map 或 map + sync.RWMutex |

> ⚠️ **最大差异**：Node.js 的 Socket.IO 有自动重连、Room、namespace 等高级功能。Go 没有 Socket.IO 对等实现，需要用原生 WebSocket + 手动管理 Room。

### 9.2 数据模型（完全一致）

```go
// Block 数据模型 —— 和 Node.js 版本完全对应
type Block struct {
    ID         string                 `json:"id"`
    Type       string                 `json:"type"`        // "page" | "paragraph" | "heading1" ...
    ParentID   *string                `json:"parent_id"`   // 父 Block ID，构成树形结构
    SpaceID    string                 `json:"space_id"`    // 分片键
    Content    string                 `json:"content"`
    Properties map[string]interface{} `json:"properties"`
    Version    int                    `json:"version"`     // 乐观锁版本号
    Position   float64                `json:"position"`    // 分数排序
    Alive      bool                   `json:"alive"`       // 软删除
    CreatedAt  time.Time              `json:"created_at"`
    UpdatedAt  time.Time              `json:"updated_at"`
}

// 操作日志
type Operation struct {
    ID        int64                  `json:"id"`
    BlockID   string                 `json:"block_id"`
    UserID    string                 `json:"user_id"`
    Type      string                 `json:"type"`      // "update" | "create" | "delete"
    Path      []string               `json:"path"`
    Args      map[string]interface{} `json:"args"`
    Version   int                    `json:"version"`
    Timestamp time.Time              `json:"timestamp"`
}
```

### 9.3 存储层（map + 读写锁）

Node.js 是单线程的，直接操作 Map 不需要加锁。Go 是多 Goroutine 并发的，**必须加锁**：

```go
type BlockStore struct {
    mu     sync.RWMutex
    blocks map[string]*Block   // blockID -> Block
    opLog  []Operation
}

// 获取子 Block（读锁）
func (s *BlockStore) GetChildren(parentID string) []*Block {
    s.mu.RLock()
    defer s.mu.RUnlock()

    var children []*Block
    for _, b := range s.blocks {
        if b.ParentID != nil && *b.ParentID == parentID && b.Alive {
            children = append(children, b)
        }
    }
    // 按 position 排序
    sort.Slice(children, func(i, j int) bool {
        return children[i].Position < children[j].Position
    })
    return children
}

// 更新 Block（写锁 + 记录 Operation）
func (s *BlockStore) UpdateBlock(id string, content string, userID string) bool {
    s.mu.Lock()
    defer s.mu.Unlock()

    block, ok := s.blocks[id]
    if !ok || !block.Alive {
        return false
    }
    block.Content = content
    block.Version++
    block.UpdatedAt = time.Now()

    // 记录操作日志
    s.opLog = append(s.opLog, Operation{
        ID:        int64(len(s.opLog) + 1),
        BlockID:   id,
        UserID:    userID,
        Type:      "update",
        Path:      []string{"content"},
        Args:      map[string]interface{}{"value": content},
        Version:   block.Version,
        Timestamp: time.Now(),
    })
    return true
}
```

### 9.4 WebSocket 协作（手动 Room 管理）

这是 Go 版本和 Node.js 差异最大的地方。Socket.IO 的 Room 需要手动实现：

```go
// WebSocket 连接管理器（替代 Socket.IO 的 Room）
type Hub struct {
    mu    sync.RWMutex
    rooms map[string]map[*Client]bool  // docID -> set of clients
}

type Client struct {
    conn     *websocket.Conn
    userID   string
    userName string
    color    string
    docID    string
    send     chan []byte  // 发送队列
}

// 加入文档（相当于 socket.join(docId)）
func (h *Hub) Join(docID string, client *Client) {
    h.mu.Lock()
    defer h.mu.Unlock()
    if h.rooms[docID] == nil {
        h.rooms[docID] = make(map[*Client]bool)
    }
    h.rooms[docID][client] = true
    client.docID = docID
}

// 广播给同文档的其他用户（相当于 socket.to(docId).emit(...)）
func (h *Hub) Broadcast(docID string, sender *Client, message []byte) {
    h.mu.RLock()
    defer h.mu.RUnlock()
    for client := range h.rooms[docID] {
        if client != sender {
            select {
            case client.send <- message:
            default:
                // 缓冲区满，跳过（或断开连接）
            }
        }
    }
}

// 每个连接的读循环（一个 Goroutine）
func (c *Client) ReadPump(hub *Hub, store *BlockStore) {
    defer hub.Leave(c)
    for {
        _, msg, err := c.conn.ReadMessage()
        if err != nil {
            break
        }
        var event WSEvent
        json.Unmarshal(msg, &event)

        switch event.Type {
        case "block-update":
            store.UpdateBlock(event.Block.ID, event.Block.Content, c.userName)
            hub.Broadcast(c.docID, c, msg)

        case "block-add":
            store.AddBlock(event.Block, event.AfterBlockID, c.userName)
            hub.Broadcast(c.docID, c, msg)

        case "block-delete":
            store.SoftDelete(event.BlockID, c.userName)
            hub.Broadcast(c.docID, c, msg)

        case "cursor-update":
            hub.Broadcast(c.docID, c, msg)
        }
    }
}
```

### 9.5 HTTP API（Gin 示例）

```go
func main() {
    store := NewBlockStore()
    hub := NewHub()

    r := gin.Default()
    r.Use(cors.Default())

    // REST API —— 和 Node.js 版本完全对应
    r.GET("/api/documents", func(c *gin.Context) {
        c.JSON(200, store.GetPages())
    })
    r.GET("/api/documents/:id", func(c *gin.Context) {
        page, children := store.GetDocument(c.Param("id"))
        if page == nil {
            c.JSON(404, gin.H{"error": "文档不存在"})
            return
        }
        c.JSON(200, gin.H{"id": page.ID, "title": page.Content, "blocks": children})
    })
    r.POST("/api/documents", func(c *gin.Context) { /* 创建文档 */ })
    r.DELETE("/api/documents/:id", func(c *gin.Context) { /* 软删除 */ })
    r.GET("/api/operations", func(c *gin.Context) { c.JSON(200, store.GetRecentOps(50)) })
    r.GET("/api/stats", func(c *gin.Context) { c.JSON(200, store.GetStats()) })

    // WebSocket 升级端点（替代 Socket.IO 的自动握手）
    r.GET("/ws", func(c *gin.Context) {
        conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
        if err != nil {
            return
        }
        client := &Client{conn: conn, send: make(chan []byte, 256)}
        go client.ReadPump(hub, store)
        go client.WritePump()
    })

    r.Run(":3001")
}
```

### 9.6 Go vs Node.js 关键差异总结

| 维度 | Node.js | Go | 影响 |
| --- | --- | --- | --- |
| **并发安全** | 单线程，天然无竞争 | 多 Goroutine，需要 sync.RWMutex | Go 需要更多锁代码 |
| **WebSocket** | Socket.IO 自带 Room/重连/心跳 | 原生 WebSocket，Room 需手写 | Go 多约 80 行代码 |
| **JSON** | 原生支持 | 需要定义 struct + tag | Go 更严谨但更啰嗦 |
| **错误处理** | try/catch | if err != nil | Go 更显式 |
| **性能** | 单核约 1 万连接 | 轻松 10 万+ 连接 | Go 优势明显 |
| **部署** | 需要 Node.js 运行时 | 编译为单二进制 | Go 运维更简单 |
| **开发效率** | 快（动态类型 + 丰富生态） | 慢（静态类型 + 手写较多） | Node.js 适合 Demo |
| **前端配合** | 前后端同一语言 | 前端仍需 JS/TS | Node.js 对全栈更友好 |

**结论**：如果是做 Demo 或快速验证，Node.js 更合适；如果要上生产、扛高并发，Go 是更好的选择。两者的**数据模型和 API 协议完全一致**，只是实现语言不同。前端代码无需任何修改（前端只关心 HTTP + WebSocket 协议，不关心后端用什么语言）。

---

## 十、我们的 Demo vs 生产级 Notion

| 维度 | Demo 实现 | 生产级 Notion | 差距与升级方向 |
| --- | --- | --- | --- |
| **存储** | 内存 Map | PostgreSQL + Sharding | 替换为真实数据库 |
| **Block 模型** | ✅ parent_id 树形 | ✅ 相同 | 架构一致 |
| **排序** | ✅ 分数排序法 | ✅ 相同 | 架构一致 |
| **软删除** | ✅ alive 标记 | ✅ 相同 | 架构一致 |
| **版本号** | ✅ version 自增 | ✅ + 乐观锁 CAS | 加 CAS 校验 |
| **操作日志** | ✅ Operation Log | ✅ + Undo/Redo | 加反向操作 |
| **快照** | ✅ 内存快照 | S3 对象存储 | 替换为对象存储 |
| **冲突处理** | Last Write Wins | CRDT（Y.js） | 引入 Y.js |
| **ID 生成** | UUID v4 | Snowflake | 替换为分布式 ID |
| **分页加载** | 全量返回 | Cursor 分页 | 加 LIMIT/cursor |
| **富文本** | 纯文本 | 加粗/斜体/链接/颜色 | 引入 ProseMirror |
| **Block 嵌套** | 一级平铺 | 无限嵌套 | 递归渲染 |
| **性能** | 小文档 | 虚拟滚动 | 引入虚拟列表 |

**核心结论**：我们的 Demo 在**数据模型设计**上已经对齐了 Notion 的核心架构（Block 树 + parent_id + version + position + alive + Operation），差距主要在**工程层面**（数据库、CRDT、性能优化）。

---

## 十一、这个项目是 AI 写的——程序员还有用吗？

### 11.1 一个事实

**本文中展示的所有代码——前端 React 组件、后端 Express 服务、WebSocket 协作、AI 集成——全部由 AI（Claude）在对话中生成。** 人类（也就是我）做的事情是：

1. 提出需求："做一个类似 Notion 的协作文档 Demo"
2. 发现 Bug："光标跳动了"、"删除功能没有"、"代码块太简陋"
3. 提出方向："后端要对齐 Notion 的真实架构"
4. 审查质量："这个实现太 low 了，不像 Notion"

AI 做了剩下的全部：项目脚手架、组件拆分、数据模型设计、API 实现、Bug 修复、文章撰写。

### 11.2 AI 能做到什么程度？

我把这次协作过程中 AI 承担的工作做了一个分类：

| 能力维度 | AI 完成度 | 具体表现 |
| --- | --- | --- |
| **脚手架搭建** | 100% | package.json、Vite 配置、Tailwind 配置、目录结构一次生成 |
| **CRUD 逻辑** | 100% | REST API、Block 增删改查、文档列表，几乎不需要修改 |
| **UI 组件** | 95% | Sidebar、Editor、Block、SlashMenu 等，只有少量 JSX 语法错误需要修 |
| **架构设计** | 80% | 初版架构"能用但粗糙"，需要人给出 Notion 架构方向后才能对齐 |
| **Bug 修复** | 90% | 给出报错信息后能准确定位并修复，偶尔需要多轮 |
| **细节打磨** | 70% | 代码块编辑体验、光标稳定性等需要反复调整 |
| **文章写作** | 90% | 结构、技术深度、图表都不错，但需要人定方向和审核 |

### 11.3 AI 做不了的事

但如果我不参与，AI 会产出什么？**一个能运行但没人想用的 Demo**。具体来说：

**1. AI 不知道什么是"好"**

AI 的第一版后端就是一个普通的 CRUD——Express + 内存数组，和任何 TodoList 教程没有区别。是我提供了 Notion 的架构分析（parent_id 树、Operation 日志、分数排序、软删除），AI 才能照着方向实现。

**AI 能写代码，但不会自己定义"什么代码值得写"。**

**2. AI 不会自己发现体验问题**

光标跳动、代码块无法用 Tab 缩进、删除功能缺失——这些都是我在浏览器里实际操作时发现的。AI 生成的代码在语法上是对的，但**没有手感**。

**AI 能修 Bug，但不会自己去"用"产品。**

**3. AI 不理解"读者想看什么"**

AI 的第一版文章面面俱到但流于表面。是我说了"我是后端开发者，后端技术要说清楚"，文章才变成了现在这样以 SQL 建表语句和架构图为主线的风格。

**AI 能写文章，但不知道谁在读、读者关心什么。**

### 11.4 新型分工：人做决策，AI 做执行

这次协作的效率非常高——从零到一个可运行的 Demo + 完整技术文章，如果纯手写大概需要 2-3 天，用 AI 辅助只花了几个小时。但核心分工是这样的：

```
┌─────────────────────────────────────────────────────────┐
│                     人类的工作                           │
│                                                         │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐           │
│  │ 定义目标  │  │ 架构决策  │  │ 质量把关  │           │
│  │ "做什么"  │  │ "怎么做"  │  │ "够不够好" │           │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘           │
│        │              │              │                   │
│        ▼              ▼              ▼                   │
│  ┌────────────────────────────────────────────┐         │
│  │            提示词 / 反馈 / 验收              │         │
│  └────────────────────┬───────────────────────┘         │
└───────────────────────┼─────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────────┐
│                      AI 的工作                            │
│                                                           │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐             │
│  │ 代码生成  │  │ Bug 修复  │  │ 文档撰写  │             │
│  │ 全部组件  │  │ 定位+修复 │  │ 结构+内容 │             │
│  └───────────┘  └───────────┘  └───────────┘             │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐             │
│  │ 配置文件  │  │ 重构优化  │  │ 多语言翻译│             │
│  │ 一键生成  │  │ 按指令改  │  │ Go/Node对照│             │
│  └───────────┘  └───────────┘  └───────────┘             │
└───────────────────────────────────────────────────────────┘
```

### 11.5 对程序员的建议

**AI 不会取代程序员，但会取代不会用 AI 的程序员。**

1. **学架构，不要只学语法**。AI 写 CRUD 比你快 10 倍，但它不会自己设计出 Block 模型和 Operation 日志。你的价值在于**知道应该怎么设计**，然后让 AI 去实现。

2. **学会提问**。"帮我写一个后端"和"用 parent_id 树形结构实现 Block 模型，支持分数排序和软删除"——这两个提示词产出的代码质量天差地别。**好的 prompt 就是好的技术方案**。

3. **保持手感**。你必须亲自运行、亲自点击、亲自使用。AI 不会告诉你"光标跳了"或者"这个交互不像 Notion"。**用户体验是跑出来的，不是写出来的**。

4. **理解 AI 的边界**。这个 Demo 的 CRDT、分库分表、虚拟滚动都没实现——因为这些是"需要深度工程经验才能正确实现"的功能。AI 可以写出形式上正确的 CRDT 代码，但在生产环境中跑不跑得通，只有有经验的工程师才知道。

> 未来的程序员不是"写代码的人"，而是"知道该写什么代码、能判断代码好坏的人"。AI 是你的 10x 执行力放大器，但方向盘始终在你手里。

---

## 十二、总结

### 对后端开发者的启发

1. **"化整为零"的思想**：大文档拆成小 Block，大表按 space_id 分片。这种思路适用于任何需要存储"大内容"的系统——OCR 结果按区域存、长文章按段落存、表单按字段存。

2. **Operation 驱动**：不要覆盖数据，记录操作。操作日志不仅是协作的基石，也是审计、回滚、历史记录的天然数据源。

3. **软删除是标配**：`alive` 字段看似简单，但它支撑了回收站、协作中的删除同步、以及数据恢复。

4. **分数排序法**：任何需要"在两个元素之间插入"的场景都可以用。比 `ORDER BY position` 后重新编号高效得多。

5. **乐观更新**：先改 UI 再同步。用户感知到的延迟 = 0，而不是等服务端返回后才更新界面。

### 进一步学习方向

| 方向 | 推荐 | 说明 |
| --- | --- | --- |
| CRDT 实现 | Y.js / Automerge | 替换 Last Write Wins，实现真正的无冲突协作 |
| 富文本编辑器 | ProseMirror / TipTap / Lexical | 支持加粗、斜体、链接等行内格式 |
| 数据库替换 | PostgreSQL + JSONB | 将内存 Map 替换为真实数据库 |
| 搜索 | Elasticsearch | 全文检索所有 Block 的 content |
| 消息队列 | Kafka / Redis Stream | Operation 异步处理、多实例广播 |

---

> 📝 完整源码在项目目录中，`npm run dev` 即可运行。后端开发者可以重点关注 `server/index.js` 中的 Block 数据层设计和 WebSocket 事件处理。
>
> 如果对你有帮助，欢迎 Star 和转发。有问题欢迎评论区交流。

---

**关注我，获取更多后端架构实战分享 🚀**