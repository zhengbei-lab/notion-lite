import { useState } from 'react';

export default function Sidebar({
  open,
  onToggle,
  documents,
  currentDocId,
  onSelectDoc,
  onCreateDoc,
  onDeleteDoc,
  userName,
}) {
  const [hoveredDoc, setHoveredDoc] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  return (
    <>
      {/* 侧边栏 */}
      <div
        className={`${
          open ? 'w-60' : 'w-0'
        } transition-all duration-200 ease-in-out bg-notion-sidebar border-r border-notion-border flex flex-col overflow-hidden`}
      >
        {/* 工作区标题 */}
        <div className="flex items-center gap-2 px-3 py-3 border-b border-notion-border">
          <div className="w-5 h-5 bg-gradient-to-br from-notion-accent to-notion-blue rounded text-white text-xs flex items-center justify-center font-bold">
            N
          </div>
          <span className="text-sm font-medium text-notion-text truncate flex-1">
            {userName} 的工作区
          </span>
          <button
            onClick={onToggle}
            className="text-notion-text-light hover:text-notion-text p-0.5 rounded hover:bg-notion-hover transition-colors"
            title="收起侧边栏"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10.5 3.5L5.5 8L10.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 新建文档 */}
        <div className="px-2 pt-3 pb-1">
          <button
            onClick={onCreateDoc}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-notion-text-light hover:text-notion-text hover:bg-notion-hover rounded transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            新建页面
          </button>
        </div>

        {/* 文档列表 */}
        <div className="flex-1 overflow-y-auto px-2 py-1">
          <div className="text-xs text-notion-text-light px-2 py-1.5 font-medium">
            文档
          </div>
          {documents.map((doc) => (
            <div key={doc.id}>
            <button
              onClick={() => onSelectDoc(doc.id)}
              onMouseEnter={() => setHoveredDoc(doc.id)}
              onMouseLeave={() => setHoveredDoc(null)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded transition-colors text-left ${
                currentDocId === doc.id
                  ? 'bg-notion-hover text-notion-text font-medium'
                  : 'text-notion-text hover:bg-notion-hover'
              }`}
            >
              <span className="text-base leading-none">{doc.icon || '📄'}</span>
              <span className="truncate flex-1">{doc.title}</span>
              {hoveredDoc === doc.id && (
                <span
                  className="text-notion-text-light hover:text-notion-red text-xs flex-shrink-0 px-1 rounded hover:bg-red-50 transition-colors"
                  title="删除文档"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(doc.id);
                  }}
                >
                  ✕
                </span>
              )}
            </button>
            {/* 删除确认 */}
            {confirmDelete === doc.id && (
              <div className="ml-6 mr-2 mb-1 p-2 bg-white border border-notion-border rounded-md shadow-sm animate-fade-in">
                <p className="text-xs text-notion-text mb-2">确定删除「{doc.title}」？</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      onDeleteDoc(doc.id);
                      setConfirmDelete(null);
                    }}
                    className="px-2 py-0.5 text-xs text-white bg-notion-red hover:bg-red-600 rounded transition-colors"
                  >
                    删除
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="px-2 py-0.5 text-xs text-notion-text-light hover:text-notion-text hover:bg-notion-hover rounded transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
            </div>
          ))}
        </div>

        {/* 底部信息 */}
        <div className="px-3 py-3 border-t border-notion-border">
          <div className="flex items-center gap-2 text-xs text-notion-text-light">
            <div className="w-2 h-2 bg-notion-green rounded-full" />
            <span>在线</span>
            <span className="ml-auto opacity-60">Notion Lite v1.0</span>
          </div>
        </div>
      </div>

      {/* 收起时的展开按钮 */}
      {!open && (
        <button
          onClick={onToggle}
          className="fixed top-3 left-3 z-40 p-1.5 bg-white border border-notion-border rounded-md shadow-sm hover:bg-notion-sidebar transition-colors"
          title="展开侧边栏"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 4H13M3 8H13M3 12H13" stroke="#37352F" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </>
  );
}
