# Notion Lite ✨

一个从零实现的类 Notion 协作文档编辑器 Demo，深度对齐 Notion 真实后端架构。

> 配套文章：[深度拆解 Notion 架构：从后端视角手撸一个协作文档系统](article.md)

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?logo=socket.io&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)

## 功能特性

- **Block 编辑器** — 标题、段落、列表、待办、代码块、引用、提示框、分割线
- **实时协作** — 多人同时编辑，内容实时同步，在线用户头像显示
- **斜杠命令** — 输入 `/` 快速切换 Block 类型，支持模糊搜索
- **AI 写作助手** — 输入 `/ai` 唤起 AI 辅助写作（支持 OpenAI 兼容 API）
- **代码编辑器** — 行号、Tab 缩进、括号匹配、语言切换、一键复制
- **Block 操作菜单** — 点击手柄可删除、复制、转换 Block 类型
- **文档管理** — 侧边栏新建 / 切换 / 删除文档

## 后端架构亮点

对齐 Notion 真实设计原理，而非简单 CRUD：

| 特性 | 说明 |
| --- | --- |
| **Block 树形模型** | 所有内容（包括页面）都是 Block，通过 `parent_id` 构成树 |
| **分数排序法** | `position` 用浮点数实现，插入时取中间值，零额外更新 |
| **软删除** | `alive` 标记，支持回收站和数据恢复 |
| **版本号** | 每个 Block 维护 `version`，支持乐观锁 |
| **操作日志** | 每次编辑产生 Operation 记录，支持审计和历史回放 |
| **页面快照** | 定期保存完整页面状态，支持历史版本 |

## 快速开始

```bash
git clone https://github.com/your-username/notion-lite.git
cd notion-lite
npm install
npm run dev
```

- 前端：http://localhost:5173
- 后端：http://localhost:3001

打开 2-3 个浏览器标签页即可体验多人协作。

## 配置 AI（可选）

复制 `.env.example` 为 `.env`，填入 API Key：

```bash
cp .env.example .env
```

```env
AI_API_KEY=sk-xxx
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat
```

支持任何兼容 OpenAI API 的服务（DeepSeek、通义千问、Ollama 等）。不配置时使用模拟响应，不影响其他功能。

## 调试接口

```bash
# Block 统计
curl http://localhost:3001/api/stats

# 操作日志
curl http://localhost:3001/api/operations

# 页面快照
curl http://localhost:3001/api/documents/doc-001/snapshots
```

## 项目结构

```
notion-lite/
├── server/
│   ├── index.js            # Express + Socket.IO + Block 数据层
│   └── ai.js               # AI 写作服务
├── src/
│   ├── App.jsx              # 根组件
│   ├── components/
│   │   ├── Editor.jsx       # 编辑器主容器
│   │   ├── Block.jsx        # Block 组件（核心）
│   │   ├── CodeBlock.jsx    # 代码编辑器
│   │   ├── BlockMenu.jsx    # Block 操作菜单
│   │   ├── SlashMenu.jsx    # 斜杠命令菜单
│   │   ├── AIPanel.jsx      # AI 写作面板
│   │   ├── Sidebar.jsx      # 侧边栏
│   │   └── CollaborationBar.jsx
│   ├── hooks/
│   │   ├── useBlocks.js     # Block 状态管理
│   │   └── useCollaboration.js  # WebSocket 协作
│   └── utils/
│       └── blockTypes.js    # Block 类型定义
├── article.md               # 配套技术文章
├── package.json
└── vite.config.js
```

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端框架 | React 18 |
| 构建工具 | Vite 5 |
| 样式 | Tailwind CSS |
| 后端 | Express + Socket.IO |
| AI | OpenAI 兼容 API |

## License

MIT
