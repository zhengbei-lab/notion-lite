import { useState, useCallback, useRef } from 'react';
import { createBlock } from '../utils/blockTypes';

const MAX_HISTORY = 50;

/**
 * Block 管理 Hook
 * 处理所有 Block 的 CRUD、排序和撤销/重做操作
 */
export function useBlocks(initialBlocks = []) {
  const [blocks, setBlocks] = useState(initialBlocks);
  const historyRef = useRef([]);   // 撤销栈
  const futureRef = useRef([]);    // 重做栈
  const skipHistoryRef = useRef(false); // 跳过记录标记（用于 undo/redo 本身）

  // 保存快照到撤销栈
  const pushHistory = useCallback((currentBlocks) => {
    historyRef.current = [
      ...historyRef.current.slice(-(MAX_HISTORY - 1)),
      JSON.parse(JSON.stringify(currentBlocks)),
    ];
    futureRef.current = []; // 新操作清空重做栈
  }, []);

  // 带历史记录的 setBlocks
  const setBlocksWithHistory = useCallback((updater) => {
    setBlocks((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (!skipHistoryRef.current) {
        pushHistory(prev);
      }
      return next;
    });
  }, [pushHistory]);

  // 撤销
  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    setBlocks((prev) => {
      futureRef.current = [...futureRef.current, JSON.parse(JSON.stringify(prev))];
      const snapshot = historyRef.current.pop();
      return snapshot;
    });
  }, []);

  // 重做
  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    setBlocks((prev) => {
      historyRef.current = [...historyRef.current, JSON.parse(JSON.stringify(prev))];
      const snapshot = futureRef.current.pop();
      return snapshot;
    });
  }, []);

  const updateBlock = useCallback((blockId, updates) => {
    setBlocksWithHistory((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, ...updates } : b))
    );
  }, [setBlocksWithHistory]);

  const addBlockAfter = useCallback((afterBlockId, type = 'paragraph', content = '') => {
    const newBlock = createBlock(type, content);
    setBlocksWithHistory((prev) => {
      const idx = prev.findIndex((b) => b.id === afterBlockId);
      const newBlocks = [...prev];
      newBlocks.splice(idx + 1, 0, newBlock);
      return newBlocks;
    });
    return newBlock;
  }, [setBlocksWithHistory]);

  const insertBlock = useCallback((block, afterBlockId) => {
    setBlocksWithHistory((prev) => {
      const idx = prev.findIndex((b) => b.id === afterBlockId);
      const newBlocks = [...prev];
      if (idx !== -1) {
        newBlocks.splice(idx + 1, 0, block);
      } else {
        newBlocks.push(block);
      }
      return newBlocks;
    });
  }, [setBlocksWithHistory]);

  const deleteBlock = useCallback((blockId) => {
    setBlocksWithHistory((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((b) => b.id !== blockId);
    });
  }, [setBlocksWithHistory]);

  const reorderBlock = useCallback((blockId, newIndex) => {
    setBlocksWithHistory((prev) => {
      const oldIdx = prev.findIndex((b) => b.id === blockId);
      if (oldIdx === -1 || newIndex < 0 || newIndex >= prev.length) return prev;
      const newBlocks = [...prev];
      const [block] = newBlocks.splice(oldIdx, 1);
      newBlocks.splice(newIndex, 0, block);
      return newBlocks;
    });
  }, [setBlocksWithHistory]);

  const replaceBlocks = useCallback((newBlocks) => {
    // replaceBlocks 用于远程同步，不记录历史
    setBlocks(newBlocks);
  }, []);

  return {
    blocks,
    updateBlock,
    addBlockAfter,
    insertBlock,
    deleteBlock,
    reorderBlock,
    replaceBlocks,
    undo,
    redo,
  };
}
