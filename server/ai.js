import dotenv from 'dotenv';
dotenv.config();

const AI_API_KEY = process.env.AI_API_KEY;
const AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
const AI_MODEL = process.env.AI_MODEL || 'gpt-3.5-turbo';

/**
 * 处理 AI 写作请求
 * 支持多种写作场景：续写、润色、翻译、摘要、扩展等
 */
export async function handleAIRequest(prompt, context = '') {
  // 如果没有配置 API Key，使用内置的模拟响应
  if (!AI_API_KEY || AI_API_KEY === 'your-api-key-here') {
    return getMockResponse(prompt);
  }

  const systemPrompt = `你是一个专业的写作助手，嵌入在一个类似 Notion 的文档编辑器中。
你的任务是根据用户的指令帮助他们写作。请注意：
1. 直接输出内容，不要加多余的解释
2. 保持专业、简洁的写作风格
3. 根据上下文调整语气和格式
4. 支持中英文写作`;

  const messages = [
    { role: 'system', content: systemPrompt },
  ];

  if (context) {
    messages.push({ role: 'user', content: `当前文档上下文：\n${context}` });
  }

  messages.push({ role: 'user', content: prompt });

  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      max_tokens: 1024,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`AI API 错误: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * 模拟 AI 响应（无 API Key 时使用）
 */
function getMockResponse(prompt) {
  const lowerPrompt = prompt.toLowerCase();

  if (lowerPrompt.includes('续写') || lowerPrompt.includes('continue')) {
    return '基于以上内容，我们可以进一步探讨这个话题的深层含义。首先，从技术实现的角度来看，这种方案具有良好的可扩展性和维护性。其次，在实际应用中，我们已经看到了许多成功的案例，证明了这种方法的有效性。';
  }

  if (lowerPrompt.includes('翻译') || lowerPrompt.includes('translate')) {
    return 'This is a collaborative document editor inspired by Notion. It supports real-time collaboration, AI-assisted writing, and a block-based content model that makes document creation intuitive and flexible.';
  }

  if (lowerPrompt.includes('总结') || lowerPrompt.includes('summary') || lowerPrompt.includes('摘要')) {
    return '本文档介绍了 Notion Lite 的核心功能，包括基于 Block 的编辑模型、WebSocket 实时协作机制和 AI 辅助写作能力。该项目旨在通过简化实现来帮助开发者理解协作文档系统的核心架构。';
  }

  if (lowerPrompt.includes('代码') || lowerPrompt.includes('code')) {
    return '```javascript\n// 示例：创建一个 Block 组件\nfunction Block({ type, content, onChange }) {\n  const handleInput = (e) => {\n    onChange(e.target.textContent);\n  };\n\n  return (\n    <div\n      className={`block block-${type}`}\n      contentEditable\n      onInput={handleInput}\n      suppressContentEditableWarning\n    >\n      {content}\n    </div>\n  );\n}\n```';
  }

  if (lowerPrompt.includes('列表') || lowerPrompt.includes('list')) {
    return '1. 架构设计：采用 Block 模型，所有内容都是独立的可编辑单元\n2. 实时协作：基于 WebSocket + OT 算法实现多人同时编辑\n3. AI 集成：通过 /ai 命令唤起智能写作助手\n4. 性能优化：虚拟滚动 + 增量更新，保证大文档流畅编辑\n5. 扩展性：插件化架构，支持自定义 Block 类型';
  }

  // 默认响应
  return `好的，关于「${prompt}」，这里是我的建议：

协作文档的核心在于三个方面：首先是 **数据模型** —— 采用 Block 架构让每个内容单元独立管理；其次是 **实时同步** —— 通过 WebSocket 实现毫秒级的多端同步；最后是 **冲突处理** —— 使用 OT（Operational Transformation）或 CRDT 算法确保多人编辑的一致性。

这种设计让文档不仅是静态内容的载体，更是团队协作的实时空间。`;
}
