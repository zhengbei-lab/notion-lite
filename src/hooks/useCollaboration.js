import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

/**
 * WebSocket 协作 Hook
 * 管理实时连接、用户状态和文档同步
 */
export function useCollaboration(docId) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [userName] = useState(() => {
    const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry'];
    return names[Math.floor(Math.random() * names.length)];
  });

  // 事件回调 refs
  const onBlockUpdated = useRef(null);
  const onBlockAdded = useRef(null);
  const onBlockDeleted = useRef(null);
  const onBlockReordered = useRef(null);
  const onTitleUpdated = useRef(null);
  const onCursorUpdated = useRef(null);
  const onDocumentCreated = useRef(null);
  const onDocumentDeleted = useRef(null);

  useEffect(() => {
    if (!docId) return;

    const socket = io(window.location.origin, {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join-document', { docId, userName });
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('users-update', (users) => setOnlineUsers(users));

    socket.on('block-updated', (data) => onBlockUpdated.current?.(data));
    socket.on('block-added', (data) => onBlockAdded.current?.(data));
    socket.on('block-deleted', (data) => onBlockDeleted.current?.(data));
    socket.on('block-reordered', (data) => onBlockReordered.current?.(data));
    socket.on('title-updated', (data) => onTitleUpdated.current?.(data));
    socket.on('cursor-updated', (data) => onCursorUpdated.current?.(data));
    socket.on('document-created', (data) => onDocumentCreated.current?.(data));
    socket.on('document-deleted', (data) => onDocumentDeleted.current?.(data));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [docId, userName]);

  const emitBlockUpdate = useCallback((block) => {
    socketRef.current?.emit('block-update', { docId, block });
  }, [docId]);

  const emitBlockAdd = useCallback((block, afterBlockId) => {
    socketRef.current?.emit('block-add', { docId, block, afterBlockId });
  }, [docId]);

  const emitBlockDelete = useCallback((blockId) => {
    socketRef.current?.emit('block-delete', { docId, blockId });
  }, [docId]);

  const emitBlockReorder = useCallback((blockId, newIndex) => {
    socketRef.current?.emit('block-reorder', { docId, blockId, newIndex });
  }, [docId]);

  const emitTitleUpdate = useCallback((title) => {
    socketRef.current?.emit('title-update', { docId, title });
  }, [docId]);

  const emitCursorUpdate = useCallback((blockId, offset) => {
    socketRef.current?.emit('cursor-update', { docId, blockId, offset });
  }, [docId]);

  return {
    connected,
    onlineUsers,
    userName,
    // 发送事件
    emitBlockUpdate,
    emitBlockAdd,
    emitBlockDelete,
    emitBlockReorder,
    emitTitleUpdate,
    emitCursorUpdate,
    // 注册回调
    onBlockUpdated,
    onBlockAdded,
    onBlockDeleted,
    onBlockReordered,
    onTitleUpdated,
    onCursorUpdated,
    onDocumentCreated,
    onDocumentDeleted,
  };
}
