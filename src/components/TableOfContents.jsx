import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * TableOfContents — 右侧悬浮文档目录
 * 
 * 默认只显示横线标记，鼠标悬浮展开完整目录
 */
export default function TableOfContents({ blocks, scrollContainer }) {
  const [activeId, setActiveId] = useState(null);
  const [hovered, setHovered] = useState(false);
  const observerRef = useRef(null);

  // 提取标题 blocks
  const headings = blocks.filter(
    (b) => b.type === 'heading1' || b.type === 'heading2' || b.type === 'heading3'
  );

  // 获取标题文本（去除 HTML 标签）
  const getPlainText = (html) => {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || '';
  };

  // 监听滚动，高亮当前可见的标题
  useEffect(() => {
    if (!scrollContainer || headings.length === 0) return;

    // 使用 IntersectionObserver 检测标题可见性
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    const visibleHeadings = new Set();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const id = entry.target.getAttribute('data-block-id');
          if (entry.isIntersecting) {
            visibleHeadings.add(id);
          } else {
            visibleHeadings.delete(id);
          }
        });

        // 取第一个可见的标题
        for (const h of headings) {
          if (visibleHeadings.has(h.id)) {
            setActiveId(h.id);
            break;
          }
        }
      },
      {
        root: scrollContainer,
        rootMargin: '-10% 0px -70% 0px',
        threshold: 0,
      }
    );

    headings.forEach((h) => {
      const el = scrollContainer.querySelector(`[data-block-id="${h.id}"]`);
      if (el) {
        observerRef.current.observe(el);
      }
    });

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [scrollContainer, headings]);

  // 点击标题跳转
  const scrollToBlock = useCallback(
    (blockId) => {
      if (!scrollContainer) return;
      const el = scrollContainer.querySelector(`[data-block-id="${blockId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActiveId(blockId);
      }
    },
    [scrollContainer]
  );

  if (headings.length === 0) return null;

  return (
    <div
      className="toc-wrapper"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 收起状态：横线标记 */}
      <div className={`toc-marks ${hovered ? 'toc-marks-hidden' : ''}`}>
        {headings.map((h) => {
          const indent =
            h.type === 'heading1' ? 0 :
            h.type === 'heading2' ? 1 : 2;
          return (
            <div
              key={h.id}
              className={`toc-mark ${activeId === h.id ? 'active' : ''}`}
              style={{ marginLeft: indent * 6 }}
            />
          );
        })}
      </div>

      {/* 展开状态：完整目录 */}
      <div className={`toc-panel ${hovered ? 'toc-panel-visible' : ''}`}>
        <nav className="toc-nav">
          {headings.map((h) => {
            const text = getPlainText(h.content);
            if (!text) return null;
            const indent =
              h.type === 'heading2' ? 'toc-indent-1' :
              h.type === 'heading3' ? 'toc-indent-2' : '';

            return (
              <button
                key={h.id}
                className={`toc-item ${indent} ${activeId === h.id ? 'active' : ''}`}
                onClick={() => scrollToBlock(h.id)}
                title={text}
              >
                {text}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
