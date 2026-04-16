import { useState, useRef, useCallback } from 'react';
import Block from './Block';
import SlashMenu from './SlashMenu';
import AIPanel from './AIPanel';
import { createBlock } from '../utils/blockTypes';

export default function Editor({
  blocks,
  title,
  icon,
  onTitleChange,
  onBlockUpdate,
  onBlockAdd,
  onBlockDelete,
  onBlockReorder,
  onCursorUpdate,
  onlineUsers,
}) {
  const [slashMenu, setSlashMenu] = useState(null); // { blockId, position }
  const [aiPanel, setAIPanel] = useState(null); // { blockId }
  const [focusBlockId, setFocusBlockId] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const editorRef = useRef(null);
  const blockRefs = useRef({});

  // 注册 block ref
  const registerBlockRef = useCallback((blockId, ref) => {
    blockRefs.current[blockId] = ref;
  }, []);

  // 聚焦某个 block
  const focusBlock = useCallback((blockId, toEnd = false) => {
    setTimeout(() => {
      const el = blockRefs.current[blockId];
      if (el) {
        el.focus();
        if (toEnd && el.textContent) {
          const range = document.createRange();
          const sel = window.getSelection();
          range.selectNodeContents(el);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }, 10);
  }, []);

  // 处理 Enter 键 — 新增 Block
  const handleEnter = useCallback(
    (blockId) => {
      const newBlock = onBlockAdd(blockId, 'paragraph', '');
      if (newBlock) {
        focusBlock(newBlock.id);
      }
    },
    [onBlockAdd, focusBlock]
  );

  // 处理 Backspace — 空 Block 删除
  const handleBackspace = useCallback(
    (blockId) => {
      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx > 0) {
        const prevBlock = blocks[idx - 1];
        onBlockDelete(blockId);
        focusBlock(prevBlock.id, true);
      }
    },
    [blocks, onBlockDelete, focusBlock]
  );

  // 复制 Block
  const handleDuplicate = useCallback(
    (blockId) => {
      const block = blocks.find((b) => b.id === blockId);
      if (block) {
        onBlockAdd(blockId, block.type, block.content);
      }
    },
    [blocks, onBlockAdd]
  );

  // 处理上下键导航
  const handleArrowUp = useCallback(
    (blockId) => {
      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx > 0) {
        focusBlock(blocks[idx - 1].id, true);
      }
    },
    [blocks, focusBlock]
  );

  const handleArrowDown = useCallback(
    (blockId) => {
      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx < blocks.length - 1) {
        focusBlock(blocks[idx + 1].id);
      }
    },
    [blocks, focusBlock]
  );

  // 打开斜杠菜单
  const handleSlashMenu = useCallback((blockId, position) => {
    setSlashMenu({ blockId, position });
  }, []);

  // 斜杠菜单选择
  const handleSlashSelect = useCallback(
    (type) => {
      if (!slashMenu) return;
      const { blockId } = slashMenu;

      if (type === 'ai') {
        // 清空当前 block 的 / 字符
        onBlockUpdate(blockId, { content: '', type: 'paragraph' });
        setAIPanel({ blockId });
      } else {
        onBlockUpdate(blockId, { content: '', type });
      }
      setSlashMenu(null);
      focusBlock(blockId);
    },
    [slashMenu, onBlockUpdate, focusBlock]
  );

  // AI 内容插入
  const handleAIInsert = useCallback(
    (content) => {
      if (!aiPanel) return;
      const { blockId } = aiPanel;

      // 将 AI 返回的内容按段落分割，插入为多个 Block
      const lines = content.split('\n').filter((l) => l.trim());
      if (lines.length === 0) return;

      // 更新第一行到当前 block
      onBlockUpdate(blockId, { content: lines[0] });

      // 后续行作为新 block 添加
      let lastBlockId = blockId;
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        let type = 'paragraph';
        let text = line;

        // 简单解析 Markdown 格式
        if (line.startsWith('# ')) { type = 'heading1'; text = line.slice(2); }
        else if (line.startsWith('## ')) { type = 'heading2'; text = line.slice(3); }
        else if (line.startsWith('### ')) { type = 'heading3'; text = line.slice(4); }
        else if (line.startsWith('- ') || line.startsWith('* ')) { type = 'bulleted_list'; text = line.slice(2); }
        else if (/^\d+\.\s/.test(line)) { type = 'numbered_list'; text = line.replace(/^\d+\.\s/, ''); }

        const newBlock = onBlockAdd(lastBlockId, type, text);
        if (newBlock) lastBlockId = newBlock.id;
      }

      setAIPanel(null);
    },
    [aiPanel, onBlockUpdate, onBlockAdd]
  );

  // 拖拽处理
  const handleDragStart = useCallback((e, blockId) => {
    e.dataTransfer.setData('text/plain', blockId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback(
    (e, targetIndex) => {
      e.preventDefault();
      const blockId = e.dataTransfer.getData('text/plain');
      if (blockId) {
        onBlockReorder(blockId, targetIndex);
      }
      setDragOverIndex(null);
    },
    [onBlockReorder]
  );

  // 获取 block 的序号（有序列表用）
  const getListIndex = useCallback(
    (blockId) => {
      const idx = blocks.findIndex((b) => b.id === blockId);
      let count = 1;
      for (let i = idx - 1; i >= 0; i--) {
        if (blocks[i].type === 'numbered_list') count++;
        else break;
      }
      return count;
    },
    [blocks]
  );

  return (
    <div ref={editorRef} className="max-w-3xl mx-auto px-6 sm:px-12 md:px-24 py-8 pb-40">
      {/* 文档图标 */}
      <div className="text-6xl mb-3 cursor-pointer hover:opacity-80 transition-opacity">
        {icon}
      </div>

      {/* 文档标题 */}
      <div
        contentEditable
        suppressContentEditableWarning
        data-placeholder="无标题"
        className="text-4xl font-bold text-notion-text mb-6 outline-none leading-tight"
        onInput={(e) => onTitleChange(e.currentTarget.textContent)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (blocks.length > 0) focusBlock(blocks[0].id);
          }
        }}
      >
        {title}
      </div>

      {/* Block 列表 */}
      <div className="space-y-0.5">
        {blocks.map((block, index) => (
          <div
            key={block.id}
            className={`${dragOverIndex === index ? 'drag-over' : ''}`}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={(e) => handleDrop(e, index)}
          >
            <Block
              block={block}
              listIndex={block.type === 'numbered_list' ? getListIndex(block.id) : null}
              isFocused={focusBlockId === block.id}
              onFocus={() => setFocusBlockId(block.id)}
              onUpdate={(updates) => onBlockUpdate(block.id, updates)}
              onEnter={() => handleEnter(block.id)}
              onBackspace={() => handleBackspace(block.id)}
              onArrowUp={() => handleArrowUp(block.id)}
              onArrowDown={() => handleArrowDown(block.id)}
              onSlashMenu={(pos) => handleSlashMenu(block.id, pos)}
              onDragStart={(e) => handleDragStart(e, block.id)}
              onDelete={() => onBlockDelete(block.id)}
              onDuplicate={() => handleDuplicate(block.id)}
              registerRef={(ref) => registerBlockRef(block.id, ref)}
              remoteCursors={onlineUsers.filter(
                (u) => u.cursor?.blockId === block.id
              )}
            />
          </div>
        ))}
      </div>

      {/* 底部点击区域：新建 Block */}
      <div
        className="h-32 cursor-text"
        onClick={() => {
          if (blocks.length > 0) {
            const lastBlock = blocks[blocks.length - 1];
            if (lastBlock.content === '') {
              focusBlock(lastBlock.id);
            } else {
              const newBlock = onBlockAdd(lastBlock.id, 'paragraph', '');
              if (newBlock) focusBlock(newBlock.id);
            }
          }
        }}
      />

      {/* 斜杠命令菜单 */}
      {slashMenu && (
        <SlashMenu
          position={slashMenu.position}
          onSelect={handleSlashSelect}
          onClose={() => setSlashMenu(null)}
        />
      )}

      {/* AI 写作面板 */}
      {aiPanel && (
        <AIPanel
          onInsert={handleAIInsert}
          onClose={() => setAIPanel(null)}
          contextBlocks={blocks}
        />
      )}
    </div>
  );
}
