import { useState, useRef, useEffect } from 'react';

/**
 * AI 写作面板
 * 输入提示词，AI 生成内容并插入文档
 */
export default function AIPanel({ onInsert, onClose, contextBlocks }) {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 获取上下文文本
  const getContext = () => {
    return contextBlocks
      .map((b) => b.content)
      .filter(Boolean)
      .join('\n')
      .slice(0, 2000);
  };

  // 发送 AI 请求
  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          context: getContext(),
        }),
      });

      if (!res.ok) {
        throw new Error('AI 服务请求失败');
      }

      const data = await res.json();
      setResult(data.content);
    } catch (err) {
      setError(err.message || '生成失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  // 快捷提示词
  const quickPrompts = [
    { label: '📝 续写', prompt: '请根据上下文续写内容' },
    { label: '📋 总结', prompt: '请总结以上内容' },
    { label: '🌐 翻译', prompt: '请将以上内容翻译为英文' },
    { label: '📊 列表', prompt: '请将以上内容整理为列表' },
    { label: '💻 代码', prompt: '请用代码示例说明以上内容' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black/20" onClick={onClose}>
      <div
        className="ai-panel w-full max-w-xl mx-4 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <span className="text-xl">🤖</span>
          <span className="text-sm font-medium text-purple-700">AI 写作助手</span>
          <button
            onClick={onClose}
            className="ml-auto text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 快捷提示 */}
        <div className="flex gap-2 px-4 py-2 overflow-x-auto">
          {quickPrompts.map((qp) => (
            <button
              key={qp.label}
              onClick={() => {
                setPrompt(qp.prompt);
                inputRef.current?.focus();
              }}
              className="px-3 py-1 text-xs text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-full whitespace-nowrap transition-colors"
            >
              {qp.label}
            </button>
          ))}
        </div>

        {/* 输入框 */}
        <div className="px-4 py-2">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate();
                }
                if (e.key === 'Escape') onClose();
              }}
              placeholder="告诉 AI 你想写什么..."
              className="flex-1 px-3 py-2 text-sm bg-white border border-purple-200 rounded-lg outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-200 transition-all"
            />
            <button
              onClick={handleGenerate}
              disabled={loading || !prompt.trim()}
              className="px-4 py-2 text-sm text-white bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 rounded-lg transition-colors flex items-center gap-1"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  生成中
                </>
              ) : (
                '生成'
              )}
            </button>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mx-4 mb-2 px-3 py-2 text-sm text-red-600 bg-red-50 rounded-lg">
            {error}
          </div>
        )}

        {/* 加载动画 */}
        {loading && (
          <div className="px-4 py-3 space-y-2">
            <div className="ai-loading w-full" />
            <div className="ai-loading w-4/5" />
            <div className="ai-loading w-3/5" />
          </div>
        )}

        {/* AI 生成结果 */}
        {result && (
          <div className="px-4 pb-4">
            <div className="bg-white rounded-lg border border-purple-100 p-3 max-h-60 overflow-y-auto">
              <pre className="text-sm text-notion-text whitespace-pre-wrap font-sans leading-relaxed">
                {result}
              </pre>
            </div>
            <div className="flex gap-2 mt-3 justify-end">
              <button
                onClick={() => {
                  setResult('');
                  setPrompt('');
                  inputRef.current?.focus();
                }}
                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                重新生成
              </button>
              <button
                onClick={() => onInsert(result)}
                className="px-4 py-1.5 text-sm text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
              >
                插入文档
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
