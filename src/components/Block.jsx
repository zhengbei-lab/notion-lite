import { useRef, useEffect, useCallback, useState } from 'react';
import CodeBlock from './CodeBlock';
import BlockMenu from './BlockMenu';

// 基础 HTML 安全过滤（防止远程内容注入脚本）
const sanitizeHtml = (html) => {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html.replace(/\n/g, '<br>');
  div.querySelectorAll('script,style,iframe,object,embed').forEach(n => n.remove());
  div.querySelectorAll('*').forEach(n => {
    [...n.attributes].forEach(a => {
      if (a.name.startsWith('on')) n.removeAttribute(a.name);
      if (a.name === 'href' && /^(javascript|data):/i.test(n.getAttribute(a.name) || '')) {
        n.removeAttribute(a.name);
      }
    });
  });
  return div.innerHTML;
};

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
  onPaste,
  registerRef,
  remoteCursors,
}) {
  const contentRef = useRef(null);
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

  // 操作手柄（直接渲染 JSX，不用内联组件以避免 re-mount）
  const handleButtonsJsx = (extraClass = '') => (
    <div className={`block-handle flex items-center gap-0.5 pr-1 flex-shrink-0 ${extraClass}`}>
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

  // 多行类型：quote 和 callout 允许块内换行
  const isMultiLine = block.type === 'quote' || block.type === 'callout';

  // 同步内容到 DOM（仅在非编辑状态下更新，避免光标跳动）
  // 使用 innerHTML 以保留富文本格式（加粗、斜体等）
  const updateEmptyAttr = useCallback((el) => {
    if (!el) return;
    const isEmpty = !el.textContent?.trim();
    if (isEmpty) {
      el.setAttribute('data-empty', 'true');
    } else {
      el.removeAttribute('data-empty');
    }
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el || document.activeElement === el) return;
    el.innerHTML = sanitizeHtml(block.content || '');
    updateEmptyAttr(el);
  }, [block.content, updateEmptyAttr]);

  // 点击链接跳转（需要 Cmd/Ctrl 键，避免影响编辑）
  const handleClick = useCallback((e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    // 找到被点击的链接元素（兼容点击到文本节点的情况）
    let target = e.target;
    if (target.nodeType === Node.TEXT_NODE) {
      target = target.parentElement;
    }
    const anchor = target?.closest?.('a');
    if (anchor) {
      const href = anchor.getAttribute('href');
      if (href) {
        e.preventDefault();
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    }
  }, []);

  // 聚焦/失焦时维护 data-empty 属性
  const handleFocus = useCallback((e) => {
    const el = contentRef.current;
    if (el) {
      // 清理浏览器自动插入的 <br>
      if (!el.textContent?.trim() && el.innerHTML !== '') {
        el.innerHTML = '';
      }
      updateEmptyAttr(el);
    }
    if (onFocus) onFocus(e);
  }, [onFocus, updateEmptyAttr]);

  const handleBlur = useCallback(() => {
    const el = contentRef.current;
    if (el) updateEmptyAttr(el);
  }, [updateEmptyAttr]);

  // 键盘事件处理
  const handleKeyDown = useCallback(
    (e) => {
      const el = contentRef.current;

      // Enter 键：多行块内换行，单行块新建 Block
      if (e.key === 'Enter' && !e.shiftKey) {
        if (isMultiLine) {
          // Cmd/Ctrl+Enter → 退出多行块，新建 paragraph
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            onEnter();
            return;
          }
          // 连续两次 Enter（末尾空行回车）→ 退出多行块
          const textContent = el.innerText || '';
          if (textContent.endsWith('\n') || textContent.endsWith('\n\n')) {
            e.preventDefault();
            // 移除末尾空节点（br、空 div）
            while (el.lastChild) {
              const node = el.lastChild;
              if (node.nodeName === 'BR') { node.remove(); continue; }
              if (node.nodeName === 'DIV' && !node.textContent.trim()) { node.remove(); continue; }
              if (node.nodeType === 3 && !node.textContent.trim()) { node.remove(); continue; }
              break;
            }
            onUpdate({ content: el.innerHTML || '' });
            onEnter();
            return;
          }
          // 普通 Enter 不阻止，允许换行
          return;
        }
        e.preventDefault();
        // 在光标位置分割内容（保留富文本格式）
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          // 提取光标后的 HTML 片段
          const afterRange = document.createRange();
          afterRange.setStart(range.endContainer, range.endOffset);
          afterRange.setEndAfter(el.lastChild || el);
          const fragment = afterRange.cloneContents();
          const tempDiv = document.createElement('div');
          tempDiv.appendChild(fragment);
          const afterHtml = tempDiv.innerHTML;
          // 删除光标后的内容
          afterRange.deleteContents();
          // 清理可能残留的空 br
          if (el.innerHTML === '<br>') el.innerHTML = '';
          onUpdate({ content: el.innerHTML || '' });
          onEnter(afterHtml);
        } else {
          onEnter('');
        }
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

  // 粘贴事件处理
  const handlePaste = useCallback((e) => {
    e.preventDefault();

    // 优先检查自定义块数据（来自块级选择复制）
    const notionData = e.clipboardData.getData('application/x-notion-blocks');
    // 也检查 sessionStorage（来自 CodeBlock 复制）
    const sessionData = sessionStorage.getItem('notion-clipboard');
    const rawData = notionData || sessionData;
    if (rawData && onPaste) {
      try {
        const blocksData = JSON.parse(rawData);
        if (Array.isArray(blocksData) && blocksData.length > 0) {
          // 验证 sessionStorage 数据与剪贴板内容一致（防止过期数据）
          if (!notionData && sessionData) {
            const clipText = e.clipboardData.getData('text/plain');
            const storedText = blocksData.map(b => b.content || '').join('\n');
            if (clipText !== storedText) {
              sessionStorage.removeItem('notion-clipboard');
              // 数据不匹配，走普通粘贴
              throw new Error('stale');
            }
          }
          // 清除 sessionStorage 中的一次性数据
          if (sessionData) sessionStorage.removeItem('notion-clipboard');
          // 第一个块：更新当前块的类型并插入内容
          const first = blocksData[0];
          const newContent = first.content || '';
          const updates = { type: first.type, content: newContent };
          if (first.properties) updates.properties = first.properties;
          onUpdate(updates);
          // 因为当前块处于聚焦状态，useEffect 不会同步 DOM，手动更新
          const el = contentRef.current;
          if (el) {
            el.innerHTML = sanitizeHtml(newContent);
          }
          // 其余块带类型创建
          if (blocksData.length > 1) {
            onPaste(blocksData.slice(1));
          }
          return;
        }
      } catch (_) { /* fallback to plain text */ }
    }

    const text = e.clipboardData.getData('text/plain');

    // 多行块（quote/callout）：直接粘贴全部内容，保留换行
    if (isMultiLine) {
      document.execCommand('insertText', false, text);
      return;
    }

    const lines = text.split('\n');

    if (lines.length <= 1) {
      // 单行：直接插入
      document.execCommand('insertText', false, text);
      return;
    }

    // 多行：第一行插入当前 block，其余交给 Editor 创建新 block
    document.execCommand('insertText', false, lines[0]);
    if (onPaste) {
      onPaste(lines.slice(1));
    }
  }, [onPaste, onUpdate, isMultiLine]);

  // Markdown 快捷输入规则（\s 匹配普通空格和 &nbsp;）
  const markdownShortcuts = [
    { pattern: /^#\s$/, type: 'heading1' },
    { pattern: /^##\s$/, type: 'heading2' },
    { pattern: /^###\s$/, type: 'heading3' },
    { pattern: /^[-*]\s$/, type: 'bulleted_list' },
    { pattern: /^\d+\.\s$/, type: 'numbered_list' },
    { pattern: /^\[]\s$/, type: 'todo' },
    { pattern: /^>\s$/, type: 'quote' },
    { pattern: /^```$/, type: 'code' },
    { pattern: /^---$/, type: 'divider' },
  ];

  // 内容变更（使用 innerHTML 保留富文本格式）
  const handleInput = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    // 纯文本用于命令检测，HTML 用于内容存储
    const textContent = el.textContent || '';
    const htmlContent = el.innerHTML || '';
    // 将 &nbsp; (\u00A0) 替换为普通空格，方便匹配
    const normalizedText = textContent.replace(/\u00A0/g, ' ');

    // 检测斜杠命令
    if (normalizedText === '/') {
      const rect = el.getBoundingClientRect();
      onSlashMenu({
        top: rect.bottom + 4,
        left: rect.left,
        anchorEl: el,
      });
      return;
    }

    // 检测 Markdown 快捷输入（仅 paragraph 类型触发）
    if (block.type === 'paragraph') {
      for (const { pattern, type } of markdownShortcuts) {
        if (pattern.test(normalizedText)) {
          el.innerHTML = '';
          onUpdate({ content: '', type });
          return;
        }
      }
    }

    onUpdate({ content: htmlContent });
    updateEmptyAttr(el);
  }, [onUpdate, onSlashMenu, block.type, updateEmptyAttr]);

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
        className="block-wrapper py-2 group"
      >
        {handleButtonsJsx()}
        <hr className="block-divider" />
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
        className="block-wrapper group py-0.5"
      >
        {handleButtonsJsx('pt-0.5')}
        <div className="min-w-0">
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
      className="block-wrapper group py-0.5"
    >
      {/* 操作手柄 */}
      {handleButtonsJsx('pt-0.5')}

      {/* Block 内容区 */}
      <div className="min-w-0 relative">
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
              onPaste={handlePaste}
              onClick={handleClick}
              onFocus={handleFocus}
              onBlur={handleBlur}
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
            onPaste={handlePaste}
            onClick={handleClick}
            onFocus={handleFocus}
            onBlur={handleBlur}
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
