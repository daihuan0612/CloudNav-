import React, { useState, useRef } from 'react';
import { X, Upload, FileText, ArrowRight, Check, AlertCircle, FolderInput, ListTree, Sparkles } from 'lucide-react';
import { Category, LinkItem, AIConfig } from '../types';
import { parseBookmarks } from '../services/bookmarkParser';
import { suggestCategory } from '../services/geminiService';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingLinks: LinkItem[];
  categories: Category[];
  aiConfig: AIConfig;
  onImport: (newLinks: LinkItem[], newCategories: Category[], mode?: 'original' | 'merge' | 'ai') => void;
}

const ImportModal: React.FC<ImportModalProps> = ({ 
  isOpen, 
  onClose, 
  existingLinks, 
  categories, 
  aiConfig,
  onImport 
}) => {
  const [step, setStep] = useState<'upload' | 'preview'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  
  // Analysis Results
  const [newLinksCount, setNewLinksCount] = useState(0);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [newCategoriesCount, setNewCategoriesCount] = useState(0);
  
  // Staging Data
  const [parsedLinks, setParsedLinks] = useState<LinkItem[]>([]);
  const [parsedCategories, setParsedCategories] = useState<Category[]>([]);
  
  // Options
  const [importMode, setImportMode] = useState<'original' | 'merge' | 'ai'>('original');
  const [targetCategoryId, setTargetCategoryId] = useState<string>(categories[0]?.id || 'common');
  const [aiCategorizing, setAiCategorizing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const resetState = () => {
    setStep('upload');
    setFile(null);
    setParsedLinks([]);
    setParsedCategories([]);
    setNewLinksCount(0);
    setDuplicateCount(0);
    setNewCategoriesCount(0);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    setFile(selectedFile);
    setAnalyzing(true);

    try {
        // 1. Parse
        const result = await parseBookmarks(selectedFile);
        
        // 2. Diff Logic：不再丢弃重复链接——统计"已存在"数量仅用于提示，
        //    导入时以新文件为准覆盖
        const existingUrls = new Set(existingLinks.map(l => l.url.trim().replace(/\/$/, ''))); // Normalize URLs slightly
        
        let duplicates = 0;
        result.links.forEach(link => {
            const normalizedUrl = link.url.trim().replace(/\/$/, '');
            if (existingUrls.has(normalizedUrl)) {
                duplicates++;
            }
        });

        // 3. Category Diff
        const existingCategoryNames = new Set(categories.map(c => c.name));
        const uniqueNewCategories = result.categories.filter(c => !existingCategoryNames.has(c.name));

        setParsedLinks(result.links);
        setParsedCategories(result.categories);
        setNewLinksCount(result.links.length);
        setDuplicateCount(duplicates);
        setNewCategoriesCount(uniqueNewCategories.length);
        
        setStep('preview');
    } catch (error) {
        alert("解析文件失败，请确保是标准的 Chrome HTML 书签文件。");
        console.error(error);
    } finally {
        setAnalyzing(false);
    }
  };

  const executeImport = async () => {
      setImporting(true);
      try {
        let finalLinks = [...parsedLinks];
        let finalCategories: Category[] = [];

        if (importMode === 'merge') {
            // 合并模式：跳过已存在的链接，新增的归入指定分类
            const existingUrls = new Set(existingLinks.map(l => l.url.trim().replace(/\/$/, '')));
            finalLinks = finalLinks.filter(link => !existingUrls.has(link.url.trim().replace(/\/$/, '')));
            finalLinks = finalLinks.map(link => ({
                ...link,
                categoryId: targetCategoryId
            }));
            // In merge mode, we do NOT add new categories from the file
            finalCategories = []; 
        } else if (importMode === 'ai') {
            // AI 智能分类：把每条链接归入现有分类（不新建分类、不依赖收藏夹目录结构）
            setAiCategorizing(true);
            finalCategories = [];
            const categorized: LinkItem[] = [];
            for (const link of finalLinks) {
                const catId = await suggestCategory(link.title, link.url, categories.map(c => ({ id: c.id, name: c.name })), aiConfig);
                categorized.push({
                    ...link,
                    categoryId: (catId && categories.some(c => c.id === catId)) ? catId : 'common',
                });
            }
            finalLinks = categorized;
            setAiCategorizing(false);
        } else {
            // 保持目录结构模式：分类按名称映射到现有分类（匹配则不新建），
            // 收藏夹里现有导航站没有的文件夹才新建分类；链接本身在 App 侧统一合并（不清空现有）
            
            const nameToIdMap = new Map<string, string>();
            categories.forEach(c => nameToIdMap.set(c.name, c.id));

            // Valid new categories to add
            const categoriesToAdd: Category[] = [];

            parsedCategories.forEach(pc => {
                if (nameToIdMap.has(pc.name)) {
                    // Category exists, we don't add it.
                    // But we need to know its ID to remap links.
                } else {
                    categoriesToAdd.push(pc);
                    nameToIdMap.set(pc.name, pc.id); // Add new one to map
                }
            });

            // Remap links
            finalLinks = finalLinks.map(link => {
               // Find the name of the category this link was assigned to in the parser
               const originalCat = parsedCategories.find(c => c.id === link.categoryId) 
                                   || categories.find(c => c.id === link.categoryId); // Fallback
               
               if (originalCat && nameToIdMap.has(originalCat.name)) {
                   return { ...link, categoryId: nameToIdMap.get(originalCat.name)! };
               }
               // If for some reason we can't find the map, put it in common
               return { ...link, categoryId: 'common' };
            });

            finalCategories = categoriesToAdd;
        }

        onImport(finalLinks, finalCategories, importMode);
        handleClose();
      } finally {
        setImporting(false);
      }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden border border-slate-200 dark:border-slate-700">
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <h3 className="text-lg font-semibold dark:text-white flex items-center gap-2">
            <Upload size={20} className="text-blue-500"/> 导入书签
          </h3>
          <button onClick={handleClose} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors">
            <X className="w-5 h-5 dark:text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
            
            {step === 'upload' && (
                <div className="flex flex-col items-center justify-center space-y-4 py-8 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                     onClick={() => fileInputRef.current?.click()}>
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        className="hidden" 
                        accept=".html" 
                        onChange={handleFileChange} 
                    />
                    
                    {analyzing ? (
                        <div className="flex flex-col items-center">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mb-2"></div>
                            <span className="text-slate-500">正在分析书签文件...</span>
                        </div>
                    ) : (
                        <>
                            <div className="p-4 bg-blue-100 dark:bg-blue-900/30 rounded-full text-blue-600 dark:text-blue-400">
                                <FileText size={32} />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-medium dark:text-white">点击选择 HTML 文件</p>
                                <p className="text-xs text-slate-500 mt-1">支持 Chrome, Edge, Firefox 导出的书签</p>
                            </div>
                        </>
                    )}
                </div>
            )}

            {step === 'preview' && (
                <div className="space-y-6">
                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-2">
                        <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-center border border-green-100 dark:border-green-900/30">
                            <div className="text-xl font-bold text-green-600 dark:text-green-400">{newLinksCount}</div>
                            <div className="text-xs text-green-700 dark:text-green-500">将导入</div>
                        </div>
                        <div className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg text-center border border-slate-200 dark:border-slate-600">
                            <div className="text-xl font-bold text-slate-600 dark:text-slate-400">{duplicateCount}</div>
                            <div className="text-xs text-slate-500">{importMode === 'original' ? '已存在·将覆盖' : '重复跳过'}</div>
                        </div>
                         <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg text-center border border-purple-100 dark:border-purple-900/30">
                            <div className="text-xl font-bold text-purple-600 dark:text-purple-400">{importMode === 'original' ? newCategoriesCount : 0}</div>
                            <div className="text-xs text-purple-700 dark:text-purple-500">新增分类</div>
                        </div>
                    </div>

                    {newLinksCount === 0 ? (
                        <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-lg text-sm">
                            <AlertCircle size={16} />
                            <span>文件中没有可导入的链接。</span>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {duplicateCount > 0 && (
                                <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-lg text-sm">
                                    <AlertCircle size={16} />
                                    <span>{duplicateCount} 条链接已存在，导入后将<strong>以新文件为准覆盖</strong>。</span>
                                </div>
                            )}
                            <label className="text-sm font-medium dark:text-slate-300">导入方式</label>
                            
                            <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${importMode === 'original' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700'}`}>
                                <input type="radio" name="mode" className="mt-1" checked={importMode === 'original'} onChange={() => setImportMode('original')} />
                                <div>
                                    <div className="flex items-center gap-2 font-medium text-sm dark:text-white">
                                        <ListTree size={16} /> 按收藏夹目录归类
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1">目录名与现有分类相同的归入现有分类，没有的自动新建；现有数据不会清空。</p>
                                </div>
                            </label>

                            <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${importMode === 'merge' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700'}`}>
                                <input type="radio" name="mode" className="mt-1" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} />
                                <div className="w-full">
                                    <div className="flex items-center gap-2 font-medium text-sm dark:text-white">
                                        <FolderInput size={16} /> 全部导入到指定目录
                                    </div>
                                    <div className="mt-2">
                                        <select 
                                            value={targetCategoryId}
                                            onChange={(e) => setTargetCategoryId(e.target.value)}
                                            disabled={importMode !== 'merge'}
                                            onClick={(e) => e.stopPropagation()}
                                            className="w-full text-sm p-2 rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none"
                                        >
                                            {categories.map(c => (
                                                <option key={c.id} value={c.id}>{c.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </label>

                            <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${importMode === 'ai' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700'} ${!aiConfig?.apiKey ? 'opacity-60 pointer-events-none' : ''}`}>
                                <input type="radio" name="mode" className="mt-1" checked={importMode === 'ai'} onChange={() => setImportMode('ai')} />
                                <div>
                                    <div className="flex items-center gap-2 font-medium text-sm dark:text-white">
                                        <Sparkles size={16} /> AI 智能分类
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1">
                                        {aiConfig?.apiKey
                                            ? 'AI 根据网站内容把每条书签归入现有分类，不新建分类；需要先在设置里配置 AI。'
                                            : '需要先在设置里配置 AI（模型/API Key）后才能使用。'}
                                    </p>
                                </div>
                            </label>
                        </div>
                    )}
                    {importing && (
                        <div className="text-sm text-center p-2 rounded bg-blue-50 text-blue-600 dark:bg-blue-900/20 flex items-center justify-center gap-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                            <span>{aiCategorizing ? 'AI 正在分类中，请稍候...' : '正在导入...'}</span>
                        </div>
                    )}
                </div>
            )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3 bg-slate-50 dark:bg-slate-800/50">
            {step === 'upload' ? (
                <button onClick={handleClose} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">取消</button>
            ) : (
                <>
                    <button onClick={resetState} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">重新选择</button>
                    <button 
                        onClick={executeImport} 
                        disabled={newLinksCount === 0}
                        className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2 font-medium"
                    >
                        <Check size={16} /> 确认导入 ({newLinksCount})
                    </button>
                </>
            )}
        </div>

      </div>
    </div>
  );
};

export default ImportModal;