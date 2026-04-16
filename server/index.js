import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { handleAIRequest } from './ai.js';

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());

// =====================================================================
//  数据层：模拟 Notion 的存储架构
//  实际 Notion 使用 PostgreSQL + Sharding + S3
//  这里用内存 Map 模拟，但保持数据结构一致
// =====================================================================

/**
 * Block 存储表（模拟 PostgreSQL blocks 表）
 *
 * 在真实 Notion 中，这是一个按 space_id 分片的 PostgreSQL 表：
 * CREATE TABLE blocks (
 *   id         UUID PRIMARY KEY,
 *   type       VARCHAR(50) NOT NULL,
 *   parent_id  UUID REFERENCES blocks(id),
 *   space_id   UUID NOT NULL,         -- 用于分库分表的 sharding key
 *   content    JSONB,                 -- 存储文本、属性等
 *   properties JSONB DEFAULT '{}',
 *   version    INTEGER DEFAULT 1,     -- 乐观锁版本号
 *   position   FLOAT DEFAULT 0,       -- 排序用（分数排序法）
 *   alive      BOOLEAN DEFAULT TRUE,  -- 软删除标记
 *   created_at TIMESTAMPTZ DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ DEFAULT NOW(),
 *   created_by UUID
 * );
 * CREATE INDEX idx_blocks_parent ON blocks(parent_id, position);
 * CREATE INDEX idx_blocks_space  ON blocks(space_id);
 */
const blockStore = new Map(); // blockId -> BlockRecord

/**
 * 操作日志表（模拟 Notion 的 Operation Log）
 *
 * Notion 的每一次编辑都会产生一条 Operation 记录：
 * CREATE TABLE operations (
 *   id         BIGSERIAL PRIMARY KEY,
 *   block_id   UUID NOT NULL,
 *   user_id    UUID NOT NULL,
 *   type       VARCHAR(50),           -- 'update', 'create', 'delete', 'reorder'
 *   path       TEXT[],                -- 修改路径, 如 ['content'], ['properties', 'checked']
 *   args       JSONB,                 -- 操作参数
 *   version    INTEGER,               -- 操作后的版本号
 *   timestamp  TIMESTAMPTZ DEFAULT NOW()
 * );
 */
const operationLog = [];

/**
 * 快照存储（模拟 S3 对象存储中的 Snapshot）
 * 用于实现"页面历史记录"功能
 */
const snapshots = new Map(); // pageId -> [{version, timestamp, blocks}]

const defaultSpaceId = 'space-001';

// =====================================================================
//  Block CRUD 操作 — 核心数据访问层
// =====================================================================

/** 生成 Block ID（模拟 Snowflake 分布式 ID） */
function generateBlockId() {
  return uuidv4();
}

/**
 * 分数排序法（Fractional Indexing）
 * 在两个 Block 之间插入时计算 position，无需更新其他行
 */
function generatePosition(afterPos, beforePos) {
  if (afterPos == null && beforePos == null) return 1.0;
  if (afterPos == null) return beforePos - 1.0;
  if (beforePos == null) return afterPos + 1.0;
  return (afterPos + beforePos) / 2;
}

/**
 * 获取子 Block 列表
 * SQL: SELECT * FROM blocks WHERE parent_id=? AND alive=true ORDER BY position
 */
function getChildBlocks(parentId) {
  return Array.from(blockStore.values())
    .filter((b) => b.parent_id === parentId && b.alive)
    .sort((a, b) => a.position - b.position);
}

/** 获取所有 Page Block */
function getPageBlocks(spaceId = defaultSpaceId) {
  return Array.from(blockStore.values())
    .filter((b) => b.type === 'page' && b.space_id === spaceId && b.alive)
    .sort((a, b) => a.position - b.position);
}

/** 记录操作日志 */
function recordOperation(blockId, userId, type, path, args, version) {
  operationLog.push({
    id: operationLog.length + 1,
    block_id: blockId,
    user_id: userId,
    type,
    path,
    args,
    version,
    timestamp: new Date().toISOString(),
  });
}

/** 保存页面快照（模拟定期快照到 S3） */
function saveSnapshot(pageId) {
  const children = getChildBlocks(pageId);
  const page = blockStore.get(pageId);
  if (!page) return;
  if (!snapshots.has(pageId)) snapshots.set(pageId, []);
  const list = snapshots.get(pageId);
  if (list.length >= 50) list.shift();
  list.push({
    version: page.version,
    timestamp: new Date().toISOString(),
    title: page.content,
    blocks: children.map(({ id, type, content, properties, position }) => ({
      id, type, content, properties, position,
    })),
  });
}

// =====================================================================
//  初始化示例数据 — 模拟 Notion 的 Block 树
// =====================================================================
function initializeData() {
  // Page 本身也是一个 Block
  const page1 = {
    id: 'doc-001', type: 'page', parent_id: null, space_id: defaultSpaceId,
    content: '欢迎使用 Notion Lite ✨', properties: { icon: '📝' },
    version: 1, position: 1.0, alive: true,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: null,
  };
  blockStore.set(page1.id, page1);

  const page1Blocks = [
    { type: 'heading1', content: '欢迎使用 Notion Lite', properties: {} },
    { type: 'paragraph', content: '这是一个简化版的 Notion 协作文档编辑器，支持多人实时协作和 AI 辅助写作。', properties: {} },
    { type: 'heading2', content: '✅ 核心功能', properties: {} },
    { type: 'bulleted_list', content: 'Block 模型：所有内容都是 Block，支持多种类型', properties: {} },
    { type: 'bulleted_list', content: '实时协作：基于 WebSocket 的多人同时编辑', properties: {} },
    { type: 'bulleted_list', content: 'AI 写作助手：输入 /ai 唤起 AI 辅助写作', properties: {} },
    { type: 'bulleted_list', content: '斜杠命令：输入 / 快速切换 Block 类型', properties: {} },
    { type: 'divider', content: '', properties: {} },
    { type: 'heading2', content: '🚀 快速开始', properties: {} },
    { type: 'numbered_list', content: '点击任意文字区域开始编辑', properties: {} },
    { type: 'numbered_list', content: '按 Enter 创建新行，按 / 打开命令菜单', properties: {} },
    { type: 'numbered_list', content: '输入 /ai 后跟提示词，让 AI 帮你写作', properties: {} },
    { type: 'callout', content: '💡 提示：在多个浏览器窗口中打开此页面，可以体验实时协作功能！', properties: { emoji: '💡' } },
    { type: 'code', content: '// Notion 的核心: Everything is a Block\nconst block = {\n  id: "uuid",\n  type: "paragraph",\n  parent_id: "page-id",\n  content: "Hello",\n  version: 1,\n  position: 1.0\n};', properties: { language: 'javascript' } },
    { type: 'quote', content: '"简约不是少，而是没有多余。" — 设计之道', properties: {} },
  ];
  page1Blocks.forEach((b, i) => {
    const id = generateBlockId();
    blockStore.set(id, {
      id, type: b.type, parent_id: page1.id, space_id: defaultSpaceId,
      content: b.content, properties: b.properties,
      version: 1, position: (i + 1) * 1.0, alive: true,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: null,
    });
  });

  const page2 = {
    id: 'doc-002', type: 'page', parent_id: null, space_id: defaultSpaceId,
    content: '项目周报 - 2026 W16', properties: { icon: '📊' },
    version: 1, position: 2.0, alive: true,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: null,
  };
  blockStore.set(page2.id, page2);

  [
    { type: 'heading1', content: '项目周报 - 2026 W16', properties: {} },
    { type: 'paragraph', content: '本周工作总结与下周计划。', properties: {} },
    { type: 'heading2', content: '本周完成', properties: {} },
    { type: 'todo', content: '完成 Notion Lite 核心编辑器', properties: { checked: true } },
    { type: 'todo', content: '实现 WebSocket 实时协作', properties: { checked: true } },
    { type: 'todo', content: '集成 AI 写作助手', properties: { checked: false } },
    { type: 'heading2', content: '下周计划', properties: {} },
    { type: 'bulleted_list', content: '性能优化与错误处理', properties: {} },
    { type: 'bulleted_list', content: '用户测试与反馈收集', properties: {} },
  ].forEach((b, i) => {
    const id = generateBlockId();
    blockStore.set(id, {
      id, type: b.type, parent_id: page2.id, space_id: defaultSpaceId,
      content: b.content, properties: b.properties,
      version: 1, position: (i + 1) * 1.0, alive: true,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: null,
    });
  });

  console.log(`📦 初始化完成: ${blockStore.size} 个 Block`);
}

initializeData();

// =====================================================================
//  REST API
// =====================================================================
app.get('/api/documents', (req, res) => {
  const pages = getPageBlocks();
  res.json(pages.map((p) => ({
    id: p.id, title: p.content, icon: p.properties?.icon || '📄', updatedAt: p.updated_at,
  })));
});

app.get('/api/documents/:id', (req, res) => {
  const page = blockStore.get(req.params.id);
  if (!page || !page.alive || page.type !== 'page') {
    return res.status(404).json({ error: '文档不存在' });
  }
  const children = getChildBlocks(page.id);
  res.json({
    id: page.id,
    title: page.content,
    icon: page.properties?.icon || '📄',
    version: page.version,
    blocks: children.map(({ id, type, content, properties, version, position }) => ({
      id, type, content, properties, version, position,
    })),
  });
});

app.post('/api/documents', (req, res) => {
  const pages = getPageBlocks();
  const maxPos = pages.length > 0 ? Math.max(...pages.map((p) => p.position)) : 0;
  const pageId = generateBlockId();
  const now = new Date().toISOString();
  blockStore.set(pageId, {
    id: pageId, type: 'page', parent_id: null, space_id: defaultSpaceId,
    content: req.body.title || '无标题', properties: { icon: req.body.icon || '📄' },
    version: 1, position: maxPos + 1.0, alive: true,
    created_at: now, updated_at: now, created_by: null,
  });
  const emptyId = generateBlockId();
  blockStore.set(emptyId, {
    id: emptyId, type: 'paragraph', parent_id: pageId, space_id: defaultSpaceId,
    content: '', properties: {},
    version: 1, position: 1.0, alive: true,
    created_at: now, updated_at: now, created_by: null,
  });
  recordOperation(pageId, null, 'create', [], { type: 'page' }, 1);
  res.json({ id: pageId, title: req.body.title || '无标题', icon: req.body.icon || '📄' });
});

app.delete('/api/documents/:id', (req, res) => {
  const page = blockStore.get(req.params.id);
  if (!page || !page.alive) return res.status(404).json({ error: '文档不存在' });
  page.alive = false;
  page.updated_at = new Date().toISOString();
  getChildBlocks(page.id).forEach((child) => { child.alive = false; });
  recordOperation(page.id, null, 'delete', [], {}, page.version);
  res.json({ success: true });
});

app.get('/api/operations', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(operationLog.slice(-limit));
});

app.get('/api/documents/:id/snapshots', (req, res) => {
  res.json((snapshots.get(req.params.id) || []).map(({ version, timestamp, title }) => ({ version, timestamp, title })));
});

app.get('/api/stats', (req, res) => {
  const all = Array.from(blockStore.values());
  res.json({
    totalBlocks: all.length,
    aliveBlocks: all.filter((b) => b.alive).length,
    pages: all.filter((b) => b.type === 'page' && b.alive).length,
    operations: operationLog.length,
  });
});

app.post('/api/ai/generate', async (req, res) => {
  const { prompt, context } = req.body;
  if (!prompt) return res.status(400).json({ error: '请提供提示词' });
  try {
    const result = await handleAIRequest(prompt, context);
    res.json({ content: result });
  } catch (err) {
    console.error('AI 请求失败:', err.message);
    res.status(500).json({ error: 'AI 服务暂不可用' });
  }
});

// =====================================================================
//  WebSocket 实时协作
// =====================================================================
const onlineUsers = new Map();
const userColors = ['#E03E3E','#D9730D','#DFAB01','#0F7B6C','#0B6E99','#6940A5','#AD1A72','#2EAADC'];
let colorIndex = 0;

io.on('connection', (socket) => {
  console.log(`🔌 连接: ${socket.id}`);

  socket.on('join-document', ({ docId, userName }) => {
    socket.join(docId);
    const color = userColors[colorIndex++ % userColors.length];
    onlineUsers.set(socket.id, { id: socket.id, name: userName || `用户${Math.floor(Math.random()*1000)}`, color, docId, cursor: null });
    io.to(docId).emit('users-update', getRoomUsers(docId));
    console.log(`👤 ${onlineUsers.get(socket.id).name} 加入 ${docId}`);
  });

  socket.on('block-update', ({ docId, block }) => {
    const record = blockStore.get(block.id);
    if (record && record.alive) {
      if (block.content !== undefined) record.content = block.content;
      if (block.type !== undefined) record.type = block.type;
      if (block.properties !== undefined) record.properties = { ...record.properties, ...block.properties };
      record.version++;
      record.updated_at = new Date().toISOString();
      recordOperation(block.id, onlineUsers.get(socket.id)?.name, 'update', ['content'], { value: block.content }, record.version);
    }
    socket.to(docId).emit('block-updated', { block, userId: socket.id });
  });

  socket.on('block-add', ({ docId, block, afterBlockId }) => {
    const children = getChildBlocks(docId);
    const afterIdx = children.findIndex((b) => b.id === afterBlockId);
    let newPos;
    if (afterIdx === -1) newPos = children.length > 0 ? children[children.length-1].position + 1.0 : 1.0;
    else if (afterIdx === children.length - 1) newPos = children[afterIdx].position + 1.0;
    else newPos = generatePosition(children[afterIdx].position, children[afterIdx+1].position);

    const now = new Date().toISOString();
    blockStore.set(block.id, {
      id: block.id, type: block.type || 'paragraph', parent_id: docId, space_id: defaultSpaceId,
      content: block.content || '', properties: block.properties || {},
      version: 1, position: newPos, alive: true,
      created_at: now, updated_at: now, created_by: onlineUsers.get(socket.id)?.name,
    });
    const page = blockStore.get(docId);
    if (page) { page.version++; page.updated_at = now; }
    recordOperation(block.id, onlineUsers.get(socket.id)?.name, 'create', [], { after_id: afterBlockId }, 1);
    socket.to(docId).emit('block-added', { block, afterBlockId, userId: socket.id });
  });

  socket.on('block-delete', ({ docId, blockId }) => {
    const record = blockStore.get(blockId);
    if (record) {
      record.alive = false;
      record.updated_at = new Date().toISOString();
      recordOperation(blockId, onlineUsers.get(socket.id)?.name, 'delete', [], {}, record.version);
    }
    const page = blockStore.get(docId);
    if (page) { page.version++; page.updated_at = new Date().toISOString(); }
    socket.to(docId).emit('block-deleted', { blockId, userId: socket.id });
  });

  socket.on('block-reorder', ({ docId, blockId, newIndex }) => {
    const children = getChildBlocks(docId);
    const record = blockStore.get(blockId);
    if (!record) return;
    let newPos;
    const filtered = children.filter(c => c.id !== blockId);
    if (newIndex <= 0) newPos = filtered[0] ? filtered[0].position - 1.0 : 1.0;
    else if (newIndex >= filtered.length) newPos = filtered[filtered.length-1].position + 1.0;
    else newPos = generatePosition(filtered[newIndex-1].position, filtered[newIndex].position);
    record.position = newPos;
    record.version++;
    record.updated_at = new Date().toISOString();
    socket.to(docId).emit('block-reordered', { blockId, newIndex, userId: socket.id });
  });

  socket.on('title-update', ({ docId, title }) => {
    const page = blockStore.get(docId);
    if (page) { page.content = title; page.version++; page.updated_at = new Date().toISOString(); saveSnapshot(docId); }
    socket.to(docId).emit('title-updated', { title, userId: socket.id });
  });

  socket.on('cursor-update', ({ docId, blockId, offset }) => {
    const user = onlineUsers.get(socket.id);
    if (user) user.cursor = { blockId, offset };
    socket.to(docId).emit('cursor-updated', { userId: socket.id, userName: user?.name, color: user?.color, blockId, offset });
  });

  socket.on('disconnect', () => {
    const user = onlineUsers.get(socket.id);
    if (user) { onlineUsers.delete(socket.id); io.to(user.docId).emit('users-update', getRoomUsers(user.docId)); console.log(`👋 ${user.name} 离开`); }
  });
});

function getRoomUsers(docId) {
  return Array.from(onlineUsers.values()).filter((u) => u.docId === docId);
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🚀 Notion Lite 服务已启动: http://localhost:${PORT}`);
  console.log(`📝 前端: http://localhost:5173`);
  console.log(`📊 统计: http://localhost:${PORT}/api/stats`);
  console.log(`📋 操作日志: http://localhost:${PORT}/api/operations\n`);
});