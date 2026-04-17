import { useState, useRef, useCallback, useEffect } from 'react';
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
  onUndo,
  onRedo,
}) {
  const [slashMenu, setSlashMenu] = useState(null); // { blockId, position }
  const [aiPanel, setAIPanel] = useState(null); // { blockId }
  const [focusBlockId, setFocusBlockId] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const editorRef = useRef(null);
  const titleRef = useRef(null);
  const blockRefs = useRef({});

  // 拦截 Ctrl+Z / Ctrl+Shift+Z 实现应用级撤销重做
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          onRedo();
        } else {
          onUndo();
        }
      }
      // Ctrl+Y 也支持重做
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        onRedo();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onUndo, onRedo]);

  // 同步外部标题（仅在未聚焦时更新，避免光标跳转）
  useEffect(() => {
    if (titleRef.current && document.activeElement !== titleRef.current && titleRef.current.textContent !== title) {
      titleRef.current.textContent = title;
    }
  }, [title]);

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
  // 列表类型回车延续同类型，空内容则退回 paragraph
  const continuousTypes = new Set(['bulleted_list', 'numbered_list', 'todo']);

  const handleEnter = useCallback(
    (blockId) => {
      const block = blocks.find((b) => b.id === blockId);
      let newType = 'paragraph';
      if (block && continuousTypes.has(block.type)) {
        // 空内容的列表项回车 → 退出列表，变回段落
        if (block.content === '') {
          onBlockUpdate(blockId, { type: 'paragraph' });
          return;
        }
        newType = block.type;
      }
      const newBlock = onBlockAdd(blockId, newType, '');
      if (newBlock) {
        focusBlock(newBlock.id);
      }
    },
    [blocks, onBlockAdd, onBlockUpdate, focusBlock]
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

  // 粘贴多行文本（从 Block 组件传来的剩余行）
  const handlePaste = useCallback(
    (blockId, lines) => {
      const block = blocks.find((b) => b.id === blockId);
      const pasteType = block ? block.type : 'paragraph';
      let lastBlockId = blockId;
      for (const line of lines) {
        const newBlock = onBlockAdd(lastBlockId, pasteType, line);
        if (newBlock) {
          lastBlockId = newBlock.id;
        }
      }
      if (lastBlockId !== blockId) {
        focusBlock(lastBlockId, true);
      }
    },
    [blocks, onBlockAdd, focusBlock]
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

      // 手动清除 DOM 中残留的 / 字符（因为 / 未同步到 state）
      const el = blockRefs.current[blockId];
      if (el) el.textContent = '';

      if (type === 'ai') {
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
    <div ref={editorRef} className="max-w-4xl mx-auto px-6 sm:px-12 md:px-16 py-8 pb-40">
      {/* 文档图标 */}
      <div className="text-6xl mb-3 cursor-pointer hover:opacity-80 transition-opacity">
        {icon}
      </div>

      {/* 文档标题 */}
      <div
        ref={titleRef}
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
      />

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
              onPaste={(lines) => handlePaste(block.id, lines)}
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
          anchorEl={slashMenu.position.anchorEl}
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
