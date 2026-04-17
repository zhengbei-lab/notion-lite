import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * InlineToolbar — 选中文本后弹出的浮动格式工具栏
 * 
 * 类似 Notion 的 inline formatting toolbar
 * 支持：加粗、斜体、下划线、删除线、行内代码、链接
 */
export default function InlineToolbar() {
  const [position, setPosition] = useState(null);
  const [formats, setFormats] = useState({});
  const toolbarRef = useRef(null);

  // 检查当前选区的格式状态
  const checkFormats = useCallback(() => {
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    const el = node?.nodeType === 3 ? node.parentElement : node;

    setFormats({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strikeThrough: document.queryCommandState('strikeThrough'),
      code: !!el?.closest?.('code'),
      link: !!el?.closest?.('a'),
    });
  }, []);

  useEffect(() => {
    const checkSelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setPosition(null);
        return;
      }

      // 检查选区是否在编辑器内（支持跨 Block 选择）
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const editableEl = container.nodeType === 3
        ? container.parentElement?.closest('[contenteditable]')
        : container.closest?.('[contenteditable]');
      const editorEl = container.nodeType === 3
        ? container.parentElement?.closest('.editor-content')
        : container.closest?.('.editor-content');

      if (!editableEl && !editorEl) {
        setPosition(null);
        return;
      }

      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setPosition(null);
        return;
      }

      setPosition({
        top: rect.top - 48,
        left: rect.left + rect.width / 2,
      });
      checkFormats();
    };

    const handleMouseUp = () => {
      // 稍微延迟以确保选区稳定
      setTimeout(checkSelection, 10);
    };

    const handleKeyUp = (e) => {
      // Shift+方向键选择文字
      if (e.shiftKey) {
        checkSelection();
      }
    };

    const handleMouseDown = (e) => {
      // 点击工具栏按钮时不隐藏
      if (toolbarRef.current?.contains(e.target)) return;
      setPosition(null);
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [checkFormats]);

  // 应用格式命令
  const applyFormat = useCallback((command) => {
    document.execCommand(command, false, null);
    checkFormats();
  }, [checkFormats]);

  // 切换行内代码
  const toggleInlineCode = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    // 检查是否已在 <code> 内
    const anchorEl = sel.anchorNode?.nodeType === 3
      ? sel.anchorNode.parentElement
      : sel.anchorNode;
    const parentCode = anchorEl?.closest('code');

    if (parentCode) {
      // 取消行内代码：用纯文本替换 code 节点
      const text = document.createTextNode(parentCode.textContent);
      parentCode.parentNode.replaceChild(text, parentCode);
      // 重新选中文本
      const newRange = document.createRange();
      newRange.selectNodeContents(text);
      sel.removeAllRanges();
      sel.addRange(newRange);
    } else {
      // 包裹为行内代码
      const selectedText = range.toString();
      const code = document.createElement('code');
      code.textContent = selectedText;
      range.deleteContents();
      range.insertNode(code);
      // 选中 code 节点
      const newRange = document.createRange();
      newRange.selectNodeContents(code);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }

    // 触发 input 事件同步内容
    const editableEl = sel.anchorNode?.nodeType === 3
      ? sel.anchorNode.parentElement?.closest('[contenteditable]')
      : sel.anchorNode?.closest?.('[contenteditable]');
    if (editableEl) {
      editableEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
    checkFormats();
  }, [checkFormats]);

  // 切换链接
  const toggleLink = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const anchorEl = sel.anchorNode?.nodeType === 3
      ? sel.anchorNode.parentElement
      : sel.anchorNode;
    const parentLink = anchorEl?.closest('a');

    if (parentLink) {
      document.execCommand('unlink');
    } else {
      const url = prompt('输入链接地址：', 'https://');
      if (url) {
        document.execCommand('createLink', false, url);
        // 设置新链接为新窗口打开
        const newLink = sel.anchorNode?.nodeType === 3
          ? sel.anchorNode.parentElement?.closest('a')
          : sel.anchorNode?.closest?.('a');
        if (newLink) {
          newLink.setAttribute('target', '_blank');
          newLink.setAttribute('rel', 'noopener noreferrer');
        }
        // 重新触发 input 同步属性
        const editableEl = newLink?.closest('[contenteditable]');
        if (editableEl) {
          editableEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }
    checkFormats();
  }, [checkFormats]);

  if (!position) return null;

  return (
    <div
      ref={toolbarRef}
      className="inline-toolbar"
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        onClick={() => applyFormat('bold')}
        className={`inline-toolbar-btn ${formats.bold ? 'active' : ''}`}
        title="加粗 (⌘B)"
      >
        <span style={{ fontWeight: 700 }}>B</span>
      </button>
      <button
        onClick={() => applyFormat('italic')}
        className={`inline-toolbar-btn ${formats.italic ? 'active' : ''}`}
        title="斜体 (⌘I)"
      >
        <span style={{ fontStyle: 'italic' }}>I</span>
      </button>
      <button
        onClick={() => applyFormat('underline')}
        className={`inline-toolbar-btn ${formats.underline ? 'active' : ''}`}
        title="下划线 (⌘U)"
      >
        <span style={{ textDecoration: 'underline' }}>U</span>
      </button>
      <button
        onClick={() => applyFormat('strikeThrough')}
        className={`inline-toolbar-btn ${formats.strikeThrough ? 'active' : ''}`}
        title="删除线"
      >
        <span style={{ textDecoration: 'line-through' }}>S</span>
      </button>

      <div className="inline-toolbar-divider" />

      <button
        onClick={toggleInlineCode}
        className={`inline-toolbar-btn ${formats.code ? 'active' : ''}`}
        title="行内代码"
      >
        <span style={{ fontFamily: 'monospace', fontSize: '13px' }}>&lt;/&gt;</span>
      </button>
      <button
        onClick={toggleLink}
        className={`inline-toolbar-btn ${formats.link ? 'active' : ''}`}
        title="链接"
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M6.5 8.5a2.5 2.5 0 003.5 0l2-2a2.5 2.5 0 00-3.5-3.5l-1 1" strokeLinecap="round" />
          <path d="M8.5 6.5a2.5 2.5 0 00-3.5 0l-2 2a2.5 2.5 0 003.5 3.5l1-1" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
