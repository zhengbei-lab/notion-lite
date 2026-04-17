import { useEffect, useRef } from 'react';
import { BLOCK_TYPES } from '../utils/blockTypes';

/**
 * Block 操作菜单
 * 点击六点拖拽手柄时弹出，包含删除、复制、转换类型等操作
 */
export default function BlockMenu({ position, blockType, onDelete, onDuplicate, onTurnInto, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    // 延迟注册 mousedown 监听，避免打开菜单的同一次点击触发关闭
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    document.addEventListener('keydown', handleEsc);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  const turnIntoTypes = [
    'paragraph', 'heading1', 'heading2', 'heading3',
    'bulleted_list', 'numbered_list', 'todo', 'quote', 'code', 'callout',
  ].filter((t) => t !== blockType);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-white rounded-lg shadow-lg border border-notion-border py-1 w-56 animate-slide-down"
      style={{ top: position.top, left: position.left }}
    >
      {/* 删除 */}
      <button
        onClick={() => { onDelete(); onClose(); }}
        className="w-full flex items-center gap-3 px-3 py-1.5 text-sm text-notion-text hover:bg-notion-hover transition-colors text-left"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-notion-text-light flex-shrink-0">
          <path d="M4.5 3V2.5C4.5 1.67 5.17 1 6 1H10C10.83 1 11.5 1.67 11.5 2.5V3M2 3.5H14M5.5 6.5V11.5M8 6.5V11.5M10.5 6.5V11.5M3 3.5L3.94 13.17C4.04 14.2 4.91 15 5.95 15H10.05C11.09 15 11.96 14.2 12.06 13.17L13 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>删除</span>
        <span className="ml-auto text-xs text-notion-text-light">Del</span>
      </button>

      {/* 复制 */}
      <button
        onClick={() => { onDuplicate(); onClose(); }}
        className="w-full flex items-center gap-3 px-3 py-1.5 text-sm text-notion-text hover:bg-notion-hover transition-colors text-left"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-notion-text-light flex-shrink-0">
          <rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M3 11V3.5C3 2.67 3.67 2 4.5 2H11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span>复制</span>
        <span className="ml-auto text-xs text-notion-text-light">⌘D</span>
      </button>

      {/* 分隔线 */}
      <div className="border-t border-notion-border my-1" />

      {/* 转换类型 */}
      <div className="px-3 py-1 text-xs text-notion-text-light font-medium">转换为</div>
      <div className="max-h-48 overflow-y-auto">
        {turnIntoTypes.map((type) => {
          const info = BLOCK_TYPES[type];
          if (!info) return null;
          return (
            <button
              key={type}
              onClick={() => { onTurnInto(type); onClose(); }}
              className="w-full flex items-center gap-3 px-3 py-1.5 text-sm text-notion-text hover:bg-notion-hover transition-colors text-left"
            >
              <span className="w-5 text-center text-sm flex-shrink-0">{info.icon}</span>
              <span>{info.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
