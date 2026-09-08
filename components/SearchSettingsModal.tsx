
import React, { useState } from 'react';
import { X, Search, Plus, Trash2, Check, Globe, Wand2 } from 'lucide-react';
import { SearchEngine } from '../types';
import { getFaviconUrl, handleIconError } from '../utils/favicon';

interface SearchSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  engines: SearchEngine[];
  activeEngineId: string;
  onUpdateEngines: (engines: SearchEngine[]) => void;
  onSelectEngine: (id: string) => void;
}

const SearchSettingsModal: React.FC<SearchSettingsModalProps> = ({
  isOpen,
  onClose,
  engines,
  activeEngineId,
  onUpdateEngines,
  onSelectEngine
}) => {
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newIcon, setNewIcon] = useState('');
  const [autoFetchIcon, setAutoFetchIcon] = useState(true);

  if (!isOpen) return null;

  const handleAdd = () => {
    if (!newName || !newUrl) return;
    
    // 简单的 URL 校验
    let formattedUrl = newUrl;
    if (!formattedUrl.startsWith('http')) {
        formattedUrl = 'https://' + formattedUrl;
    }

    const newEngine: SearchEngine = {
      id: Date.now().toString(),
      name: newName,
      url: formattedUrl,
      icon: newIcon || 'Globe' // Default to Globe icon if empty
    };

    onUpdateEngines([...engines, newEngine]);
    setNewName('');
    setNewUrl('');
    setNewIcon('');
  };

  const handleDelete = (id: string) => {
    if (confirm('确定删除此搜索引擎吗？')) {
        const updated = engines.filter(e => e.id !== id);
        onUpdateEngines(updated);
        // 如果删除了当前选中的，重置为第一个可用的
        if (id === activeEngineId && updated.length > 0) {
            onSelectEngine(updated[0].id);
        }
    }
  };

  const fetchIconFromUrl = (targetUrl: string) => {
      if (!targetUrl) return;
      try {
        let normalizedUrl = targetUrl;
        if (!targetUrl.startsWith('http')) {
            normalizedUrl = 'https://' + targetUrl;
        }
        
        // 尝试解析域名
        const urlObj = new URL(normalizedUrl);
        const origin = urlObj.origin;
        
        // 使用 Google 的 favicon 服务获取图标
        const newIconUrl = getFaviconUrl(normalizedUrl);
        
        setNewIcon(newIconUrl);
      } catch (e) {
          // invalid url
      }
  };

  const handleUrlBlur = () => {
      if (autoFetchIcon && newUrl && !newIcon) {
          fetchIconFromUrl(newUrl);
      }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col max-h-[85vh]">
        
        <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold dark:text-white flex items-center gap-2">
            <Search className="text-blue-500" size={20}/> 搜索引擎管理
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
            <X className="w-5 h-5 dark:text-slate-400" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-6">
            
            {/* List */}
            <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">选择默认搜索引擎</label>
                {engines.map(engine => (
                    <div 
                        key={engine.id}
                        onClick={() => onSelectEngine(engine.id)}
                        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                            activeEngineId === engine.id 
                            ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500 dark:bg-blue-900/20 dark:border-blue-500' 
                            : 'bg-white border-slate-200 hover:border-blue-300 dark:bg-slate-700/50 dark:border-slate-600 dark:hover:border-slate-500'
                        }`}
                    >
                        <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-600 flex items-center justify-center shrink-0 overflow-hidden">
                            {engine.icon.startsWith('http') ? (
                                <img src={engine.icon} className="w-full h-full object-cover" />
                            ) : (
                                <Globe size={16} className="text-slate-500 dark:text-slate-300"/>
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-slate-800 dark:text-slate-200">{engine.name}</div>
                            <div className="text-xs text-slate-400 truncate">{engine.url}</div>
                        </div>
                        {activeEngineId === engine.id && (
                            <div className="text-blue-600 dark:text-blue-400"><Check size={18} /></div>
                        )}
                        {engines.length > 1 && (
                            <button 
                                onClick={(e) => { e.stopPropagation(); handleDelete(engine.id); }}
                                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            >
                                <Trash2 size={16} />
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {/* Add New */}
            <div className="p-4 bg-slate-50 dark:bg-slate-700/30 rounded-xl border border-slate-200 dark:border-slate-600 space-y-4">
                <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-500 uppercase">添加新引擎</label>
                </div>
                
                <div className="space-y-3">
                    {/* Name */}
                    <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">名称</label>
                        <input 
                            type="text" 
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="例如: Google"
                            className="w-full p-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    {/* Search URL */}
                    <div>
                         <label className="block text-xs font-medium text-slate-500 mb-1">搜索 URL</label>
                         <input 
                            type="text" 
                            value={newUrl}
                            onChange={(e) => setNewUrl(e.target.value)}
                            onBlur={handleUrlBlur}
                            placeholder="例如: https://www.google.com/search?q="
                            className="w-full p-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">系统会自动将搜索词拼接到此 URL 末尾</p>
                    </div>

                    {/* Icon Section */}
                    <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">图标 URL</label>
                        <div className="flex gap-2">
                             {/* Preview */}
                             <div className="shrink-0 w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 flex items-center justify-center overflow-hidden">
                                {newIcon ? (
                                     <img 
                                        src={newIcon} 
                                        className="w-full h-full object-contain"
                                        onError={(e) => handleIconError(e, newUrl, '搜')}
                                     />
                                ) : (
                                    <Globe size={18} className="text-slate-400"/>
                                )}
                             </div>
                             
                             {/* Input */}
                             <input 
                                type="text"
                                value={newIcon}
                                onChange={(e) => setNewIcon(e.target.value)}
                                className="flex-1 p-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="https://..."
                             />
            
                             {/* Button */}
                             <button
                                type="button"
                                onClick={() => fetchIconFromUrl(newUrl)}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1 whitespace-nowrap transition-colors"
                             >
                                <Wand2 size={14} /> <span className="hidden sm:inline">获取</span>
                             </button>
                        </div>
                        
                        <div className="mt-2 flex items-center gap-2">
                            <input 
                                type="checkbox" 
                                id="autoFetchSearch"
                                checked={autoFetchIcon}
                                onChange={(e) => setAutoFetchIcon(e.target.checked)}
                                className="rounded text-blue-600 focus:ring-blue-500 w-3 h-3"
                            />
                            <label htmlFor="autoFetchSearch" className="text-xs text-slate-500 cursor-pointer select-none">
                                输入 URL 时自动获取图标
                            </label>
                        </div>
                    </div>
                </div>

                <div className="pt-2">
                    <button 
                        onClick={handleAdd}
                        disabled={!newName || !newUrl}
                        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        <Plus size={16} /> 添加搜索引擎
                    </button>
                </div>
            </div>

        </div>
      </div>
    </div>
  );
};

export default SearchSettingsModal;
