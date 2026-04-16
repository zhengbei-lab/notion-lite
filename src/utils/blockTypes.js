/**
 * Block 类型定义
 * Notion 的核心理念：Everything is a Block
 */

export const BLOCK_TYPES = {
  paragraph: {
    type: 'paragraph',
    label: '正文',
    description: '普通文本段落',
    icon: '📝',
    shortcut: '/text',
  },
  heading1: {
    type: 'heading1',
    label: '标题 1',
    description: '大标题',
    icon: 'H₁',
    shortcut: '/h1',
  },
  heading2: {
    type: 'heading2',
    label: '标题 2',
    description: '中标题',
    icon: 'H₂',
    shortcut: '/h2',
  },
  heading3: {
    type: 'heading3',
    label: '标题 3',
    description: '小标题',
    icon: 'H₃',
    shortcut: '/h3',
  },
  bulleted_list: {
    type: 'bulleted_list',
    label: '无序列表',
    description: '创建一个简单的列表',
    icon: '•',
    shortcut: '/bullet',
  },
  numbered_list: {
    type: 'numbered_list',
    label: '有序列表',
    description: '带编号的列表',
    icon: '1.',
    shortcut: '/num',
  },
  todo: {
    type: 'todo',
    label: '待办事项',
    description: '任务清单',
    icon: '☑️',
    shortcut: '/todo',
  },
  quote: {
    type: 'quote',
    label: '引用',
    description: '引用一段文字',
    icon: '❝',
    shortcut: '/quote',
  },
  code: {
    type: 'code',
    label: '代码块',
    description: '编写代码片段',
    icon: '</>',
    shortcut: '/code',
  },
  callout: {
    type: 'callout',
    label: '提示框',
    description: '高亮显示重要内容',
    icon: '💡',
    shortcut: '/callout',
  },
  divider: {
    type: 'divider',
    label: '分割线',
    description: '分隔内容区块',
    icon: '—',
    shortcut: '/divider',
  },
};

export const SLASH_MENU_ITEMS = [
  { ...BLOCK_TYPES.paragraph, category: '基础' },
  { ...BLOCK_TYPES.heading1, category: '基础' },
  { ...BLOCK_TYPES.heading2, category: '基础' },
  { ...BLOCK_TYPES.heading3, category: '基础' },
  { ...BLOCK_TYPES.bulleted_list, category: '列表' },
  { ...BLOCK_TYPES.numbered_list, category: '列表' },
  { ...BLOCK_TYPES.todo, category: '列表' },
  { ...BLOCK_TYPES.quote, category: '媒体' },
  { ...BLOCK_TYPES.code, category: '媒体' },
  { ...BLOCK_TYPES.callout, category: '媒体' },
  { ...BLOCK_TYPES.divider, category: '媒体' },
  {
    type: 'ai',
    label: 'AI 写作',
    description: '让 AI 帮你写作',
    icon: '🤖',
    shortcut: '/ai',
    category: 'AI',
  },
];

export function createBlock(type = 'paragraph', content = '', properties = {}) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    content,
    properties,
  };
}
