import { useRef, useEffect, useCallback, useState } from 'react';
import CodeBlock from './CodeBlock';
import BlockMenu from './BlockMenu';

/**
 * Block 组件 — 文档的最小编辑单元
 * 
 * Notion 的核心理念是 "Everything is a Block"
 * 每个 Block 都是一个独立的、可编辑的内容单元
 */
export default function Block({
  block,
  listIndex,
  isFocused,
  onFocus,
  onUpdate,
  onEnter,
  onBackspace,
  onArrowUp,
  onArrowDown,
  onSlashMenu,
  onDragStart,
  onDelete,
  onDuplicate,
  registerRef,
  remoteCursors,
}) {
  const contentRef = useRef(null);
  const [showHandle, setShowHandle] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null); // { top, left }

  // 点击六点手柄 → 弹出菜单
  const handleGripClick = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPosition({ top: rect.bottom + 4, left: rect.left });
  }, []);

  const closeMenu = useCallback(() => setMenuPosition(null), []);

  // 转换 Block 类型
  const handleTurnInto = useCallback((newType) => {
    onUpdate({ type: newType });
  }, [onUpdate]);

  // 操作手柄组件（复用）
  const HandleButtons = ({ extraClass = '' }) => (
    <div className={`block-handle flex items-center gap-0.5 pr-1 flex-shrink-0 ${extraClass} ${showHandle ? 'opacity-100' : ''}`}>
      <button
        onClick={onEnter}
        className="p-0.5 text-notion-text-light hover:text-notion-text rounded hover:bg-notion-hover transition-colors"
        title="点击添加 Block"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 3V11M3 7H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <button
        onClick={handleGripClick}
        draggable
        onDragStart={onDragStart}
        className="p-0.5 text-notion-text-light hover:text-notion-text rounded hover:bg-notion-hover cursor-grab active:cursor-grabbing transition-colors"
        title="拖拽移动 · 点击打开菜单"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <circle cx="5" cy="3" r="1" /><circle cx="9" cy="3" r="1" />
          <circle cx="5" cy="7" r="1" /><circle cx="9" cy="7" r="1" />
          <circle cx="5" cy="11" r="1" /><circle cx="9" cy="11" r="1" />
        </svg>
      </button>
    </div>
  );

  // 注册 ref
  useEffect(() => {
    if (contentRef.current) {
      registerRef(contentRef.current);
    }
  }, [registerRef]);

  // 同步内容到 DOM（仅在非编辑状态下更新，避免光标跳动）
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    // 只在元素未获得焦点时同步（防止覆盖用户正在输入的内容）
    if (document.activeElement !== el && el.textContent !== block.content) {
      el.textContent = block.content;
    }
  }, [block.content]);

  // 首次挂载时设置初始内容
  useEffect(() => {
    const el = contentRef.current;
    if (el && block.content && !el.textContent) {
      el.textContent = block.content;
    }
  }, []);

  // 键盘事件处理
  const handleKeyDown = useCallback(
    (e) => {
      const el = contentRef.current;

      // Enter 键：新建 Block
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onEnter();
        return;
      }

      // Backspace 键：空 Block 删除
      if (e.key === 'Backspace' && el.textContent === '') {
        e.preventDefault();
        onBackspace();
        return;
      }

      // 上箭头：移到上一个 Block
      if (e.key === 'ArrowUp') {
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          if (range.startOffset === 0 && range.collapsed) {
            e.preventDefault();
            onArrowUp();
          }
        }
      }

      // 下箭头：移到下一个 Block
      if (e.key === 'ArrowDown') {
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          if (range.endOffset === (el.textContent || '').length && range.collapsed) {
            e.preventDefault();
            onArrowDown();
          }
        }
      }

      // Tab 键：缩进（暂时阻止默认行为）
      if (e.key === 'Tab') {
        e.preventDefault();
        if (block.type === 'code') {
          document.execCommand('insertText', false, '  ');
        }
      }
    },
    [onEnter, onBackspace, onArrowUp, onArrowDown, block.type]
  );

  // 内容变更
  const handleInput = useCallback(() => {
    const content = contentRef.current?.textContent || '';

    // 检测斜杠命令
    if (content === '/') {
      const rect = contentRef.current.getBoundingClientRect();
      onSlashMenu({
        top: rect.bottom + 4,
        left: rect.left,
      });
      return;
    }

    onUpdate({ content });
  }, [onUpdate, onSlashMenu]);

  // Todo 复选框切换
  const handleTodoToggle = useCallback(() => {
    onUpdate({
      properties: {
        ...block.properties,
        checked: !block.properties?.checked,
      },
    });
  }, [block.properties, onUpdate]);

  // 获取占位符文字
  const getPlaceholder = () => {
    switch (block.type) {
      case 'heading1': return '标题 1';
      case 'heading2': return '标题 2';
      case 'heading3': return '标题 3';
      case 'bulleted_list': return '列表';
      case 'numbered_list': return '列表';
      case 'todo': return '待办事项';
      case 'quote': return '输入引用内容...';
      case 'code': return '输入代码...';
      case 'callout': return '输入提示内容...';
      default: return "输入 '/' 打开命令菜单";
    }
  };

  // 分割线特殊处理
  if (block.type === 'divider') {
    return (
      <div
        className="block-wrapper py-2 group flex items-center"
        onMouseEnter={() => setShowHandle(true)}
        onMouseLeave={() => setShowHandle(false)}
      >
        <HandleButtons />
        <hr className="block-divider flex-1" />
        {menuPosition && (
          <BlockMenu
            position={menuPosition}
            blockType={block.type}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onTurnInto={handleTurnInto}
            onClose={closeMenu}
          />
        )}
      </div>
    );
  }

  // 内容样式类名
  const contentClassName = (() => {
    switch (block.type) {
      case 'heading1': return 'block-heading1';
      case 'heading2': return 'block-heading2';
      case 'heading3': return 'block-heading3';
      case 'quote': return 'block-quote';
      default: return 'text-base leading-relaxed';
    }
  })();

  // 代码块使用专用组件
  if (block.type === 'code') {
    return (
      <div
        className="block-wrapper group flex items-start py-0.5"
        onMouseEnter={() => setShowHandle(true)}
        onMouseLeave={() => setShowHandle(false)}
      >
        <HandleButtons extraClass="pt-0.5" />
        <div className="flex-1 min-w-0">
          <CodeBlock
            block={block}
            onUpdate={onUpdate}
            onEnter={onEnter}
            onBackspace={onBackspace}
            registerRef={registerRef}
            onFocus={onFocus}
          />
        </div>
        {menuPosition && (
          <BlockMenu
            position={menuPosition}
            blockType={block.type}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onTurnInto={handleTurnInto}
            onClose={closeMenu}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className="block-wrapper group flex items-start py-0.5"
      onMouseEnter={() => setShowHandle(true)}
      onMouseLeave={() => setShowHandle(false)}
    >
      {/* 操作手柄 */}
      <HandleButtons extraClass="pt-0.5" />

      {/* Block 内容区 */}
      <div className="flex-1 min-w-0 relative">
        {/* 列表前缀 */}
        {block.type === 'bulleted_list' && (
          <span className="absolute left-0 text-notion-text select-none" style={{ top: '2px' }}>•</span>
        )}
        {block.type === 'numbered_list' && (
          <span className="absolute left-0 text-notion-text select-none text-sm" style={{ top: '3px' }}>
            {listIndex}.
          </span>
        )}
        {block.type === 'todo' && (
          <button
            onClick={handleTodoToggle}
            className="absolute left-0 top-0.5 w-4 h-4 border border-notion-border rounded flex items-center justify-center hover:bg-notion-hover transition-colors"
            style={{
              backgroundColor: block.properties?.checked ? '#2EAADC' : 'transparent',
              borderColor: block.properties?.checked ? '#2EAADC' : undefined,
            }}
          >
            {block.properties?.checked && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        )}

        {/* Callout 容器 */}
        {block.type === 'callout' ? (
          <div className="block-callout">
            <span className="text-lg leading-none flex-shrink-0">
              {block.properties?.emoji || '💡'}
            </span>
            <div
              ref={contentRef}
              contentEditable
              suppressContentEditableWarning
              data-placeholder={getPlaceholder()}
              className="flex-1 outline-none text-base leading-relaxed"
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              onFocus={onFocus}
            />
          </div>
        ) : (
          <div
            ref={contentRef}
            contentEditable
            suppressContentEditableWarning
            data-placeholder={getPlaceholder()}
            className={`outline-none ${contentClassName} ${
              block.type === 'bulleted_list' || block.type === 'numbered_list' || block.type === 'todo'
                ? 'pl-6'
                : ''
            } ${
              block.type === 'todo' && block.properties?.checked
                ? 'line-through text-notion-text-light'
                : ''
            }`}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onFocus={onFocus}
          />
        )}

        {/* 远程用户光标 */}
        {remoteCursors?.map((user) => (
          <div key={user.id} className="collab-cursor" style={{ borderColor: user.color }}>
            <div
              className="collab-cursor-label"
              style={{ backgroundColor: user.color }}
            >
              {user.name}
            </div>
          </div>
        ))}
      </div>

      {/* Block 操作菜单 */}
      {menuPosition && (
        <BlockMenu
          position={menuPosition}
          blockType={block.type}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onTurnInto={handleTurnInto}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
