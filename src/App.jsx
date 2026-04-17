import { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import CollaborationBar from './components/CollaborationBar';
import TableOfContents from './components/TableOfContents';
import { useBlocks } from './hooks/useBlocks';
import { useCollaboration } from './hooks/useCollaboration';

export default function App() {
  const [currentDocId, setCurrentDocId] = useState('doc-001');
  const [docTitle, setDocTitle] = useState('');
  const [docIcon, setDocIcon] = useState('📝');
  const [documents, setDocuments] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef(null);

  const { blocks, updateBlock, addBlockAfter, insertBlock, deleteBlock, reorderBlock, replaceBlocks, undo, redo } =
    useBlocks([]);

  const collab = useCollaboration(currentDocId);

  // 获取文档列表
  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      setDocuments(data);
    } catch (err) {
      console.error('获取文档列表失败:', err);
    }
  }, []);

  // 获取单个文档
  const fetchDocument = useCallback(async (docId) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/documents/${docId}`);
      const doc = await res.json();
      setDocTitle(doc.title);
      setDocIcon(doc.icon);
      replaceBlocks(doc.blocks);
    } catch (err) {
      console.error('获取文档失败:', err);
    } finally {
      setLoading(false);
    }
  }, [replaceBlocks]);

  // 创建新文档
  const createDocument = useCallback(async () => {
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '无标题' }),
      });
      const doc = await res.json();
      // 文档列表由 WebSocket document-created 事件同步，无需本地重复添加
      setCurrentDocId(doc.id);
    } catch (err) {
      console.error('创建文档失败:', err);
    }
  }, []);

  // 删除文档
  const deleteDocument = useCallback(async (docId) => {
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
      if (!res.ok) {
        console.error('删除文档失败');
      }
      // 文档列表由 WebSocket document-deleted 事件同步
    } catch (err) {
      console.error('删除文档失败:', err);
    }
  }, []);

  // 初始化
  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    if (currentDocId) {
      fetchDocument(currentDocId);
    }
  }, [currentDocId, fetchDocument]);

  // 注册协作回调
  useEffect(() => {
    collab.onBlockUpdated.current = ({ block }) => {
      updateBlock(block.id, block);
    };
    collab.onBlockAdded.current = ({ block, afterBlockId }) => {
      insertBlock(block, afterBlockId);
    };
    collab.onBlockDeleted.current = ({ blockId }) => {
      deleteBlock(blockId);
    };
    collab.onBlockReordered.current = ({ blockId, newIndex }) => {
      reorderBlock(blockId, newIndex);
    };
    collab.onTitleUpdated.current = ({ docId, title }) => {
      if (docId === currentDocId) {
        setDocTitle(title);
      }
      setDocuments((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, title } : d))
      );
    };
    collab.onDocumentCreated.current = (doc) => {
      setDocuments((prev) => {
        if (prev.some((d) => d.id === doc.id)) return prev;
        return [...prev, { id: doc.id, title: doc.title, icon: doc.icon }];
      });
    };
    collab.onDocumentDeleted.current = ({ docId }) => {
      setDocuments((prev) => {
        const remaining = prev.filter((d) => d.id !== docId);
        if (currentDocId === docId && remaining.length > 0) {
          setCurrentDocId(remaining[0].id);
        }
        return remaining;
      });
    };
  }, [collab, updateBlock, insertBlock, deleteBlock, reorderBlock, currentDocId]);

  // Block 操作（带协作同步）
  const handleBlockUpdate = useCallback(
    (blockId, updates) => {
      updateBlock(blockId, updates);
      collab.emitBlockUpdate({ id: blockId, ...updates });
    },
    [updateBlock, collab]
  );

  const handleBlockAdd = useCallback(
    (afterBlockId, type, content) => {
      const newBlock = addBlockAfter(afterBlockId, type, content);
      collab.emitBlockAdd(newBlock, afterBlockId);
      return newBlock;
    },
    [addBlockAfter, collab]
  );

  const handleBlockDelete = useCallback(
    (blockId) => {
      deleteBlock(blockId);
      collab.emitBlockDelete(blockId);
    },
    [deleteBlock, collab]
  );

  const handleBlockReorder = useCallback(
    (blockId, newIndex) => {
      reorderBlock(blockId, newIndex);
      collab.emitBlockReorder(blockId, newIndex);
    },
    [reorderBlock, collab]
  );

  const handleTitleChange = useCallback(
    (title) => {
      setDocTitle(title);
      setDocuments((prev) =>
        prev.map((d) => (d.id === currentDocId ? { ...d, title } : d))
      );
      collab.emitTitleUpdate(title);
    },
    [collab, currentDocId]
  );

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* 侧边栏 */}
      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        documents={documents}
        currentDocId={currentDocId}
        onSelectDoc={setCurrentDocId}
        onCreateDoc={createDocument}
        onDeleteDoc={deleteDocument}
        userName={collab.userName}
      />

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部协作状态栏 */}
        <CollaborationBar
          connected={collab.connected}
          onlineUsers={collab.onlineUsers}
          docTitle={docTitle}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          sidebarOpen={sidebarOpen}
        />

        {/* 编辑器 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="max-w-4xl mx-auto px-24 py-20">
              <div className="space-y-4 animate-pulse">
                <div className="h-10 bg-gray-100 rounded w-2/3" />
                <div className="h-4 bg-gray-100 rounded w-full" />
                <div className="h-4 bg-gray-100 rounded w-5/6" />
                <div className="h-4 bg-gray-100 rounded w-4/6" />
              </div>
            </div>
          ) : (
            <Editor
              blocks={blocks}
              title={docTitle}
              icon={docIcon}
              onTitleChange={handleTitleChange}
              onBlockUpdate={handleBlockUpdate}
              onBlockAdd={handleBlockAdd}
              onBlockDelete={handleBlockDelete}
              onBlockReorder={handleBlockReorder}
              onCursorUpdate={collab.emitCursorUpdate}
              onlineUsers={collab.onlineUsers}
              onUndo={undo}
              onRedo={redo}
            />
          )}
        </div>

        {/* 右侧悬浮目录 */}
        {!loading && (
          <TableOfContents blocks={blocks} scrollContainer={scrollRef.current} />
        )}
      </div>
    </div>
  );
}
