export default function CollaborationBar({
  connected,
  onlineUsers,
  docTitle,
  onToggleSidebar,
  sidebarOpen,
}) {
  return (
    <div className="h-11 flex items-center justify-between px-3 border-b border-notion-border bg-white flex-shrink-0">
      {/* 左侧：面包屑导航 */}
      <div className="flex items-center gap-1 text-sm text-notion-text-light min-w-0">
        {!sidebarOpen && (
          <button
            onClick={onToggleSidebar}
            className="p-1 mr-1 hover:bg-notion-hover rounded transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 4H13M3 8H13M3 12H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <span className="truncate max-w-xs">{docTitle || '无标题'}</span>
      </div>

      {/* 右侧：协作状态 */}
      <div className="flex items-center gap-3">
        {/* 在线用户头像 */}
        <div className="flex items-center -space-x-1.5">
          {onlineUsers.slice(0, 5).map((user) => (
            <div
              key={user.id}
              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium border-2 border-white shadow-sm"
              style={{ backgroundColor: user.color }}
              title={user.name}
            >
              {user.name[0]}
            </div>
          ))}
          {onlineUsers.length > 5 && (
            <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xs font-medium border-2 border-white">
              +{onlineUsers.length - 5}
            </div>
          )}
        </div>

        {/* 连接状态 */}
        <div className="flex items-center gap-1.5 text-xs text-notion-text-light">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              connected ? 'bg-notion-green' : 'bg-notion-red'
            }`}
          />
          <span>{connected ? '已连接' : '连接中...'}</span>
        </div>

        {/* 分享按钮 */}
        <button className="px-3 py-1 text-sm text-white bg-notion-accent hover:bg-notion-blue rounded transition-colors">
          分享
        </button>
      </div>
    </div>
  );
}
