
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Search, Plus, Upload, Moon, Sun, Menu, 
  Trash2, Edit2, Loader2, Cloud, CheckCircle2, AlertCircle,
  Pin, Settings, Lock, CloudCog, Github, MoreVertical,
  QrCode, Copy, LayoutGrid, List, Check, ExternalLink, ArrowRight, Activity
} from 'lucide-react';
import { 
    LinkItem, Category, DEFAULT_CATEGORIES, INITIAL_LINKS, 
    WebDavConfig, AIConfig, SiteSettings, SearchEngine, DEFAULT_SEARCH_ENGINES,
    DEFAULT_SITE_TITLE, DEFAULT_SITE_SETTINGS, SITE_SETTINGS_KEY, CloudData
} from './types';
import Icon from './components/Icon';
import { handleIconError, handleIconLoad, getInitialIconSrc } from './utils/favicon';
import LinkModal from './components/LinkModal';
import AuthModal from './components/AuthModal';
import CategoryManagerModal from './components/CategoryManagerModal';
import BackupModal from './components/BackupModal';
import CategoryAuthModal from './components/CategoryAuthModal';
import ImportModal from './components/ImportModal';
import SettingsModal from './components/SettingsModal';
import SearchSettingsModal from './components/SearchSettingsModal';
import DeadLinkCheckModal from './components/DeadLinkCheckModal';
import UnlockScreen from './components/UnlockScreen';
import AuthorBadge from './components/AuthorBadge';

const LOCAL_STORAGE_KEY = 'cloudnav_data_cache';
const AUTH_KEY = 'cloudnav_auth_token';
const AUTH_EXPIRY_KEY = 'cloudnav_auth_expiry';
const AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天免密
const WEBDAV_CONFIG_KEY = 'cloudnav_webdav_config';
const AI_CONFIG_KEY = 'cloudnav_ai_config';
const SEARCH_ENGINES_KEY = 'cloudnav_search_engines';
// 当前选中的搜索引擎 id：以前只放在内存里，刷新就跳回第一个引擎（手机/电脑各选各的）
const SEARCH_ENGINE_ID_KEY = 'cloudnav_search_engine_id';

/** 读一个字符串型缓存（persist 写进去的是 JSON，所以要 parse 回来） */
const readCachedString = (key: string): string => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : '';
  } catch {
    return '';
  }
};

/** localStorage 写入包装：无痕模式 / 配额满时 setItem 会抛异常，不能让它把整页带崩 */
const persist = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
};

/** AI 配置默认值：不预置任何 Key / 接口地址，由使用者在「设置 → AI 设置」里自己填 */
const DEFAULT_AI_CONFIG: AIConfig = {
  provider: 'gemini',
  apiKey: '',
  baseUrl: '',
  model: 'gemini-2.5-flash',
};

const EMPTY_WEBDAV_CONFIG: WebDavConfig = { url: '', username: '', password: '', enabled: false };

/* ------------------------------- 防护工具 -------------------------------
 * 本地缓存或云端 KV 里如果有脏数据（不是数组、是字符串、字段类型不对），
 * 直接拿去 .map() / 展开展开就会整页崩溃。下面两个小工具用来兜住这类情况。 */

/** 保证拿到的一定是数组，否则退回默认值 */
const asArray = <T,>(value: unknown, fallback: T[]): T[] =>
  Array.isArray(value) ? (value as T[]) : fallback;

/** 保证拿到的一定是普通对象（排除 null / 数组 / 字符串），否则返回 null */
const asPlainObject = <T,>(value: unknown): Partial<T> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<T>)
    : null;

/** 读取本地缓存（书签 / 分类 / 站点设置）。缓存缺失或损坏时返回 null，由调用方兜底。 */
const readLocalCache = (): { links: LinkItem[]; categories: Category[]; settings?: Partial<SiteSettings> } | null => {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return {
      links: asArray<LinkItem>(parsed?.links, INITIAL_LINKS),
      categories: asArray<Category>(parsed?.categories, DEFAULT_CATEGORIES),
      settings: asPlainObject<SiteSettings>(parsed?.settings) || undefined,
    };
  } catch (e) {
    return null;
  }
};

function App() {
  // --- State ---
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('all'); 
  const [searchQuery, setSearchQuery] = useState('');
  const [dragLinkId, setDragLinkId] = useState<string | null>(null);
  const [dragOverLinkId, setDragOverLinkId] = useState<string | null>(null);
  
  // New Search State
  const [searchMode, setSearchMode] = useState<'local' | 'external'>('local');
  const [externalEngines, setExternalEngines] = useState<SearchEngine[]>(() => {
      const saved = localStorage.getItem(SEARCH_ENGINES_KEY);
      if (saved) {
          try { return JSON.parse(saved); } catch(e) {}
      }
      // Filter out 'local' from defaults for the external list
      return DEFAULT_SEARCH_ENGINES.filter(e => e.id !== 'local');
  });
  const [activeEngineId, setActiveEngineId] = useState<string>(() => {
      // 先看上次选的（刷新/换设备后别跳回第一个），再退回第一个引擎
      return readCachedString(SEARCH_ENGINE_ID_KEY) || externalEngines[0]?.id || 'google';
  });
  const [isSearchSettingsOpen, setIsSearchSettingsOpen] = useState(false);

  const [darkMode, setDarkMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Site Settings - 优先从本地缓存读取（解锁前也能用上上次保存的名称/图标）
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(() => {
      try {
          const cached = localStorage.getItem(SITE_SETTINGS_KEY);
          if (cached) return { ...DEFAULT_SITE_SETTINGS, ...JSON.parse(cached) };
      } catch (e) {}
      return { ...DEFAULT_SITE_SETTINGS };
  });
  
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, link: LinkItem | null } | null>(null);
  
  const [qrCodeLink, setQrCodeLink] = useState<LinkItem | null>(null);

  const [unlockedCategoryIds, setUnlockedCategoryIds] = useState<Set<string>>(new Set());

  const [webDavConfig, setWebDavConfig] = useState<WebDavConfig>({ ...EMPTY_WEBDAV_CONFIG });

  const [aiConfig, setAiConfig] = useState<AIConfig>(() => {
      const saved = localStorage.getItem(AI_CONFIG_KEY);
      if (saved) {
          try {
              return { ...DEFAULT_AI_CONFIG, ...JSON.parse(saved) };
          } catch (e) {}
      }
      return { ...DEFAULT_AI_CONFIG };
  });
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isCatManagerOpen, setIsCatManagerOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isDeadLinkCheckOpen, setIsDeadLinkCheckOpen] = useState(false);
  const [catAuthModalData, setCatAuthModalData] = useState<Category | null>(null);
  
  const [editingLink, setEditingLink] = useState<LinkItem | undefined>(undefined);
  const [prefillLink, setPrefillLink] = useState<Partial<LinkItem> | undefined>(undefined);
  
  const [syncStatus, setSyncStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [authToken, setAuthToken] = useState<string>('');

  const mainRef = useRef<HTMLDivElement>(null);
  const isAutoScrollingRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // 手机/平板没有右键 ⇒ 用"长按卡片"打开同一个菜单（见 handleCardTouchStart）
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);

  // 触屏设备（手机/平板）关掉 HTML5 拖拽：否则安卓长按会变成"拖动卡片"，跟长按菜单抢手势。
  // 桌面鼠标环境不受影响（拖拽排序照旧）。
  const isCoarsePointer = useMemo(
    () => (typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches),
    []
  );

  // --- Helpers ---

  const loadFromLocal = () => {
    const cached = readLocalCache();
    if (cached) {
      setLinks(cached.links);
      setCategories(cached.categories);
      if (cached.settings) {
        setSiteSettings(prev => ({ ...prev, ...cached.settings }));
      }
    } else {
      setLinks(INITIAL_LINKS);
      setCategories(DEFAULT_CATEGORIES);
    }
  };

  /** 当前"该同步的东西"全集：书签 / 分类 / 站点设置 + AI 配置 + WebDAV 配置 + 搜索引擎。
   *  以前只有前三样进云端，所以换设备（手机）看不到 AI 与 DAV —— 这里把它们一起带上。 */
  const buildCloudPayload = (over: Partial<CloudData> = {}): CloudData => ({
      links,
      categories,
      settings: siteSettings,
      aiConfig,
      webdavConfig: webDavConfig,
      searchEngines: externalEngines,
      searchEngineId: activeEngineId,
      ...over,
  });

  const syncToCloud = async (payload: CloudData, token: string) => {
    setSyncStatus('saving');
    try {
        const response = await fetch('/api/storage', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-password': token
            },
            body: JSON.stringify(payload)
        });

        if (response.status === 401) {
            setAuthToken('');
            localStorage.removeItem(AUTH_KEY);
            setIsAuthOpen(true);
            setSyncStatus('error');
            return false;
        }

        if (!response.ok) throw new Error('Network response was not ok');
        
        setSyncStatus('saved');
        setTimeout(() => setSyncStatus('idle'), 2000);
        return true;
    } catch (error) {
        console.error("Sync failed", error);
        setSyncStatus('error');
        return false;
    }
  };

  /** 把远端（云端 KV 或 WebDAV 备份文件）里的「配置类」数据合并进当前状态。
   *  - AI / WebDAV / 搜索引擎以前只存浏览器本地，所以老数据里没有这些字段 → 一律按"未提供"处理；
   *  - 远端值为空（AI 没填 Key / DAV 没填地址 / 引擎列表为空）时也忽略，避免用空值把本地已填好的配置冲掉。
   *  返回值是"合并后的完整配置"，调用方可以立刻拿它去推送，不必等 React 状态更新。 */
  const applyRemoteConfig = (data: Partial<CloudData> | null | undefined) => {
      const remoteAi = asPlainObject<AIConfig>(data?.aiConfig);
      const nextAi = remoteAi && String(remoteAi.apiKey || '').trim()
          ? { ...DEFAULT_AI_CONFIG, ...remoteAi }
          : null;
      if (nextAi) {
          setAiConfig(nextAi);
          persist(AI_CONFIG_KEY, nextAi);
      }

      const remoteDav = asPlainObject<WebDavConfig>(data?.webdavConfig);
      const nextDav = remoteDav && String(remoteDav.url || '').trim()
          ? { ...EMPTY_WEBDAV_CONFIG, ...remoteDav }
          : null;
      if (nextDav) {
          setWebDavConfig(nextDav);
          persist(WEBDAV_CONFIG_KEY, nextDav);
      }

      const remoteEngines = asArray<SearchEngine>(data?.searchEngines, []);
      const nextEngines = remoteEngines.length > 0 ? remoteEngines : null;
      if (nextEngines) {
          setExternalEngines(nextEngines);
          persist(SEARCH_ENGINES_KEY, nextEngines);
      }

      const remoteEngineId = typeof data?.searchEngineId === 'string' && data.searchEngineId
          ? data.searchEngineId
          : null;
      if (remoteEngineId) {
          setActiveEngineId(remoteEngineId);
          persist(SEARCH_ENGINE_ID_KEY, remoteEngineId);
      }

      return {
          aiConfig: nextAi || aiConfig,
          webdavConfig: nextDav || webDavConfig,
          searchEngines: nextEngines || externalEngines,
          searchEngineId: remoteEngineId || activeEngineId,
      };
  };

  const updateData = (newLinks: LinkItem[], newCategories: Category[], newSettings: SiteSettings = siteSettings, configOverride?: Partial<CloudData>) => {
      setLinks(newLinks);
      setCategories(newCategories);
      setSiteSettings(newSettings);
      persist(LOCAL_STORAGE_KEY, { links: newLinks, categories: newCategories, settings: newSettings });
      if (authToken) {
          syncToCloud(buildCloudPayload({ links: newLinks, categories: newCategories, settings: newSettings, ...configOverride }), authToken);
      }
  };

  useEffect(() => {
    if (localStorage.getItem('theme') === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setDarkMode(true);
      document.documentElement.classList.add('dark');
    }
    const savedToken = localStorage.getItem(AUTH_KEY);
    const savedExpiry = localStorage.getItem(AUTH_EXPIRY_KEY);
    if (savedToken && savedExpiry && Date.now() < Number(savedExpiry)) {
      setAuthToken(savedToken);
    } else {
      // 过期或格式异常：清除登录态，回到解锁界面
      localStorage.removeItem(AUTH_KEY);
      localStorage.removeItem(AUTH_EXPIRY_KEY);
    }

    const savedWebDav = localStorage.getItem(WEBDAV_CONFIG_KEY);
    if (savedWebDav) {
        try {
            setWebDavConfig(JSON.parse(savedWebDav));
        } catch (e) {}
    }

    const urlParams = new URLSearchParams(window.location.search);
    const addUrl = urlParams.get('add_url');
    if (addUrl) {
        const addTitle = urlParams.get('add_title') || '';
        window.history.replaceState({}, '', window.location.pathname);
        setPrefillLink({
            title: addTitle,
            url: addUrl,
            categoryId: 'common'
        });
        setEditingLink(undefined);
        setIsModalOpen(true);
    }
  }, []);

  // 解锁后（拿到访问密码）才从云端拉取数据
  useEffect(() => {
    if (!authToken) return;
    const initData = async () => {
        try {
            const res = await fetch('/api/storage', {
                headers: { 'x-auth-password': authToken }
            });
            if (res.status === 401) {
                // 密码已失效，清除登录态回到解锁界面
                setAuthToken('');
                localStorage.removeItem(AUTH_KEY);
                localStorage.removeItem(AUTH_EXPIRY_KEY);
                return;
            }
            if (res.ok) {
                const data = await res.json();
                const cloudLinks = asArray<LinkItem>(data?.links, []);
                const cloudSettings = asPlainObject<SiteSettings>(data?.settings);
                const localCache = readLocalCache();

                if (cloudLinks.length > 0) {
                    setLinks(cloudLinks);
                    // 防护：云端数据被手改坏 / 字段类型不对时，退回内置分类而不是崩掉
                    setCategories(asArray<Category>(data?.categories, DEFAULT_CATEGORIES));
                    if (cloudSettings) {
                        setSiteSettings(prev => ({ ...prev, ...cloudSettings }));
                    }
                    persist(LOCAL_STORAGE_KEY, data);
                } else {
                    // 云端还没有数据：退回本地缓存，别把页面留成空白
                    loadFromLocal();
                }

                // 配置类数据（AI / WebDAV / 搜索引擎）单独合并 —— 老云端数据里没有这几个字段是正常的
                const cfg = applyRemoteConfig(data);

                // 需要"把本地这份顶上去"的两种情况：
                //  ① 云端连书签都没有、本地却有（首次部署 / 刚换 KV）
                //  ② 云端还没有配置类字段、本地却已经填好了 AI Key 或 DAV 地址
                //     —— 老版本这些只存本地，不补传的话用户还得回电脑上再点一次"保存"才同步得到手机
                const cloudHasConfig = !!(data?.aiConfig || data?.webdavConfig);
                const needPushLinks = cloudLinks.length === 0 && !!localCache && localCache.links.length > 0;
                const needPushConfig = !cloudHasConfig && !!(cfg.aiConfig?.apiKey || cfg.webdavConfig?.url);

                if (needPushLinks || needPushConfig) {
                    syncToCloud({
                        links: needPushLinks && localCache ? localCache.links : cloudLinks,
                        categories: needPushLinks && localCache
                            ? localCache.categories
                            : asArray<Category>(data?.categories, DEFAULT_CATEGORIES),
                        // 只补配置时，站点设置以云端为准（刚合并过的那份），别拿本地旧值把云端覆盖回去
                        settings: needPushLinks && localCache
                            ? { ...siteSettings, ...(localCache.settings || {}) }
                            : { ...siteSettings, ...(cloudSettings || {}) },
                        ...cfg,
                    }, authToken);
                }
                return;
            }
        } catch (e) {
            console.warn("Failed to fetch from cloud, falling back to local.", e);
        }
        loadFromLocal();
    };

    initData();
  }, [authToken]);

  useEffect(() => {
      document.title = siteSettings.title || DEFAULT_SITE_TITLE;
      const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
      if (link && siteSettings.favicon) {
          link.href = siteSettings.favicon;
      }
      // 回写本地缓存：让 index.html 下次加载时（包括解锁界面）直接用上自定义名称
      try {
          localStorage.setItem(SITE_SETTINGS_KEY, JSON.stringify(siteSettings));
      } catch (e) {}
  }, [siteSettings]);

  useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
          if (openMenuId) setOpenMenuId(null);
          if (contextMenu && contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
             setContextMenu(null);
          }
      };
      
      const handleScroll = () => {
         if (contextMenu) setContextMenu(null);
      };

      window.addEventListener('click', handleClickOutside);
      window.addEventListener('scroll', handleScroll, true); 
      
      const handleGlobalContextMenu = (e: MouseEvent) => {
          if (contextMenu) {
              e.preventDefault();
              setContextMenu(null);
          }
      }
      window.addEventListener('contextmenu', handleGlobalContextMenu);

      return () => {
          window.removeEventListener('click', handleClickOutside);
          window.removeEventListener('scroll', handleScroll, true);
          window.removeEventListener('contextmenu', handleGlobalContextMenu);
      }
  }, [openMenuId, contextMenu]);

  useEffect(() => {
    const handleScroll = () => {
        if (isAutoScrollingRef.current) return;
        if (!mainRef.current) return;
        
        const scrollPosition = mainRef.current.scrollTop + 150;

        if (mainRef.current.scrollTop < 80) {
            setActiveCategory('all');
            return;
        }

        let currentCatId = 'all';
        for (const cat of categories) {
            const el = document.getElementById(`cat-${cat.id}`);
            if (el && el.offsetTop <= scrollPosition && (el.offsetTop + el.offsetHeight) > scrollPosition) {
                currentCatId = cat.id;
                break;
            }
        }
        if (currentCatId !== 'all') setActiveCategory(currentCatId);
    };

    const mainEl = mainRef.current;
    if (mainEl) mainEl.addEventListener('scroll', handleScroll);
    return () => mainEl?.removeEventListener('scroll', handleScroll);
  }, [categories]);

  const toggleTheme = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    if (newMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  // --- Handlers ---
  // 只校验密码，**不**顺手把本地数据 POST 上去：
  // 旧写法用 POST /api/storage 当"验证"，于是新设备（手机）第一次登录时会拿它那份空数据
  // 覆盖云端已有内容。现在改成 /api/verify，数据统一由上面的 useEffect 从云端拉。
  const handleLogin = async (password: string): Promise<boolean> => {
      try {
        const response = await fetch('/api/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        if (response.ok) {
            setAuthToken(password);
            localStorage.setItem(AUTH_KEY, password);
            localStorage.setItem(AUTH_EXPIRY_KEY, String(Date.now() + AUTH_TTL_MS));
            setIsAuthOpen(false);
            setSyncStatus('saved');
            return true;
        }
        return false;
      } catch (e) {
          return false;
      }
  };

  const handleImportConfirm = (newLinks: LinkItem[], newCategories: Category[], mode?: 'original' | 'merge' | 'ai') => {
      const mergedCategories = [...categories];
      newCategories.forEach(nc => {
          if (!mergedCategories.some(c => c.id === nc.id || c.name === nc.name)) {
              mergedCategories.push(nc);
          }
      });
      // 统一合并：现有链接全部保留；导入链接按 URL 去重，重复的以新文件为准覆盖（含备注），
      // 不重复的追加。不再清空现有数据（原 original 模式直接替换导致现有分类条目全空）
      const normalizeUrl = (u?: string) => (u || '').trim().replace(/\/$/, '');
      const mergedLinks = [...links];
      newLinks.forEach(nl => {
          const idx = mergedLinks.findIndex(l => normalizeUrl(l.url) === normalizeUrl(nl.url));
          if (idx >= 0) {
              // 覆盖：保留现有 id 与 pinned 状态，其余字段（标题/链接/备注/图标/分类）以新为准
              mergedLinks[idx] = {
                  ...mergedLinks[idx],
                  ...nl,
                  id: mergedLinks[idx].id,
                  pinned: mergedLinks[idx].pinned ?? nl.pinned,
              };
          } else {
              mergedLinks.push(nl);
          }
      });
      updateData(mergedLinks, mergedCategories);
      setIsImportModalOpen(false);
      alert(`成功导入 ${newLinks.length} 个书签（已合并现有数据，重复链接已覆盖）!`);
  };

  const handleAddLink = (data: Omit<LinkItem, 'id' | 'createdAt'>) => {
    if (!authToken) { setIsAuthOpen(true); return; }
    const newLink: LinkItem = {
      ...data,
      id: Date.now().toString(),
      createdAt: Date.now()
    };
    updateData([newLink, ...links], categories);
    setPrefillLink(undefined);
  };

  const handleEditLink = (data: Omit<LinkItem, 'id' | 'createdAt'>) => {
    if (!authToken) { setIsAuthOpen(true); return; }
    if (!editingLink) return;
    const updated = links.map(l => l.id === editingLink.id ? { ...l, ...data } : l);
    updateData(updated, categories);
    setEditingLink(undefined);
  };

  const handleDeleteLink = (id: string) => {
    if (!authToken) { setIsAuthOpen(true); return; }
    if (confirm('确定删除此链接吗?')) {
      updateData(links.filter(l => l.id !== id), categories);
    }
  };

  const togglePin = (id: string) => {
      if (!authToken) { setIsAuthOpen(true); return; }
      const updated = links.map(l => l.id === id ? { ...l, pinned: !l.pinned } : l);
      updateData(updated, categories);
  };
  
  const handleCopyLink = (text: string) => {
      navigator.clipboard.writeText(text);
  };

  const handleSaveAIConfig = (config: AIConfig, newSiteSettings: SiteSettings) => {
      setAiConfig(config);
      persist(AI_CONFIG_KEY, config);
      setSiteSettings(newSiteSettings);
      persist(LOCAL_STORAGE_KEY, { links, categories, settings: newSiteSettings });
      // AI 配置也要进云端，否则手机/别的电脑上看不到（以前只写 localStorage）
      if (authToken) {
          syncToCloud(buildCloudPayload({ settings: newSiteSettings, aiConfig: config }), authToken);
      }
  };

  const scrollToCategory = (catId: string) => {
      setActiveCategory(catId);
      setSidebarOpen(false);
      
      if (catId === 'all') {
          isAutoScrollingRef.current = true;
          mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
          setTimeout(() => isAutoScrollingRef.current = false, 800);
          return;
      }
      const el = document.getElementById(`cat-${catId}`);
      if (el) {
          isAutoScrollingRef.current = true;
          // 手机顶栏是两行（标题 + 搜索），比桌面高一截，锚点偏移要跟着变，否则分类标题会被顶栏压住
          const stickyOffset = typeof window !== 'undefined' && window.innerWidth < 640 ? 122 : 80;
          const top = el.offsetTop - stickyOffset;
          mainRef.current?.scrollTo({ top, behavior: 'smooth' });
          setTimeout(() => isAutoScrollingRef.current = false, 800);
      }
  };

  const handleUnlockCategory = (catId: string) => {
      setUnlockedCategoryIds(prev => new Set(prev).add(catId));
  };

  const handleUpdateCategories = (newCats: Category[], newLinks?: LinkItem[]) => {
      if (!authToken) { setIsAuthOpen(true); return; }
      updateData(newLinks || links, newCats);
  };

  const handleDeleteCategory = (catId: string) => {
      if (!authToken) { setIsAuthOpen(true); return; }
      const newCats = categories.filter(c => c.id !== catId);
      const targetId = 'common'; 
      const newLinks = links.map(l => l.categoryId === catId ? { ...l, categoryId: targetId } : l);
      // 防护：分类被删空时补一个兜底分类（DEFAULT_CATEGORIES 若被清空也不能崩）
      if (newCats.length === 0) {
          newCats.push(DEFAULT_CATEGORIES[0] || { id: 'common', name: '常用推荐', icon: 'Star' });
      }
      updateData(newLinks, newCats);
  };

  const handleSaveWebDavConfig = (config: WebDavConfig) => {
      setWebDavConfig(config);
      persist(WEBDAV_CONFIG_KEY, config);
      // 同上：WebDAV 配置也要进云端，手机/别的电脑才看得到
      if (authToken) {
          syncToCloud(buildCloudPayload({ webdavConfig: config }), authToken);
      }
  };

  const handleRestoreBackup = (data: CloudData) => {
      const restoredLinks = asArray<LinkItem>(data?.links, []);
      const restoredCategories = asArray<Category>(data?.categories, DEFAULT_CATEGORIES);
      const restoredSettings = asPlainObject<SiteSettings>(data?.settings);
      // 先合并配置类数据（AI / DAV / 搜索引擎），拿到合并后的值再一次性写回云端，
      // 否则这次 updateData 推上去的还是旧配置。
      const cfg = applyRemoteConfig(data);
      updateData(
          restoredLinks,
          restoredCategories,
          restoredSettings ? { ...siteSettings, ...restoredSettings } : siteSettings,
          cfg
      );
      setIsBackupModalOpen(false);
  };
  
  // Updated Search Logic
  const handleSearchSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!searchQuery.trim()) return;
      
      if (searchMode === 'external') {
          const engine = externalEngines.find(e => e.id === activeEngineId) || externalEngines[0];
          if (engine) {
              window.open(engine.url + encodeURIComponent(searchQuery), '_blank');
              setSearchQuery('');
          }
      }
  };

  const handleUpdateSearchEngines = (newEngines: SearchEngine[]) => {
      setExternalEngines(newEngines);
      persist(SEARCH_ENGINES_KEY, newEngines);
      if (authToken) {
          syncToCloud(buildCloudPayload({ searchEngines: newEngines }), authToken);
      }
  };

  // 选中的引擎：本地记一份 + 推云端，否则手机上选完刷新又跳回第一个
  const handleSelectEngine = (engineId: string) => {
      setActiveEngineId(engineId);
      persist(SEARCH_ENGINE_ID_KEY, engineId);
      if (authToken) {
          syncToCloud(buildCloudPayload({ searchEngineId: engineId }), authToken);
      }
  };

  const isCategoryLocked = (catId: string) => {
      const cat = categories.find(c => c.id === catId);
      if (!cat || !cat.password) return false;
      return !unlockedCategoryIds.has(catId);
  };

  // --- 同分类内拖拽排序 ---
  // 仅在同一分类内部重排;拖到其他分类不生效(可通过编辑链接改分类)
  const handleDragStart = (e: React.DragEvent, linkId: string) => {
      setDragLinkId(linkId);
      e.dataTransfer.effectAllowed = 'move';
      // 兼容 Firefox:拖拽必须设置数据
      try { e.dataTransfer.setData('text/plain', linkId); } catch (err) {}
  };

  const handleDragOver = (e: React.DragEvent, linkId: string) => {
      e.preventDefault();      // 允许放置
      e.dataTransfer.dropEffect = 'move';
      // 记录当前悬停的卡片,用于视觉反馈
      if (dragOverLinkId !== linkId) setDragOverLinkId(linkId);
  };

  // 放到目标卡片上:把被拖的卡片移到目标卡片的位置(同分类内)
  const handleDrop = (e: React.DragEvent, targetLinkId: string) => {
      e.preventDefault();
      const sourceId = dragLinkId || e.dataTransfer.getData('text/plain');
      setDragLinkId(null);
      setDragOverLinkId(null);
      // 无来源或拖回原位:直接忽略
      if (!sourceId || sourceId === targetLinkId) return;
      // 未登录不能保存排序
      if (!authToken) { setIsAuthOpen(true); return; }
      
      const source = links.find(l => l.id === sourceId);
      const target = links.find(l => l.id === targetLinkId);
      // 必须同分类才能排序
      if (!source || !target || source.categoryId !== target.categoryId) return;

      const reordered = [...links];
      const fromIdx = reordered.findIndex(l => l.id === sourceId);
      const toIdx = reordered.findIndex(l => l.id === targetLinkId);
      reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, source);
      updateData(reordered, categories);
  };

  const handleDragEnd = () => {
      setDragLinkId(null);
      setDragOverLinkId(null);
  };

  const pinnedLinks = useMemo(() => {
      return links.filter(l => l.pinned && !isCategoryLocked(l.categoryId));
  }, [links, categories, unlockedCategoryIds]);

  const searchResults = useMemo(() => {
    // Only filter locally if mode is 'local'
    if (searchMode !== 'local') return links;

    let result = links;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l => 
        l.title.toLowerCase().includes(q) || 
        l.url.toLowerCase().includes(q) ||
        (l.description && l.description.toLowerCase().includes(q))
      );
    }
    return result;
  }, [links, searchQuery, searchMode]);

  const activeExternalEngine = useMemo(() => {
      return externalEngines.find(e => e.id === activeEngineId) || externalEngines[0];
  }, [externalEngines, activeEngineId]);

  // --- Render Components ---

  /** 卡片网格：手机（<640px）固定一行两个小卡片；sm 以上恢复原来的自适应多列 */
  const cardGridClass = siteSettings.cardStyle === 'simple'
      ? 'grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]'
      : 'grid grid-cols-2 gap-3 sm:gap-5 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]';

  /** 搜索栏。桌面端（desktop）塞在标题栏里；手机端（mobile）是标题栏下面的第二行 ——
   *  两者都在同一个 sticky 顶栏内，所以手机上滚动时搜索框一直可见。 */
  const renderSearchBar = (variant: 'desktop' | 'mobile') => {
      const isMobile = variant === 'mobile';

      const pillClass = (mode: 'local' | 'external') =>
          `font-medium rounded-full transition-all duration-200 ${isMobile ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'} ${
              searchMode === mode
                  ? (mode === 'external'
                      ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-md'
                      : 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-md')
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`;

      return (
        <div className={isMobile
            ? 'sm:hidden flex items-center gap-2 px-4 pb-3'
            : 'relative w-full max-w-xl hidden sm:flex items-center gap-3'}>
            {/* 站内 / 站外 切换 */}
            <div className="bg-slate-100/80 dark:bg-slate-700/70 p-1 rounded-full flex items-center shrink-0 shadow-inner">
                <button onClick={() => setSearchMode('local')} className={pillClass('local')}>站内</button>
                <button onClick={() => setSearchMode('external')} className={pillClass('external')}>站外</button>
            </div>

            {/* 搜索引擎管理（仅站外模式） */}
            {searchMode === 'external' && (
                <button
                    onClick={() => setIsSearchSettingsOpen(true)}
                    className={`${isMobile ? 'p-1.5' : 'p-2'} text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors shrink-0`}
                    title="管理搜索引擎"
                >
                    <Settings size={isMobile ? 16 : 18} />
                </button>
            )}

            {/* 搜索输入框 */}
            <form onSubmit={handleSearchSubmit} className="flex-1 min-w-0 relative flex items-center group">
                <input
                    ref={isMobile ? undefined : searchInputRef}
                    type="text"
                    placeholder={searchMode === 'local' ? "搜索书签..." : `在 ${activeExternalEngine?.name} 搜索...`}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={`w-full ${isMobile ? 'pl-9 pr-9 py-2' : 'pl-10 pr-4 py-2'} bg-white/70 dark:bg-slate-700/40 hover:bg-white dark:hover:bg-slate-700/70 border border-slate-200/70 dark:border-slate-600/40 rounded-full text-sm dark:text-white placeholder-slate-400 outline-none transition-all duration-200 focus:bg-white dark:focus:bg-slate-700/90 focus:ring-2 focus:ring-blue-500/40 focus:shadow-glow`}
                />
                <div className="absolute left-3 text-slate-400 pointer-events-none flex items-center gap-2">
                    {searchMode === 'local' ? (
                        <Search size={16} />
                    ) : activeExternalEngine?.icon?.startsWith('http') ? (
                        <img src={activeExternalEngine.icon} className="w-4 h-4 rounded-full object-cover" />
                    ) : (
                        <Search size={16} />
                    )}
                </div>

                {/* Visual Indicator for Search */}
                {searchQuery && (
                    <button type="submit" className="absolute right-2 p-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-600 rounded-full hover:bg-blue-200 transition-colors">
                        <ArrowRight size={14} />
                    </button>
                )}
            </form>
        </div>
      );
  };

  /** 打开卡片菜单（桌面右键 / 手机长按共用）。x、y 是触发点，越界时往回收，别让菜单跑出屏幕 */
  const openCardMenu = (x: number, y: number, link: LinkItem) => {
      if (x + 180 > window.innerWidth) x = Math.max(8, window.innerWidth - 190);
      if (y + 220 > window.innerHeight) y = Math.max(8, window.innerHeight - 230);
      setContextMenu({ x, y, link });
  };

  const cancelLongPress = () => {
      if (longPressTimer.current !== null) {
          window.clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
      }
  };

  /** 手机长按 = 右键：按住 500ms 且手指基本没动才算长按（动了就是在滚页面，取消） */
  const handleCardTouchStart = (e: React.TouchEvent, link: LinkItem) => {
      const t = e.touches[0];
      if (!t) return;
      longPressFired.current = false;
      longPressStart.current = { x: t.clientX, y: t.clientY };
      cancelLongPress();
      const { clientX, clientY } = t;
      longPressTimer.current = window.setTimeout(() => {
          longPressTimer.current = null;
          longPressFired.current = true;
          openCardMenu(clientX, clientY, link);
          // 安卓有一下轻震动做反馈；iOS Safari 没有 vibrate，跳过
          try { if (typeof navigator.vibrate === 'function') navigator.vibrate(15); } catch (err) {}
      }, 500);
  };

  const handleCardTouchMove = (e: React.TouchEvent) => {
      const start = longPressStart.current;
      const t = e.touches[0];
      if (!start || !t) return;
      // 手指挪动超过 10px 就当成滚动/拖拽，别弹菜单
      if (Math.abs(t.clientX - start.x) > 10 || Math.abs(t.clientY - start.y) > 10) cancelLongPress();
  };

  /** 松手：长按已经生效时吃掉这次 touchend —— 否则紧接着合成出来的 click 会把链接也打开 */
  const handleCardTouchEnd = (e: React.TouchEvent) => {
      cancelLongPress();
      longPressStart.current = null;
      if (longPressFired.current) e.preventDefault();
  };

  const renderLinkCard = (link: LinkItem) => {
      // 首字母永远垫在图片下面 ⇒ 图没回来/抓不到也不会是一片空白；
      // 起始地址跳过 faviconextractor / gstatic 这类又慢又常抓不到真图的第三方（老数据里有 40+ 条），
      // 直接走自己的图标代理（服务端抓 + 解析 <link rel=icon> + 边缘缓存 7 天）。
      const startSrc = getInitialIconSrc(link.url, link.icon);
      const iconDisplay = (
          <>
              <span aria-hidden="true" className="favicon-fallback-char select-none">{link.title.charAt(0)}</span>
              {startSrc && (
                 <img
                    src={startSrc}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 m-auto w-6 h-6 sm:w-7 sm:h-7 object-contain"
                    onLoad={(e) => handleIconLoad(e, link.title)}
                    onError={(e) => handleIconError(e, link.url, link.title)}
                 />
              )}
          </>
      );
      
      const isSimple = siteSettings.cardStyle === 'simple';

      return (
        <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            draggable={!isCoarsePointer}
            onDragStart={(e) => { cancelLongPress(); handleDragStart(e, link.id); }}
            onDragOver={(e) => handleDragOver(e, link.id)}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop(e, link.id); }}
            onDragEnd={handleDragEnd}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                // 安卓长按会另外触发 contextmenu：先把定时器撤掉，免得同一个菜单被开两次
                cancelLongPress();
                openCardMenu(e.clientX, e.clientY, link);
                return false;
            }}
            onTouchStart={(e) => handleCardTouchStart(e, link)}
            onTouchMove={handleCardTouchMove}
            onTouchEnd={handleCardTouchEnd}
            onTouchCancel={handleCardTouchEnd}
            onClick={(e) => {
                // 长按刚弹过菜单：这一次 click 是松手时合成的，别让它把链接打开
                if (longPressFired.current) {
                    e.preventDefault();
                    e.stopPropagation();
                    longPressFired.current = false;
                }
            }}
            className={`no-callout group relative flex flex-col ${isSimple ? 'p-2.5 sm:p-3' : 'p-3 sm:p-5'} bg-white/90 dark:bg-slate-800/90 rounded-2xl border border-slate-200/60 dark:border-slate-700/50 shadow-card card-lift fade-up ${dragLinkId === link.id ? 'opacity-50' : ''} ${dragOverLinkId === link.id && dragLinkId && dragLinkId !== link.id ? 'ring-2 ring-blue-400 border-blue-400' : ''}`}
            title={link.description || link.url}
        >
            {/* hover 渐变盖层（对齐老站 site-card::before） */}
            <div aria-hidden="true" className="absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
            <div className={`relative flex items-center gap-2 sm:gap-3 ${isSimple ? '' : 'mb-2'} pr-1 sm:pr-6`}>
                <div className={`relative ${isSimple ? 'w-7 h-7 text-xs sm:w-8 sm:h-8 sm:text-sm' : 'w-9 h-9 text-base sm:w-12 sm:h-12 sm:text-xl'} rounded-xl bg-gradient-to-br from-white to-blue-50 dark:from-slate-700 dark:to-slate-800 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold uppercase shrink-0 overflow-hidden ring-1 ring-slate-200/60 dark:ring-slate-600/50 transition-all duration-200 group-hover:scale-105`}>
                    {iconDisplay}
                </div>
                <h3 className="font-medium text-sm sm:text-base text-slate-800 dark:text-slate-200 truncate flex-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {link.title}
                </h3>
            </div>
            {!isSimple && (
                <div className="hidden sm:block text-sm text-slate-500 dark:text-slate-400 line-clamp-1 h-5 w-full overflow-hidden">
                    {link.description || <span className="opacity-0">.</span>}
                </div>
            )}
        </a>
      );
  };

  // 纯私有模式：未解锁（无访问密码）时只渲染解锁界面，不渲染任何导航内容
  if (!authToken) {
    return (
      <UnlockScreen
        onUnlocked={(pwd) => {
          setAuthToken(pwd);
          localStorage.setItem(AUTH_KEY, pwd);
          localStorage.setItem(AUTH_EXPIRY_KEY, String(Date.now() + AUTH_TTL_MS));
        }}
      />
    );
  }

  return (
    <div className="flex h-screen overflow-hidden text-slate-900 dark:text-slate-50 relative bg-slate-50 dark:bg-slate-900">
      {/* 背景光斑装饰 */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-40 -left-32 w-[520px] h-[520px] rounded-full bg-blue-400/15 dark:bg-blue-500/10 blur-3xl" />
        <div className="absolute top-1/4 -right-44 w-[560px] h-[560px] rounded-full bg-purple-400/12 dark:bg-purple-500/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-[460px] h-[340px] rounded-full bg-indigo-300/12 dark:bg-indigo-500/10 blur-3xl" />
      </div>
      
      {/* Right Click Context Menu */}
      {contextMenu && (
          <div 
             ref={contextMenuRef}
             className="fixed z-[9999] bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-100 dark:border-slate-600 w-44 py-2 flex flex-col animate-in fade-in zoom-in duration-100 overflow-hidden"
             style={{ top: contextMenu.y, left: contextMenu.x }}
             onClick={(e) => e.stopPropagation()}
             onContextMenu={(e) => e.preventDefault()}
          >
             <button onClick={() => { handleCopyLink(contextMenu.link!.url); setContextMenu(null); }} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors text-left">
                 <Copy size={16} className="text-slate-400"/> <span>复制链接</span>
             </button>
             <button onClick={() => { setQrCodeLink(contextMenu.link); setContextMenu(null); }} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors text-left">
                 <QrCode size={16} className="text-slate-400"/> <span>显示二维码</span>
             </button>
             <div className="h-px bg-slate-100 dark:bg-slate-700 my-1 mx-2"/>
             <button onClick={() => { if(!authToken) setIsAuthOpen(true); else { setEditingLink(contextMenu.link!); setIsModalOpen(true); setContextMenu(null); }}} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors text-left">
                 <Edit2 size={16} className="text-slate-400"/> <span>编辑链接</span>
             </button>
             <button onClick={() => { togglePin(contextMenu.link!.id); setContextMenu(null); }} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors text-left">
                 <Pin size={16} className={contextMenu.link!.pinned ? "fill-current text-blue-500" : "text-slate-400"}/> <span>{contextMenu.link!.pinned ? '取消置顶' : '置顶'}</span>
             </button>
             <div className="h-px bg-slate-100 dark:bg-slate-700 my-1 mx-2"/>
             <button onClick={() => { handleDeleteLink(contextMenu.link!.id); setContextMenu(null); }} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors text-left">
                 <Trash2 size={16}/> <span>删除链接</span>
             </button>
          </div>
      )}

      {/* QR Code Modal */}
      {qrCodeLink && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setQrCodeLink(null)}>
              <div className="bg-white p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4 animate-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
                  <h3 className="font-bold text-lg text-slate-800">{qrCodeLink.title}</h3>
                  <div className="p-2 border border-slate-200 rounded-lg">
                    <img 
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrCodeLink.url)}`} 
                        alt="QR Code" 
                        className="w-48 h-48"
                    />
                  </div>
                  <p className="text-xs text-slate-500 max-w-[200px] truncate">{qrCodeLink.url}</p>
              </div>
          </div>
      )}

      <AuthModal isOpen={isAuthOpen} onLogin={handleLogin} />
      
      <CategoryAuthModal 
        isOpen={!!catAuthModalData}
        category={catAuthModalData}
        onClose={() => setCatAuthModalData(null)}
        onUnlock={handleUnlockCategory}
      />

      <CategoryManagerModal 
        isOpen={isCatManagerOpen} 
        onClose={() => setIsCatManagerOpen(false)}
        categories={categories}
        links={links}
        onUpdateCategories={handleUpdateCategories}
        onDeleteCategory={handleDeleteCategory}
      />

      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        links={links}
        categories={categories}
        siteSettings={siteSettings}
        aiConfig={aiConfig}
        searchEngines={externalEngines}
        searchEngineId={activeEngineId}
        onRestore={handleRestoreBackup}
        webDavConfig={webDavConfig}
        onSaveWebDavConfig={handleSaveWebDavConfig}
      />

      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        existingLinks={links}
        categories={categories}
        aiConfig={aiConfig}
        onImport={handleImportConfirm}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        config={aiConfig}
        siteSettings={siteSettings}
        onSave={handleSaveAIConfig}
        links={links}
        categories={categories}
        onUpdateLinks={(newLinks) => updateData(newLinks, categories)}
      />

      <SearchSettingsModal
        isOpen={isSearchSettingsOpen}
        onClose={() => setIsSearchSettingsOpen(false)}
        engines={externalEngines}
        activeEngineId={activeEngineId}
        onUpdateEngines={handleUpdateSearchEngines}
        onSelectEngine={handleSelectEngine}
      />

      <DeadLinkCheckModal
        isOpen={isDeadLinkCheckOpen}
        onClose={() => setIsDeadLinkCheckOpen(false)}
        links={links}
        authToken={authToken}
        onDeleteLink={handleDeleteLink}
      />

      {/* Sidebar Mobile Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-20 bg-black/50 lg:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={`
          fixed lg:static inset-y-0 left-0 z-30 w-64 transform transition-transform duration-300 ease-in-out
          bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border-r border-slate-200/60 dark:border-slate-700/60 flex flex-col
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        <div className="h-16 flex items-center px-6 border-b border-slate-200/60 dark:border-slate-700/60 shrink-0 gap-3">
             <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-blue-500/30 overflow-hidden ring-1 ring-white/20">
                 {siteSettings.favicon ? (
                    <img src={siteSettings.favicon} alt="" className="w-full h-full object-cover" />
                 ) : (
                    "C"
                 )}
             </div>
            <span className="text-lg font-bold bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent truncate">
              {siteSettings.navTitle || DEFAULT_SITE_TITLE}
            </span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-1 scrollbar-hide">
            <button
              onClick={() => scrollToCategory('all')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                activeCategory === 'all' 
                  ? 'bg-gradient-to-r from-blue-500/12 to-indigo-500/8 dark:from-blue-500/15 dark:to-indigo-500/10 text-blue-600 dark:text-blue-400 font-medium shadow-sm ring-1 ring-blue-500/20' 
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100/80 dark:hover:bg-slate-700/60'
              }`}
            >
              <div className="p-1"><Icon name="LayoutGrid" size={18} /></div>
              <span>全部链接</span>
            </button>
            
            <div className="flex items-center justify-between pt-4 pb-2 px-4">
               <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">分类目录</span>
               <button 
                  onClick={() => { if(!authToken) setIsAuthOpen(true); else setIsCatManagerOpen(true); }}
                  className="p-1 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                  title="管理分类"
               >
                  <Settings size={14} />
               </button>
            </div>

            {categories.map(cat => {
                const isLocked = cat.password && !unlockedCategoryIds.has(cat.id);
                const isEmoji = cat.icon && cat.icon.length <= 4 && !/^[a-zA-Z]+$/.test(cat.icon);
                
                return (
                  <button
                    key={cat.id}
                    onClick={() => scrollToCategory(cat.id)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 group ${
                      activeCategory === cat.id 
                        ? 'bg-gradient-to-r from-blue-500/12 to-indigo-500/8 dark:from-blue-500/15 dark:to-indigo-500/10 text-blue-600 dark:text-blue-400 font-medium shadow-sm ring-1 ring-blue-500/20' 
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100/80 dark:hover:bg-slate-700/60'
                    }`}
                  >
                    <div className={`p-1.5 rounded-lg transition-all duration-200 flex items-center justify-center ${activeCategory === cat.id ? 'bg-gradient-to-br from-blue-500/15 to-indigo-500/15 dark:from-blue-500/25 dark:to-indigo-500/20 scale-105' : 'bg-slate-100/80 dark:bg-slate-800/80'}`}>
                      {isLocked ? <Lock size={16} className="text-amber-500" /> : (isEmoji ? <span className="text-base leading-none">{cat.icon}</span> : <Icon name={cat.icon} size={16} />)}
                    </div>
                    <span className="truncate flex-1 text-left">{cat.name}</span>
                    {activeCategory === cat.id && <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>}
                  </button>
                );
            })}
        </div>

        <div className="p-4 border-t border-slate-200/60 dark:border-slate-700/60 bg-white/40 dark:bg-slate-800/40 backdrop-blur-md shrink-0">
            <div className="grid grid-cols-4 gap-2 mb-2">
                <button 
                    onClick={() => { if(!authToken) setIsAuthOpen(true); else setIsImportModalOpen(true); }}
                    className="flex flex-col items-center justify-center gap-1 p-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-xl border border-slate-200/70 dark:border-slate-600/60 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-blue-300/60 dark:hover:border-blue-500/30"
                    title="导入书签"
                >
                    <Upload size={14} />
                    <span>导入</span>
                </button>
                <button 
                    onClick={() => { if(!authToken) setIsAuthOpen(true); else setIsBackupModalOpen(true); }}
                    className="flex flex-col items-center justify-center gap-1 p-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-xl border border-slate-200/70 dark:border-slate-600/60 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-blue-300/60 dark:hover:border-blue-500/30"
                    title="备份与恢复"
                >
                    <CloudCog size={14} />
                    <span>备份</span>
                </button>
                <button 
                    onClick={() => { if(!authToken) setIsAuthOpen(true); else setIsDeadLinkCheckOpen(true); }}
                    className="flex flex-col items-center justify-center gap-1 p-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-xl border border-slate-200/70 dark:border-slate-600/60 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-blue-300/60 dark:hover:border-blue-500/30"
                    title="死链检测"
                >
                    <Activity size={14} />
                    <span>检测</span>
                </button>
                <button 
                    onClick={() => setIsSettingsModalOpen(true)}
                    className="flex flex-col items-center justify-center gap-1 p-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-xl border border-slate-200/70 dark:border-slate-600/60 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-blue-300/60 dark:hover:border-blue-500/30"
                    title="AI 设置"
                >
                    <Settings size={14} />
                    <span>设置</span>
                </button>
            </div>
            
            <div className="flex items-center justify-between text-xs px-2 mt-2">
               <div className="flex items-center gap-1 text-slate-400">
                 {syncStatus === 'saving' && <Loader2 className="animate-spin w-3 h-3 text-blue-500" />}
                 {syncStatus === 'saved' && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                 {syncStatus === 'error' && <AlertCircle className="w-3 h-3 text-red-500" />}
                 {authToken ? <span className="text-green-600">已同步</span> : <span className="text-amber-500">离线</span>}
               </div>
               {/* 署名徽标：文案与链接由 utils/author.ts 解码得到（产物中无明文），
                   并被组件内的自愈逻辑保护 —— 见 components/AuthorBadge.tsx */}
               <AuthorBadge />
            </div>
        </div>
      </aside>

      <main 
          ref={mainRef}
          className="flex-1 flex flex-col h-full overflow-y-auto relative scroll-smooth"
      >
        <header className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-700/50 sticky top-0 z-30 shrink-0">
          <div className="h-16 px-4 lg:px-8 flex items-center justify-between">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 -ml-2 text-slate-600 dark:text-slate-300">
              <Menu size={24} />
            </button>

            {/* 搜索栏（桌面端）：手机端在下面单独一行，同属这个常驻顶栏 */}
            {renderSearchBar('desktop')}
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden md:flex bg-slate-100 dark:bg-slate-700 rounded-lg p-1 mr-2">
                <button 
                    onClick={() => authToken && updateData(links, categories, { ...siteSettings, cardStyle: 'simple' })}
                    title="简约模式"
                    className={`p-1.5 rounded transition-all ${siteSettings.cardStyle === 'simple' ? 'bg-white dark:bg-slate-600 shadow text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    <LayoutGrid size={16} />
                </button>
                <button 
                    onClick={() => authToken && updateData(links, categories, { ...siteSettings, cardStyle: 'detailed' })}
                    title="详情模式"
                    className={`p-1.5 rounded transition-all ${siteSettings.cardStyle === 'detailed' ? 'bg-white dark:bg-slate-600 shadow text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    <List size={16} />
                </button>
            </div>

            <button onClick={toggleTheme} className="p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {!authToken && (
                <button onClick={() => setIsAuthOpen(true)} className="hidden sm:flex items-center gap-2 bg-slate-200 dark:bg-slate-700 px-3 py-1.5 rounded-full text-xs font-medium">
                    <Cloud size={14} /> 登录
                </button>
            )}

            <button
              onClick={() => { if(!authToken) setIsAuthOpen(true); else { setEditingLink(undefined); setIsModalOpen(true); }}}
              className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-3 py-2 rounded-full text-sm font-medium shadow-lg shadow-blue-500/30 transition-all duration-200 hover:shadow-blue-500/40 hover:-translate-y-0.5 active:translate-y-0"
            >
              <Plus size={16} /> <span className="hidden sm:inline">添加</span>
            </button>
          </div>
          </div>

          {/* 搜索栏（手机端）：顶栏的第二行，和标题栏一起常驻，滚动时不消失 */}
          {renderSearchBar('mobile')}
        </header>

        <div className="p-3 sm:p-4 lg:p-8 space-y-6 sm:space-y-8">
            
            {pinnedLinks.length > 0 && !searchQuery && (
                <section>
                    <div className="flex items-center gap-2 mb-4">
                        <Pin size={16} className="text-blue-500 fill-blue-500" />
                        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            置顶 / 常用
                        </h2>
                    </div>
                    <div className={cardGridClass}>
                        {pinnedLinks.map(link => renderLinkCard(link))}
                    </div>
                </section>
            )}

            {categories.map(cat => {
                let catLinks = searchResults.filter(l => l.categoryId === cat.id);
                const isLocked = cat.password && !unlockedCategoryIds.has(cat.id);
                
                // Logic Fix: If External Search, do NOT hide categories based on links
                // Because external search doesn't filter links.
                // However, the user probably wants to see the links grid even when typing for external search
                // Current logic: if search query exists AND local search -> filter. 
                // If search query exists AND external search -> show all (searchResults returns all).
                
                if (searchQuery && searchMode === 'local' && catLinks.length === 0) return null;

                return (
                    <section key={cat.id} id={`cat-${cat.id}`} className="scroll-mt-24">
                        <div className="flex items-center gap-3 mb-4 pb-2 border-b border-slate-200/50 dark:border-slate-800">
                             <span className="cat-bar"></span>
                             <div className="text-slate-400">
                                {cat.icon && cat.icon.length <= 4 && !/^[a-zA-Z]+$/.test(cat.icon) ? <span className="text-lg">{cat.icon}</span> : <Icon name={cat.icon} size={20} />}
                             </div>
                             <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">
                                 {cat.name}
                             </h2>
                             {isLocked && <Lock size={16} className="text-amber-500" />}
                        </div>
                        
                        {isLocked ? (
                             <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 p-8 flex flex-col items-center justify-center text-center">
                                <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mb-4 text-amber-600 dark:text-amber-400">
                                    <Lock size={24} />
                                </div>
                                <h3 className="text-slate-800 dark:text-slate-200 font-medium mb-1">私密目录</h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">该分类已加密，需要验证密码才能查看内容</p>
                                <button 
                                    onClick={() => setCatAuthModalData(cat)}
                                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors"
                                >
                                    输入密码解锁
                                </button>
                             </div>
                        ) : (
                             <>
                                {catLinks.length === 0 ? (
                                    <div className="text-center py-8 text-slate-400 text-sm italic">
                                        暂无链接
                                    </div>
                                ) : (
                                    <div className={cardGridClass}>
                                        {catLinks.map(link => renderLinkCard(link))}
                                    </div>
                                )}
                             </>
                        )}
                    </section>
                );
            })}
            
            {/* Empty State for Local Search */}
            {searchQuery && searchMode === 'local' && searchResults.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                    <Search size={40} className="opacity-30 mb-4" />
                    <p>没有找到相关内容</p>
                    <button onClick={() => setIsModalOpen(true)} className="mt-4 text-blue-500 hover:underline">添加一个?</button>
                </div>
            )}

            <div className="h-20"></div>
        </div>
      </main>

      <LinkModal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setEditingLink(undefined); setPrefillLink(undefined); }}
        onSave={editingLink ? handleEditLink : handleAddLink}
        categories={categories}
        existingLinks={links}
        initialData={editingLink || (prefillLink as LinkItem)}
        aiConfig={aiConfig}
      />
    </div>
  );
}

export default App;
