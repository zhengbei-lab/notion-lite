import { useState, useEffect, useRef, useMemo } from 'react';
import { SLASH_MENU_ITEMS } from '../utils/blockTypes';

/**
 * 斜杠命令菜单
 * 输入 / 时弹出，选择 Block 类型
 */
export default function SlashMenu({ position, onSelect, onClose }) {
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const menuRef = useRef(null);
  const inputRef = useRef(null);

  // 过滤菜单项
  const filteredItems = useMemo(() => {
    if (!search) return SLASH_MENU_ITEMS;
    const query = search.toLowerCase();
    return SLASH_MENU_ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(query) ||
        item.type.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.shortcut.toLowerCase().includes(query)
    );
  }, [search]);

  // 按分类分组
  const groupedItems = useMemo(() => {
    const groups = {};
    filteredItems.forEach((item) => {
      const cat = item.category || '其他';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    return groups;
  }, [filteredItems]);

  // 自动聚焦
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[activeIndex]) {
          onSelect(filteredItems[activeIndex].type);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, filteredItems, onSelect, onClose]);

  // 重置 activeIndex
  useEffect(() => {
    setActiveIndex(0);
  }, [search]);

  let flatIndex = 0;

  return (
    <div
      ref={menuRef}
      className="slash-menu animate-slide-down"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
      }}
    >
      {/* 搜索框 */}
      <div className="p-2 border-b border-notion-border">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="筛选..."
          className="w-full px-2 py-1 text-sm bg-transparent outline-none text-notion-text placeholder-notion-text-light"
        />
      </div>

      {/* 菜单项 */}
      <div className="py-1 max-h-64 overflow-y-auto">
        {filteredItems.length === 0 ? (
          <div className="px-3 py-2 text-sm text-notion-text-light">无匹配结果</div>
        ) : (
          Object.entries(groupedItems).map(([category, items]) => (
            <div key={category}>
              <div className="px-3 py-1 text-xs text-notion-text-light font-medium uppercase tracking-wider">
                {category}
              </div>
              {items.map((item) => {
                const currentIndex = flatIndex++;
                return (
                  <div
                    key={item.type}
                    className={`slash-menu-item ${currentIndex === activeIndex ? 'active' : ''}`}
                    onClick={() => onSelect(item.type)}
                    onMouseEnter={() => setActiveIndex(currentIndex)}
                  >
                    <div className="w-10 h-10 bg-white border border-notion-border rounded flex items-center justify-center text-base flex-shrink-0">
                      {item.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-notion-text">{item.label}</div>
                      <div className="text-xs text-notion-text-light truncate">{item.description}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
