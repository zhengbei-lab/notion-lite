import { useState, useCallback } from 'react';
import { createBlock } from '../utils/blockTypes';

/**
 * Block 管理 Hook
 * 处理所有 Block 的 CRUD 和排序操作
 */
export function useBlocks(initialBlocks = []) {
  const [blocks, setBlocks] = useState(initialBlocks);

  const updateBlock = useCallback((blockId, updates) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, ...updates } : b))
    );
  }, []);

  const addBlockAfter = useCallback((afterBlockId, type = 'paragraph', content = '') => {
    const newBlock = createBlock(type, content);
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === afterBlockId);
      const newBlocks = [...prev];
      newBlocks.splice(idx + 1, 0, newBlock);
      return newBlocks;
    });
    return newBlock;
  }, []);

  const insertBlock = useCallback((block, afterBlockId) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === afterBlockId);
      const newBlocks = [...prev];
      if (idx !== -1) {
        newBlocks.splice(idx + 1, 0, block);
      } else {
        newBlocks.push(block);
      }
      return newBlocks;
    });
  }, []);

  const deleteBlock = useCallback((blockId) => {
    setBlocks((prev) => {
      if (prev.length <= 1) return prev; // 至少保留一个 Block
      return prev.filter((b) => b.id !== blockId);
    });
  }, []);

  const reorderBlock = useCallback((blockId, newIndex) => {
    setBlocks((prev) => {
      const oldIdx = prev.findIndex((b) => b.id === blockId);
      if (oldIdx === -1 || newIndex < 0 || newIndex >= prev.length) return prev;
      const newBlocks = [...prev];
      const [block] = newBlocks.splice(oldIdx, 1);
      newBlocks.splice(newIndex, 0, block);
      return newBlocks;
    });
  }, []);

  const replaceBlocks = useCallback((newBlocks) => {
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
  };
}
