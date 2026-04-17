import { useRef, useEffect, useCallback, useState } from 'react';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import markdown from 'highlight.js/lib/languages/markdown';
import 'highlight.js/styles/github.css';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('java', java);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('markdown', markdown);

/**
 * CodeBlock 组件 — 专业的代码编辑器 Block
 * 支持：行号、Tab 缩进、全选、语法高亮语言标签、代码复制
 */
export default function CodeBlock({ block, onUpdate, onEnter, onBackspace, registerRef, onFocus }) {
  const textareaRef = useRef(null);
  const highlightRef = useRef(null);
  const [language, setLanguage] = useState(block.properties?.language || 'javascript');
  const [copied, setCopied] = useState(false);
  const lineCountRef = useRef(null);

  // 获取高亮 HTML
  const getHighlightedCode = useCallback((code, lang) => {
    if (!code) return '\n'; // 保证至少一行高度
    try {
      if (lang !== 'text' && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value + '\n';
      }
    } catch (e) {
      // fallback
    }
    return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '\n';
  }, []);

  // 注册 ref（用 textarea）
  useEffect(() => {
    if (textareaRef.current) {
      registerRef(textareaRef.current);
    }
  }, [registerRef]);

  // 同步外部内容
  useEffect(() => {
    const el = textareaRef.current;
    if (el && el.value !== block.content && document.activeElement !== el) {
      el.value = block.content;
      adjustHeight(el);
    }
    // 更新高亮
    if (highlightRef.current) {
      highlightRef.current.innerHTML = getHighlightedCode(block.content, language);
    }
  }, [block.content, language, getHighlightedCode]);

  // 初始化设置高度 + 高亮
  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight(textareaRef.current);
    }
    if (highlightRef.current) {
      highlightRef.current.innerHTML = getHighlightedCode(block.content, language);
    }
  }, []);

  const adjustHeight = (el) => {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };

  // 行号计算
  const lines = (block.content || '').split('\n');
  const lineCount = Math.max(lines.length, 1);

  // 键盘事件
  const handleKeyDown = useCallback(
    (e) => {
      const el = textareaRef.current;

      // Tab 键：插入 2 空格
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = el.selectionStart;
        const end = el.selectionEnd;

        if (e.shiftKey) {
          // Shift+Tab：减少缩进
          const lineStart = el.value.lastIndexOf('\n', start - 1) + 1;
          const lineText = el.value.substring(lineStart, start);
          if (lineText.startsWith('  ')) {
            const newValue = el.value.substring(0, lineStart) + el.value.substring(lineStart).replace(/^  /, '');
            el.value = newValue;
            onUpdate({ content: newValue });
            el.selectionStart = el.selectionEnd = Math.max(start - 2, lineStart);
          }
        } else {
          // Tab：增加缩进
          const newValue = el.value.substring(0, start) + '  ' + el.value.substring(end);
          el.value = newValue;
          onUpdate({ content: newValue });
          el.selectionStart = el.selectionEnd = start + 2;
        }
        adjustHeight(el);
        return;
      }

      // Enter 键：在代码块内换行（不是创建新 Block）
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        // 代码块内允许换行，不阻止默认行为
        // 但如果按 Cmd/Ctrl+Enter，则创建新 Block
        return;
      }

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onEnter();
        return;
      }

      // Backspace：空代码块删除
      if (e.key === 'Backspace' && el.value === '') {
        e.preventDefault();
        onBackspace();
        return;
      }

      // Cmd/Ctrl+A：全选代码块内容
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        e.stopPropagation();
        el.selectionStart = 0;
        el.selectionEnd = el.value.length;
        return;
      }

      // 左右括号自动匹配
      const brackets = { '(': ')', '[': ']', '{': '}', "'": "'", '"': '"', '`': '`' };
      if (brackets[e.key]) {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        if (start !== end) {
          // 选中文本时包围
          e.preventDefault();
          const selected = el.value.substring(start, end);
          const newValue = el.value.substring(0, start) + e.key + selected + brackets[e.key] + el.value.substring(end);
          el.value = newValue;
          onUpdate({ content: newValue });
          el.selectionStart = start + 1;
          el.selectionEnd = end + 1;
        }
      }
    },
    [onUpdate, onEnter, onBackspace]
  );

  // 内容变更
  const handleInput = useCallback(
    (e) => {
      const content = e.target.value;
      onUpdate({ content });
      adjustHeight(e.target);
      // 同步高亮
      if (highlightRef.current) {
        highlightRef.current.innerHTML = getHighlightedCode(content, language);
      }
    },
    [onUpdate, language, getHighlightedCode]
  );

  // 语言切换
  const handleLanguageChange = useCallback(
    (e) => {
      const lang = e.target.value;
      setLanguage(lang);
      onUpdate({ properties: { ...block.properties, language: lang } });
    },
    [block.properties, onUpdate]
  );

  // 复制代码（按钮）
  const handleCopy = useCallback(() => {
    const content = block.content || '';
    // 写入自定义格式，粘贴时自动创建 code block
    const blocksData = [{ type: 'code', content, properties: block.properties }];
    const item = new ClipboardItem({
      'text/plain': new Blob([content], { type: 'text/plain' }),
    });
    navigator.clipboard.write([item]).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
    // 同时写入 sessionStorage 作为自定义格式的备份（ClipboardItem 不支持自定义 MIME）
    sessionStorage.setItem('notion-clipboard', JSON.stringify(blocksData));
  }, [block.content, block.properties]);

  // 拦截 textarea 的 copy 事件，注入自定义格式
  const handleTextareaCopy = useCallback((e) => {
    const el = textareaRef.current;
    if (!el) return;
    const selected = el.value.substring(el.selectionStart, el.selectionEnd);
    const content = selected || el.value;
    const blocksData = [{ type: 'code', content, properties: block.properties }];
    sessionStorage.setItem('notion-clipboard', JSON.stringify(blocksData));
  }, [block.content, block.properties]);

  const languages = [
    'javascript', 'typescript', 'python', 'java', 'go', 'rust',
    'html', 'css', 'sql', 'json', 'bash', 'markdown', 'text',
  ];

  return (
    <div className="rounded-md overflow-hidden border border-notion-border bg-[#F8F8F8] group/code">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#F0EFED] border-b border-notion-border">
        <select
          value={language}
          onChange={handleLanguageChange}
          className="text-xs text-notion-text-light bg-transparent outline-none cursor-pointer hover:text-notion-text"
        >
          {languages.map((lang) => (
            <option key={lang} value={lang}>{lang}</option>
          ))}
        </select>

        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-notion-text-light hover:text-notion-text transition-colors"
          title="复制代码"
        >
          {copied ? (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 7L6 10L11 4" stroke="#0F7B6C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-notion-green">已复制</span>
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
                <path d="M3 10V3C3 2.44772 3.44772 2 4 2H10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              复制
            </>
          )}
        </button>
      </div>

      {/* 代码编辑区 */}
      <div className="flex">
        {/* 行号 */}
        <div
          ref={lineCountRef}
          className="flex-shrink-0 text-right pr-3 pl-3 py-3 select-none text-notion-text-light leading-[1.6] font-mono text-[13px] bg-[#F0EFED] border-r border-notion-border"
          style={{ minWidth: '3rem' }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        {/* 代码输入区（叠加层：底层高亮 + 上层透明 textarea） */}
        <div className="flex-1 relative">
          {/* 高亮渲染层 */}
          <pre
            className="px-3 py-3 font-mono text-[13px] leading-[1.6] m-0 overflow-hidden whitespace-pre-wrap break-words pointer-events-none"
            aria-hidden="true"
            style={{ minHeight: '3rem' }}
          >
            <code
              ref={highlightRef}
              className={`hljs language-${language}`}
              style={{ background: 'transparent', padding: 0 }}
              dangerouslySetInnerHTML={{ __html: getHighlightedCode(block.content, language) }}
            />
          </pre>
          {/* 透明 textarea 编辑层 */}
          <textarea
            ref={textareaRef}
            defaultValue={block.content}
            placeholder="输入代码..."
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onCopy={handleTextareaCopy}
            onFocus={onFocus}
            onScroll={(e) => {
              if (highlightRef.current) {
                highlightRef.current.parentElement.scrollTop = e.target.scrollTop;
                highlightRef.current.parentElement.scrollLeft = e.target.scrollLeft;
              }
            }}
            spellCheck={false}
            className="absolute inset-0 px-3 py-3 bg-transparent outline-none resize-none font-mono text-[13px] leading-[1.6] overflow-hidden whitespace-pre-wrap break-words tab-[2]"
            style={{ minHeight: '3rem', color: 'transparent', caretColor: '#37352F' }}
          />
        </div>
      </div>
    </div>
  );
}
