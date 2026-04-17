# 深度拆解 Notion 架构：从后端视角手撸一个协作文档系统

> **完整源码**：https://github.com/zhengbei-lab/notion-lite  
> `git clone` 后 `npm install && npm run dev` 即可运行。

---

## 一、从一个问题开始：你会怎么存一篇文档？

假设产品经理走过来说："做个在线文档，支持多人协作。"

大多数后端第一反应大概是：建一张 `documents` 表，`content` 字段存 Markdown 或 HTML，改了就 UPDATE。对吧？我最初也这么想。

但你打开 Chrome DevTools 看看 Notion 的网络请求——**它拿到的不是一个文档文件，而是一堆碎片化的 JSON 数据**。标题是一条、段落是一条、代码块是一条，甚至"这个页面本身"也是一条。

这就是 Notion 最核心的设计：**Everything is a Block**。

| 原则 | 说明 |
| --- | --- |
| Everything is a Block | 标题、段落、代码块、甚至页面本身都是 Block |
| 树形结构 | Block 之间通过 `parent_id` 形成树状嵌套 |
| 操作驱动 | 每次编辑产生 Operation，而非覆盖整个文档 |
| 水平扩展 | 按 `space_id`（工作区）分库分表 |

听起来像是过度设计？先别急着下结论。往下看完你会发现，**这不是 Notion 想复杂了，而是协作场景逼出来的**。

---

## 二、数据模型：一切皆 Block

好，我们现在知道 Notion 把文档拆成了一堆 Block。那这张表到底长什么样？

### 2.1 Block 表设计

这是 Notion 最核心的一张表。在真实 Notion 中，这是一张按 `space_id` 做水平拆分（Sharding）的 PostgreSQL 表：

```sql
CREATE TABLE blocks (
    id          UUID PRIMARY KEY,
    type        VARCHAR(50) NOT NULL,       -- 'page' | 'paragraph' | 'heading1' | 'code' | ...
    parent_id   UUID REFERENCES blocks(id), -- 父 Block ID，构成树形结构
    space_id    UUID NOT NULL,              -- 工作区 ID，分库分表的 sharding key
    content     JSONB,                      -- 文本内容
    properties  JSONB DEFAULT '{}',         -- 扩展属性（todo 的 checked、code 的 language 等）
    version     INTEGER DEFAULT 1,          -- 乐观锁版本号，每次修改自增
    position    FLOAT DEFAULT 0,            -- 排序权重（分数排序法）
    alive       BOOLEAN DEFAULT TRUE,       -- 软删除标记（支持回收站）
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_blocks_parent ON blocks(parent_id, position); -- 最频繁的查询
CREATE INDEX idx_blocks_space  ON blocks(space_id);            -- 分片路由
```

> 💡 完整的后端实现见 [`server/index.js`](https://github.com/zhengbei-lab/notion-lite/blob/main/server/index.js)

**关键设计决策解读：**

**1) Page 也是 Block**

这个设计初看反直觉——页面不应该是容器吗？怎么也是 Block？但正因如此，"创建子页面"在数据库层面只是一条 INSERT，跟创建一个段落没有任何区别：

| Block | type | parent_id | 说明 |
| --- | --- | --- | --- |
| 工作区根 | space | null | 顶层容器 |
| ├ 文档 A | page | space-id | 一级页面 |
| │ ├ 标题 | heading1 | page-A-id | 文档 A 的标题 |
| │ ├ 段落 | paragraph | page-A-id | 文档 A 的段落 |
| │ └ 子页面 B | page | page-A-id | **子页面也是 Block！** |
| │　 └ ... | ... | page-B-id | 无限嵌套 |

**2) position 用浮点数而非整数——分数排序法**

这是一个容易被忽略但极其精妙的细节。假设你有 5 个 Block 排列为 1, 2, 3, 4, 5，现在要在 2 和 3 之间插入一个新的。如果用整数，你得把 3, 4, 5 全部 +1——一个 INSERT 触发了 N 个 UPDATE。而用浮点数？直接插入 2.5，完事：

| 操作 | 整数排序 | 浮点排序（分数排序法） |
| --- | --- | --- |
| 在 pos=2 和 pos=3 之间插入 | `UPDATE ... SET position = position + 1 WHERE position >= 3`（批量更新） | `INSERT ... (position) VALUES (2.5)`（零额外更新） |
| 数据库写入次数 | O(n) | O(1) |
| 精度不够时 | — | 做一次全量重排（极少发生） |

**3) 软删除 `alive` 字段**

Notion 不做物理删除。`DELETE` 操作实际上是 `UPDATE blocks SET alive = false`。好处：

- 支持"回收站"：`WHERE alive = false AND space_id = ?`
- 支持误操作恢复
- 不破坏 `parent_id` 的引用完整性

### 2.2 为什么一定要拆成 Block？

读到这里你可能会想：至于吗？直接存一个大 JSON 或 Markdown 不行？

不行。**一个字段存整篇文档**在单人编辑时没问题，但加上"多人实时协作"这个需求，它就彻底崩了：

| 场景 | 整文档存储 | Block 拆分存储 |
| --- | --- | --- |
| **协作冲突** | A 改第1段，B 改第10段 → 整篇冲突，需要复杂文本合并 | 修改不同 `block_id`，数据库层面无冲突 |
| **权限控制** | 只能按文档粒度 | 理论上可以对单个 Block 设权限 |
| **按需加载** | 10 万字必须全量加载 | `WHERE parent_id = ? LIMIT 50` 分页加载 |

### 2.3 富文本模型：content 不是字符串

Block 模型搞定了文档的"骨架"。但一段文字里面有加粗、有链接、有颜色怎么办？

很多人以为 Block 的 `content` 就是一个纯字符串。**不是的**。Notion 的 content 是一个**结构化的富文本数组**，长这样：

```json
// 数据库中 content 字段的真实结构（JSONB）
// 显示效果：「Hello World，点击 这里」—— "Hello" 加粗，"这里" 是链接
[
  ["Hello", [["b"]]],
  [" World，点击 "],
  ["这里", [["a", "https://example.com"]]]
]
```

每个元素是一个二元组 `[text, annotations]`，annotations 是一个二维数组，支持叠加多种格式：

| annotation 标记 | 含义 | 示例 |
| --- | --- | --- |
| `["b"]` | 加粗 | `["hello", [["b"]]]` |
| `["i"]` | 斜体 | `["hello", [["i"]]]` |
| `["s"]` | 删除线 | `["hello", [["s"]]]` |
| `["c"]` | 行内代码 | `["hello", [["c"]]]` |
| `["a", "url"]` | 链接 | `["点击", [["a", "https://..."]]]` |
| `["h", "red"]` | 文字颜色 | `["警告", [["h", "red"]]]` |
| `["b"], ["i"]` | 加粗+斜体 | `["hello", [["b"], ["i"]]]` |

**为什么不用 HTML 或 Markdown？**

| 方案 | 协作冲突 | 解析成本 | 格式叠加 |
| --- | --- | --- | --- |
| HTML `<b><i>text</i></b>` | 文本合并时标签可能错位 | 需要 DOM 解析器 | 嵌套标签，复杂 |
| Markdown `***text***` | 特殊字符转义问题 | 需要正则解析 | 嵌套困难 |
| **Notion 数组格式** | 数组元素级别合并，天然对齐 | JSON 原生解析 | 二维数组叠加，简洁 |

这种设计使得**富文本的每一段文字都可以独立被修改**，Operation 只需要指定数组下标即可精准更新，不需要做文本 diff。

> 💡 我们的 Demo 用纯字符串简化了 content，但真实 Notion 的 content 就是这种结构化数组。如果要支持行内加粗/链接，这是必须要做的改造。

### 2.4 Notion Database：表格也是 Block

如果说 Block 模型让你觉得"嗯，设计得不错"，那 Notion Database 会让你觉得"这也太优雅了吧"。

你在 Notion 里创建的那些表格、看板、日历——它们不是单独的功能模块，**本质上还是 Block**：

```sql
-- 数据库本身是一个 type='collection' 的 Block
INSERT INTO blocks (id, type, content, properties) VALUES (
  'col-001', 'collection', '任务列表',
  '{
    "schema": {
      "title":    {"name": "任务名",  "type": "title"},
      "status":   {"name": "状态",    "type": "select",
                   "options": [{"value": "进行中", "color": "blue"}, {"value": "完成", "color": "green"}]},
      "assignee": {"name": "负责人",  "type": "person"},
      "due_date": {"name": "截止日期", "type": "date"}
    }
  }'
);
```

数据库的每一行就是一个 `type='page'` 的 Block，它的 `properties` 存储各列的值：

| Block (行) | type | parent_id | properties |
| --- | --- | --- | --- |
| 任务 1 | page | col-001 | `{"title": "写文档", "status": "进行中", "assignee": "张三"}` |
| 任务 2 | page | col-001 | `{"title": "修 Bug", "status": "完成", "due_date": "2026-04-20"}` |
| 任务 3 | page | col-001 | `{"title": "Code Review", "status": "进行中"}` |

**视图（View）** 则是 `type='collection_view'` 的 Block，存储排序、筛选、分组规则：

```json
{
  "type": "table",
  "query": {
    "filter": [{"property": "status", "operator": "equals", "value": "进行中"}],
    "sort":   [{"property": "due_date", "direction": "ascending"}]
  },
  "visible_properties": ["title", "status", "assignee", "due_date"]
}
```

**精妙之处**：同一个 Collection 可以挂多个 View（表格视图、看板视图、日历视图），它们共享数据但各自有独立的筛选和排序。**数据只存一份，展示逻辑全在 View 的 properties 里**。

这也解释了为什么 Notion 的"数据库"不是真的数据库——它没有 SQL 引擎，没有 JOIN，没有事务隔离级别。它只是用 Block 模型 + JSONB properties 模拟了一个结构化数据表，靠 View 的 query 来做前端筛选和排序。

---

## 三、存储架构：分库分表 + 分布式 ID

到这里，Block 模型的设计已经讲清楚了。但还有一个现实问题：**Notion 有几亿用户，所有 Block 存一张表？**

显然不行。一张表几十亿行，任何索引都救不了你。

### 3.1 按 Space 分片

Notion 的用户量决定了单库扛不住。分片策略是**按 `space_id`（工作区）进行水平拆分**：

| 组件 | 职责 |
| --- | --- |
| **Router 层** | 接收请求，根据 `space_id` 计算目标分片 |
| **Shard 0** (PG 实例) | 存储 space 0~999 的所有 Block |
| **Shard 1** (PG 实例) | 存储 space 1000~1999 的所有 Block |
| **Shard N** (PG 实例) | 以此类推，按需扩容 |

关键：同一个团队的所有 Block 落在同一个分片上，**保证查询不跨库**。这一点非常重要——如果一个页面的 Block 分散在不同分片上，那加载一个页面就要跨库 JOIN，性能直接崩掉。

### 3.2 分布式 ID 生成

Block ID 使用类似 **Snowflake** 的算法，一个 64 位整数包含：

| 段 | 位数 | 作用 |
| --- | --- | --- |
| 符号位 | 1 bit | 固定为 0 |
| 时间戳 | 41 bits | ID 天然按创建时间排列 |
| 机器 ID | 5 bits | 分布式环境下保证唯一 |
| 序列号 | 12 bits | 同一毫秒内的自增序号 |

纯内存计算，不依赖数据库。我们的 Demo 用 UUID 简化，但生产环境 Snowflake 是标配。

---

## 四、操作日志：Operation 驱动的编辑模型

存储的问题解决了。接下来是最有意思的部分——**用户每一次敲键盘，后端到底发生了什么？**

### 4.1 什么是 Operation？

传统做法是：用户改了文档 → 前端把整篇文档 POST 到后端 → 后端 UPDATE。这在单人编辑时没问题，但多人协作时就炸了——两个人同时改，最后提交的人会覆盖前一个人的内容。

Notion 的做法截然不同：**每一次编辑不是"覆盖文档"，而是产生一条操作记录**：

```sql
CREATE TABLE operations (
    id         BIGSERIAL PRIMARY KEY,
    block_id   UUID NOT NULL,
    user_id    UUID NOT NULL,
    type       VARCHAR(50),     -- 'update' | 'create' | 'delete' | 'reorder'
    path       TEXT[],           -- 修改路径: ['content'] 或 ['properties', 'checked']
    args       JSONB,            -- 操作参数: {"value": "新内容"}
    version    INTEGER,          -- 操作后的版本号
    timestamp  TIMESTAMPTZ DEFAULT NOW()
);
```

当你在 Notion 中修改一段文字时，前端发出的不是"把文档替换为 XXX"，而是这样一条精确到字段级别的 Operation：

```json
{ "type": "update", "block_id": "abc-123", "path": ["content"], "args": {"value": "修改后的文字"}, "version": 5 }
```

### 4.2 Operation 的三大用途

有了操作日志，很多原本复杂的功能就变得自然了：

**1) 实时协作同步**

| 步骤 | 动作 |
| --- | --- |
| ① 用户 A 编辑 | 产生 Operation `{block: "b1", content: "hello"}` |
| ② 发送到服务端 | 通过 WebSocket 发出 |
| ③ 服务端记录 + 广播 | 写入 Operation Log，转发给同文档的其他用户 |
| ④ 用户 B 收到 | 应用 Operation，更新本地 Block |

**2) Undo/Redo** — 操作日志天然就是一条操作栈。Ctrl+Z？往回走一条 Operation 就行。不需要额外的 undo stack。

**3) 页面历史** — "3 天前的版本长什么样？"——回放从那个时间点到现在的所有 Operation 就能还原。同时 Notion 会定期将完整页面状态**快照到 S3**，避免回放太多 Operation。

> 💡 我们的 Demo 实现了 Operation Log 和快照机制，可以通过 `curl http://localhost:3001/api/operations` 查看操作日志。

### 4.3 版本号与乐观锁

每个 Block 维护一个 `version` 字段，更新时自增。在生产环境中用于**乐观锁冲突检测**：

```sql
-- 只有版本号匹配时才允许更新
UPDATE blocks SET content = ?, version = version + 1 WHERE id = ? AND version = ?;
-- 如果受影响行数 = 0，说明有冲突
```

### 4.4 Transaction：原子性批量操作

你可能已经注意到一个问题：如果一个操作涉及多个 Block 怎么办？

比如你把一个 Block 从 A 页面拖到 B 页面——这至少要修改三个地方：Block 的 parent_id、Block 的 position、旧父节点的状态。如果中间出错只改了一半，Block 就"悬空"了。

所以真实 Notion 不是一次只发一条 Operation，而是将多条 Operation **打包成一个 Transaction** 原子提交：

```json
{
  "transaction_id": "tx-001",
  "operations": [
    {"type": "update", "block_id": "b1", "path": ["content"], "args": {"value": "新标题"}},
    {"type": "create", "block_id": "b2", "args": {"type": "paragraph", "parent_id": "page-001"}},
    {"type": "update", "block_id": "b2", "path": ["content"], "args": {"value": "新段落内容"}}
  ]
}
```

**为什么需要 Transaction？**

| 场景 | 涉及的 Operation | 如果不是原子的 |
| --- | --- | --- |
| 拖拽 Block 到另一位置 | ① 修改 parent_id ② 修改 position ③ 更新旧父节点 | Block 可能"悬空"——父节点变了但位置没变 |
| 段落转为待办 | ① 修改 type ② 添加 properties.checked | type 变了但 checked 不存在 |
| 删除含子 Block 的 Block | ① 父 Block alive=false ② 所有子 Block alive=false | 子 Block 仍存活但父已删除 |

服务端收到 Transaction 后，要么全部 Operation 成功，要么全部回滚。这保证了**Block 树在任何时刻都是一致的**。

### 4.5 缓存与增量同步

到这里，数据模型、存储、操作日志都讲完了。但还有一个性能问题：每次打开页面都 `SELECT * FROM blocks WHERE parent_id = ?` ？用户量一上来，数据库直接被打爆。

生产级 Notion 不是每次都从 PostgreSQL 读取，而是有一层 **Redis 缓存**：

| 层级 | 存储 | 用途 |
| --- | --- | --- |
| **L1：客户端缓存** | IndexedDB / 内存 | 离线访问、乐观更新 |
| **L2：Redis** | Block 热数据 + 用户 Session | 读请求命中率 > 95% |
| **L3：PostgreSQL** | 全量 Block + Operation Log | 持久化存储 |

客户端首次打开页面时全量加载，之后通过 `syncRecordValues` API 做**增量同步**——只拉取 `version > 本地版本号` 的 Block 变更，而不是重新加载整个页面。这就是为什么 Notion 切换页面感觉很快：大部分数据已经在本地缓存了。

---

## 五、实时协作：WebSocket + Room

前面讲的 Operation 模型解决了"怎么记录编辑"，但还没回答一个关键问题：**A 改了一个 Block，B 怎么立刻看到？**

答案是 WebSocket。HTTP 是"你问我才答"，WebSocket 是"有消息主动推给你"。

### 5.1 架构设计

Socket.IO 的 Room 机制天然对应"同一文档的编辑者"：

| 概念 | 说明 |
| --- | --- |
| **连接** | 每个浏览器标签页 ↔ 服务端建立一条 WebSocket 长连接 |
| **Room** | 按文档 ID 分组。编辑文档 A 的用户加入 Room-A，编辑文档 B 的加入 Room-B |
| **广播** | `socket.to(docId).emit(...)` — 发送给同 Room 的其他用户，不发给自己 |

多个 Room 之间完全隔离，编辑文档 A 不会收到文档 B 的消息。

### 5.2 事件协议

| 事件 | 方向 | 说明 |
| --- | --- | --- |
| `join-document` | 客户端 → 服务端 | 加入文档编辑房间 |
| `users-update` | 服务端 → 客户端 | 在线用户列表变更 |
| `block-update` / `block-updated` | 双向 | 修改 Block 内容 |
| `block-add` / `block-added` | 双向 | 新增 Block |
| `block-delete` / `block-deleted` | 双向 | 删除 Block（软删除） |
| `cursor-update` / `cursor-updated` | 双向 | 光标位置同步 |

> 💡 完整的 WebSocket 事件处理见 [`server/index.js`](https://github.com/zhengbei-lab/notion-lite/blob/main/server/index.js)，客户端协作 Hook 见 [`src/hooks/useCollaboration.js`](https://github.com/zhengbei-lab/notion-lite/blob/main/src/hooks/useCollaboration.js)

### 5.3 乐观更新（Optimistic Update）

这里有一个用户体验上的小心思，值得单独说：

你在 Notion 打字时，有没有感觉几乎零延迟？**那不是网络快，而是前端在"骗你"**：

| 步骤 | 延迟 | 说明 |
| --- | --- | --- |
| ① 用户输入 "hello" | 0ms | 立即更新本地 UI（用户无感延迟） |
| ② 异步发送 Operation 到服务端 | ~50ms | 后台发送，不阻塞 UI |
| ③ 服务端广播给其他用户 | ~100ms | 其他用户看到变化 |

这就是为什么 Notion 编辑时感觉"毫无延迟"——你看到的变化是本地先行的，服务端同步在后台默默进行。如果同步失败？回滚本地修改并提示冲突。但绝大多数时候，用户根本感知不到这个过程。

### 5.4 冲突处理：从玩具到生产

| 方案 | 思路 | 代表产品 | 复杂度 |
| --- | --- | --- | --- |
| Last Write Wins | 最后写入者覆盖 | 我们的 Demo | ⭐ |
| OT (Operational Transform) | 将编辑拆为原子操作并变换 | Google Docs | ⭐⭐⭐⭐ |
| CRDT | 数据结构本身保证最终一致 | Figma, Notion | ⭐⭐⭐⭐⭐ |

CRDT 的核心思想：无论操作以什么顺序到达，最终结果相同（交换律）。听起来像魔法，但背后是一整套精密的数学证明。生产级方案推荐使用 **Y.js** 或 **Automerge**，别自己造轮子。

---

## 六、AI 集成：从输入到输出的全链路

技术架构讲完了。接下来看一个所有人都关心的话题——**AI 怎么嵌入到编辑器里？**

### 6.1 流程设计

AI 不是一个独立的"功能模块"，而是**嵌入在编辑流程中的**——用户在写作过程中随时召唤，生成的内容直接变成 Block 插入文档：

| 步骤 | 说明 |
| --- | --- |
| ① 用户输入 `/ai` | 触发 AI 面板 |
| ② 输入提示词 | 如"帮我续写"、"总结上文" |
| ③ 前端 POST `/api/ai/generate` | 携带 prompt + 前 2000 字文档上下文 |
| ④ 服务端调用 LLM | System Prompt + 文档上下文 + 用户指令 |
| ⑤ 返回生成内容 | 用户预览 → 一键插入为 Block |

支持任何兼容 OpenAI API 格式的服务（DeepSeek、通义千问、Ollama 等），只需配置 `.env`。不配置时使用模拟响应，不影响其他功能。

> 💡 AI 服务端实现见 [`server/ai.js`](https://github.com/zhengbei-lab/notion-lite/blob/main/server/ai.js)

### 6.2 AI 内容智能转 Block

AI 返回纯文本，前端会做 Markdown 解析自动转为对应的 Block 类型：`# → heading1`、`- → bulleted_list`、`1. → numbered_list`，其余作为 `paragraph`。

---

## 七、前端核心：Block 编辑器

后端讲了这么多，前端也值得一看。毕竟用户直接交互的是编辑器。

### 7.1 Block 组件架构

每个 Block 由三部分组成：

| 部分 | 说明 |
| --- | --- |
| **操作手柄** | Hover 时出现。⊕ 号添加新 Block，六点手柄 ⠿⠿ 点击弹出操作菜单（删除/复制/转换类型） |
| **编辑区域** | 普通文本用 `contentEditable`，代码块用 `textarea` |
| **键盘事件** | Enter → 新建 Block，Backspace → 删除空 Block，`/` → 斜杠命令，↑↓ → 导航 |

### 7.2 代码块编辑器

代码块使用 `textarea` 而非 `contentEditable`，支持：行号显示、Tab/Shift+Tab 缩进、Cmd+A 全选（不影响页面）、Cmd+Enter 跳出代码块、括号自动匹配、13 种语言标签切换、一键复制。

### 7.3 斜杠命令

输入 `/` 弹出命令面板，支持模糊搜索和键盘上下导航选择 Block 类型。

> 💡 所有前端组件源码见 [`src/components/`](https://github.com/zhengbei-lab/notion-lite/tree/main/src/components)

---

## 八、项目结构与运行

说了这么多原理，不如跑起来看看。

### 8.1 目录结构

```
notion-lite/
├── server/
│   ├── index.js            # Express + Socket.IO + Block 数据层
│   └── ai.js               # AI 写作服务
├── src/
│   ├── App.jsx              # 根组件
│   ├── components/          # Block、Editor、CodeBlock、SlashMenu、AIPanel、Sidebar 等
│   ├── hooks/               # useBlocks（状态管理）、useCollaboration（WebSocket）
│   └── utils/blockTypes.js  # Block 类型定义
├── package.json
└── vite.config.js
```

### 8.2 快速启动

```bash
git clone https://github.com/zhengbei-lab/notion-lite.git
cd notion-lite
npm install
npm run dev
# 前端: http://localhost:5173   后端: http://localhost:3001
```

### 8.3 调试接口

```bash
curl http://localhost:3001/api/stats                        # Block 统计
curl http://localhost:3001/api/operations                   # 操作日志
curl http://localhost:3001/api/documents/doc-001/snapshots  # 页面快照
```

### 8.4 多人协作体验

在 2-3 个浏览器标签页中同时打开 `http://localhost:5173`，每个标签页自动分配不同用户名和颜色，编辑内容实时同步。打开浏览器 Network → WS 面板可以看到前面讲的那些 WebSocket 消息在真实地流动。

---

## 九、如果用 Go 重写后端

如果你是 Go 开发者，看到这里可能会想：这个后端用 Go 写是不是更合适？答案是：**是的，但代价也不小**。

后端的本质就是 **HTTP API + WebSocket + 内存存储**，Go 生态都有成熟方案。但魔鬼在细节里。

### 9.1 技术栈映射

| 能力 | Node.js (当前) | Go (替换方案) |
| --- | --- | --- |
| HTTP 框架 | Express | Gin / Echo / Chi |
| WebSocket | Socket.IO | gorilla/websocket |
| 并发模型 | 单线程事件循环 | Goroutine + Channel |
| 内存存储 | Map（无锁） | map + sync.RWMutex |

### 9.2 关键差异

**数据模型完全一致** — Go 只需将 JS 对象换成 struct + json tag，字段名、类型、含义一一对应。

**存储层需要加锁** — Node.js 单线程天然无竞争。Go 多 Goroutine 并发，读操作用 `RLock()`，写操作用 `Lock()`，否则出现数据竞争。

**WebSocket 需要手动管理 Room** — 这是最大差异。Socket.IO 的 `socket.join(docId)` 和 `socket.to(docId).emit(...)` 在 Go 中需要自己实现：

- 定义 `Hub` 结构体维护 `map[docID]map[*Client]bool`
- 每个连接启动一个读 Goroutine + 一个写 Goroutine
- `Join()`、`Leave()`、`Broadcast()` 方法手动管理

大约多写 80 行代码。

### 9.3 Go vs Node.js 总结

| 维度 | Node.js | Go |
| --- | --- | --- |
| **并发安全** | 单线程，天然无竞争 | 需要 sync.RWMutex |
| **WebSocket** | Socket.IO 自带 Room/重连/心跳 | 原生 WebSocket，Room 手写 |
| **性能** | 单核约 1 万连接 | 轻松 10 万+ 连接 |
| **部署** | 需要 Node.js 运行时 | 编译为单二进制 |
| **开发效率** | 快（动态类型 + 丰富生态） | 慢（静态类型 + 手写较多） |

**结论**：Demo 或快速验证用 Node.js，上生产扛高并发用 Go。两者的**数据模型和 API 协议完全一致**，前端代码无需任何修改。选哪个取决于你团队的技术栈和规模。

---

## 十、Demo vs 生产级 Notion：差距在哪？

做完这个 Demo，有必要诚实地对比一下：哪些地方我们已经对齐了 Notion，哪些地方还差得远？

| 维度 | Demo 实现 | 生产级 Notion | 升级方向 |
| --- | --- | --- | --- |
| **存储** | 内存 Map | PostgreSQL + Sharding | 替换为真实数据库 |
| **Block 模型** | ✅ parent_id 树形 | ✅ 相同 | 架构一致 |
| **排序** | ✅ 分数排序法 | ✅ 相同 | 架构一致 |
| **软删除** | ✅ alive 标记 | ✅ 相同 | 架构一致 |
| **版本号** | ✅ version 自增 | ✅ + 乐观锁 CAS | 加 CAS 校验 |
| **操作日志** | ✅ Operation Log | ✅ + Undo/Redo | 加反向操作 |
| **撤销/重做** | ✅ Block 级快照 | ✅ Operation 级 | 改为 Operation 驱动 |
| **冲突处理** | Last Write Wins | CRDT（Y.js） | 引入 Y.js |
| **富文本** | Markdown 快捷输入 + 代码高亮 | 加粗/斜体/链接/颜色 | 引入 ProseMirror |
| **性能** | 全量加载 | 虚拟滚动 + 分页 | 引入虚拟列表 |

**核心结论**：数据模型是灵魂，我们已经对齐了。工程层面的差距——数据库、CRDT、性能优化——那是团队和时间的问题，不是思路的问题。

---

## 十一、坦白说——这个项目是 AI 写的

### 11.1 一个事实

没错——**本文 Demo 中的所有代码，全部由 AI（Claude）在对话中生成**。前端 React 组件、后端 Express 服务、WebSocket 协作、AI 集成，每一行代码都是 AI 写的。那我干了什么？

1. 提出需求："做一个类似 Notion 的协作文档 Demo"
2. 发现 Bug："光标跳动了"、"删除功能没有"、"代码块太简陋"
3. 提出方向："后端要对齐 Notion 的真实架构"
4. 审查质量："这个实现太 low 了，不像 Notion"

### 11.2 AI 能做到什么程度？

| 能力维度 | AI 完成度 | 具体表现 |
| --- | --- | --- |
| **脚手架搭建** | 100% | package.json、Vite 配置、Tailwind 配置、目录结构一次生成 |
| **CRUD 逻辑** | 100% | REST API、Block 增删改查，几乎不需要修改 |
| **UI 组件** | 95% | 所有组件可用，只有少量 JSX 语法错误需修 |
| **架构设计** | 80% | 初版"能用但粗糙"，需要人给方向才能对齐 Notion |
| **Bug 修复** | 90% | 给出报错信息后能准确定位，偶尔需要多轮 |
| **细节打磨** | 70% | 光标稳定性、交互体验等需要反复调整 |

### 11.3 AI 做不了的事

但如果我不参与呢？AI 会产出什么？——**一个能运行但没人想用的 Demo**。

**1. AI 不知道什么是"好"** — AI 的第一版后端就是普通 CRUD，和任何 TodoList 教程没区别。是我提供了 Notion 的架构分析，AI 才能照着方向实现。**AI 能写代码，但不会自己定义"什么代码值得写"。**

**2. AI 不会自己发现体验问题** — 光标跳动、代码块无法 Tab 缩进、删除功能缺失——都是我实际操作时发现的。**AI 能修 Bug，但不会自己去"用"产品。**

**3. AI 不理解读者** — AI 的第一版文章面面俱到但流于表面。是我说了"我是后端开发者"，文章才变成以 SQL 和架构为主线的风格。**AI 能写文章，但不知道谁在读。**

### 11.4 新的协作模式

这次协作效率非常高——从零到可运行 Demo + 完整技术文章，纯手写大概 2-3 天，用 AI 辅助只花了几个小时。这不是偷懒，而是真正的效率革命：

| | 人类 | AI |
| --- | --- | --- |
| **定义目标** | ✅ "做什么" | |
| **架构决策** | ✅ "怎么做" | |
| **质量把关** | ✅ "够不够好" | |
| **代码生成** | | ✅ 全部组件 |
| **Bug 修复** | 发现问题 | ✅ 定位 + 修复 |
| **文档撰写** | 定方向 | ✅ 结构 + 内容 |

### 11.5 对程序员的建议

**AI 不会取代程序员，但会取代不会用 AI 的程序员。** 这句话已经被说烂了，但我亲手验证了一遍：

1. **学架构，不要只学语法**。AI 写 CRUD 比你快 10 倍，但它不会自己设计出 Block 模型。你的价值在于**知道应该怎么设计**。

2. **学会提问**。"帮我写一个后端"和"用 parent_id 树形结构实现 Block 模型，支持分数排序和软删除"——产出的代码质量天差地别。

3. **保持手感**。亲自运行、亲自点击、亲自使用。**用户体验是跑出来的，不是写出来的。**

4. **理解 AI 的边界**。CRDT、分库分表、虚拟滚动——这些需要深度工程经验。AI 可以写出形式上正确的代码，但能不能在生产环境跑通，只有有经验的工程师知道。

> 未来的程序员不是"写代码的人"，而是"知道该写什么代码、能判断代码好坏的人"。AI 是你的 10x 执行力放大器，但方向盘始终在你手里。

---

## 十二、写在最后

回到开头的问题：你会怎么存一篇文档？

读完这篇文章，你的答案应该变了——不是存"一篇文档"，而是**存一棵由 Block 组成的树**。每次编辑不是覆盖，而是**追加一条 Operation**。多人协作不是锁文件，而是**同步操作日志**。

### 对后端开发者的启发

1. **"化整为零"**：大文档拆成小 Block，大表按 space_id 分片。这个思路适用于任何"大内容"存储场景——富文本、课程大纲、流程图、甚至聊天记录。

2. **Operation 驱动**：不要覆盖数据，记录操作。操作日志是协作、审计、回滚的天然数据源。下次你设计任何多人编辑场景，第一个想到的应该是"记操作，不记结果"。

3. **软删除是标配**：`alive` 字段支撑了回收站、协作删除同步、数据恢复。成本就一个 boolean 字段，但能救命。

4. **分数排序法**：任何"在两个元素之间插入"的场景都可以用——评论排序、任务排序、菜单排序，O(1) 复杂度。

5. **乐观更新**：先改 UI 再同步，用户感知延迟 = 0。这不是前端技巧，这是产品思维。

### 进一步学习方向

| 方向 | 推荐 | 说明 |
| --- | --- | --- |
| CRDT | Y.js / Automerge | 真正的无冲突协作 |
| 富文本编辑器 | ProseMirror / TipTap / Lexical | 加粗、斜体、链接等 |
| 数据库 | PostgreSQL + JSONB | 替换内存 Map |
| 搜索 | Elasticsearch | 全文检索 Block content |
| 消息队列 | Kafka / Redis Stream | Operation 异步处理 |

---

> 📦 **完整源码**：https://github.com/zhengbei-lab/notion-lite
>
> `git clone` → `npm install` → `npm run dev`，3 分钟跑起来。后端开发者重点看 `server/index.js`，前端看 `src/components/`。
>
> 如果这篇文章帮你理解了 Notion 的架构，欢迎 Star ⭐ 和转发。有问题评论区见。

---

**关注我，获取更多后端架构实战分享 🚀**