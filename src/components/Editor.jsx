import { useState, useRef, useCallback, useEffect } from 'react';
import Block from './Block';
import SlashMenu from './SlashMenu';
import AIPanel from './AIPanel';
import InlineToolbar from './InlineToolbar';
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
  const [selectedBlockIds, setSelectedBlockIds] = useState(new Set());
  const selectedBlockIdsRef = useRef(selectedBlockIds);
  selectedBlockIdsRef.current = selectedBlockIds;
  const selectionAnchorRef = useRef(null); // 块级选择起点 blockId
  const isBlockSelectingRef = useRef(false);
  const editorRef = useRef(null);
  const titleRef = useRef(null);
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

  // 块级选择：鼠标跨 Block 拖拽时高亮整个 Block
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const getBlockIdFromEvent = (e) => {
      const el = e.target.closest?.('[data-block-id]');
      return el?.getAttribute('data-block-id') || null;
    };

    const handleMouseDown = (e) => {
      // 点击时清除块级选择
      setSelectedBlockIds(new Set());
      isBlockSelectingRef.current = false;
      const blockId = getBlockIdFromEvent(e);
      if (blockId) {
        selectionAnchorRef.current = blockId;
      }
    };

    const handleMouseMove = (e) => {
      if (e.buttons !== 1 || !selectionAnchorRef.current) return;
      const currentBlockId = getBlockIdFromEvent(e);
      if (!currentBlockId || currentBlockId === selectionAnchorRef.current) {
        // 还在同一个 block 内，不进入块级选择
        if (!isBlockSelectingRef.current) return;
      }

      const anchorIdx = blocks.findIndex(b => b.id === selectionAnchorRef.current);
      const currentIdx = blocks.findIndex(b => b.id === currentBlockId);
      if (anchorIdx === -1 || currentIdx === -1) return;

      if (anchorIdx !== currentIdx) {
        // 进入块级选择模式
        if (!isBlockSelectingRef.current) {
          isBlockSelectingRef.current = true;
          window.getSelection()?.removeAllRanges();
        }
        const start = Math.min(anchorIdx, currentIdx);
        const end = Math.max(anchorIdx, currentIdx);
        const ids = new Set();
        for (let i = start; i <= end; i++) {
          ids.add(blocks[i].id);
        }
        setSelectedBlockIds(ids);
      }
    };

    const handleMouseUp = () => {
      selectionAnchorRef.current = null;
    };

    // Cmd+C / Ctrl+C 复制选中的多个 Block
    const handleCopy = (e) => {
      if (selectedBlockIdsRef.current.size === 0) return;
      e.preventDefault();
      const selectedBlocks = blocks.filter(b => selectedBlockIdsRef.current.has(b.id));
      const textParts = selectedBlocks.map(b => {
        const div = document.createElement('div');
        div.innerHTML = b.content || '';
        return div.textContent || '';
      });
      e.clipboardData.setData('text/plain', textParts.join('\n'));
      // 也复制 HTML 版本
      const htmlParts = selectedBlocks.map(b => `<p>${b.content || ''}</p>`);
      e.clipboardData.setData('text/html', htmlParts.join(''));
      // 存入带类型的自定义数据，粘贴时保留块类型
      const blocksData = selectedBlocks.map(b => ({ type: b.type, content: b.content || '', properties: b.properties }));
      e.clipboardData.setData('application/x-notion-blocks', JSON.stringify(blocksData));
      // 同步到 sessionStorage 备份
      sessionStorage.setItem('notion-clipboard', JSON.stringify(blocksData));
    };

    // Escape 或其他点击清除选择
    const handleKeyDown = (e) => {
      if (selectedBlockIdsRef.current.size > 0) {
        if (e.key === 'Escape') {
          setSelectedBlockIds(new Set());
          isBlockSelectingRef.current = false;
        }
        // Backspace/Delete 删除选中的块
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          const ids = [...selectedBlockIdsRef.current];
          // 找到选中块前面的块作为聚焦目标
          const firstIdx = blocks.findIndex(b => b.id === ids[0]);
          const focusTarget = firstIdx > 0 ? blocks[firstIdx - 1].id : null;
          ids.forEach(id => onBlockDelete(id));
          setSelectedBlockIds(new Set());
          isBlockSelectingRef.current = false;
          if (focusTarget) focusBlock(focusTarget, true);
        }
      }
    };

    editor.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('copy', handleCopy);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      editor.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [blocks, onBlockDelete, focusBlock]);

  // 同步外部标题（仅在未聚焦时更新，避免光标跳转）
  useEffect(() => {
    if (titleRef.current && document.activeElement !== titleRef.current && titleRef.current.textContent !== title) {
      titleRef.current.textContent = title;
    }
  }, [title]);

  // 处理 Enter 键 — 新增 Block
  // 列表类型回车延续同类型，空内容则退回 paragraph
  const continuousTypes = new Set(['bulleted_list', 'numbered_list', 'todo']);

  const handleEnter = useCallback(
    (blockId, afterText = '') => {
      const block = blocks.find((b) => b.id === blockId);
      let newType = 'paragraph';
      if (block && continuousTypes.has(block.type)) {
        // 空内容的列表项回车 → 退出列表，变回段落
        if (block.content === '' && !afterText) {
          onBlockUpdate(blockId, { type: 'paragraph' });
          return;
        }
        newType = block.type;
      }
      const newBlock = onBlockAdd(blockId, newType, afterText);
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
  // lines 可以是字符串数组（普通粘贴）或 {type, content} 对象数组（块级复制粘贴）
  const handlePaste = useCallback(
    (blockId, lines) => {
      const block = blocks.find((b) => b.id === blockId);
      const defaultType = block ? block.type : 'paragraph';
      let lastBlockId = blockId;
      for (const item of lines) {
        const isTyped = item && typeof item === 'object' && item.type;
        const type = isTyped ? item.type : defaultType;
        const content = isTyped ? item.content : item;
        const newBlock = onBlockAdd(lastBlockId, type, content);
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
      if (el) el.innerHTML = '';

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
    <div ref={editorRef} className="editor-content max-w-4xl mx-auto px-12 md:px-16 py-8 pb-40">
      {/* 文档图标 */}
      <div className="text-6xl mb-3 cursor-pointer hover:opacity-80 transition-opacity pl-10">
        {icon}
      </div>

      {/* 文档标题 */}
      <div
        ref={titleRef}
        contentEditable
        suppressContentEditableWarning
        data-placeholder="无标题"
        className="text-4xl font-bold text-notion-text mb-6 outline-none leading-tight pl-10"
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
            data-block-id={block.id}
            className={`${dragOverIndex === index ? 'drag-over' : ''} ${selectedBlockIds.has(block.id) ? 'block-selected' : ''}`}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={(e) => handleDrop(e, index)}
          >
            <Block
              block={block}
              listIndex={block.type === 'numbered_list' ? getListIndex(block.id) : null}
              isFocused={focusBlockId === block.id}
              onFocus={() => setFocusBlockId(block.id)}
              onUpdate={(updates) => onBlockUpdate(block.id, updates)}
              onEnter={(afterText) => handleEnter(block.id, afterText)}
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

      {/* 富文本格式工具栏 */}
      <InlineToolbar />
    </div>
  );
}
