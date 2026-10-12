
export interface LinkItem {
  id: string;
  title: string;
  url: string;
  icon?: string;
  description?: string;
  categoryId: string;
  createdAt: number;
  pinned?: boolean; // New field for pinning
}

export interface Category {
  id: string;
  name: string;
  icon: string; // Lucide icon name or emoji
  password?: string; // Optional password for category protection
}

export interface SiteSettings {
  title: string;
  navTitle: string;
  favicon: string;
  cardStyle: 'detailed' | 'simple';
}

/** 站点默认名称 —— 唯一出处，全站所有兜底值都引用它，不再散落硬编码。
 *  这是中性占位名：部署者在「设置 → 网站设置」里改成自己的名字后，全站（含浏览器标签页、
 *  侧边栏、生成的浏览器插件）都会跟着变。 */
export const DEFAULT_SITE_TITLE = '我的导航';

/** 站点展示设置的本地缓存键：index.html 用它提前应用标题，避免解锁前显示默认名 */
export const SITE_SETTINGS_KEY = 'cloudnav_site_settings';

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  title: DEFAULT_SITE_TITLE,
  navTitle: DEFAULT_SITE_TITLE,
  favicon: '',
  cardStyle: 'detailed',
};

export interface AppState {
  links: LinkItem[];
  categories: Category[];
  darkMode: boolean;
  settings?: SiteSettings;
}

export interface WebDavConfig {
  url: string;
  username: string;
  password: string;
  enabled: boolean;
}

export type AIProvider = 'gemini' | 'openai';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'common', name: '常用推荐', icon: 'Star' },
  { id: 'dev', name: '开发工具', icon: 'Code' },
  { id: 'design', name: '设计资源', icon: 'Palette' },
  { id: 'read', name: '阅读资讯', icon: 'BookOpen' },
  { id: 'ent', name: '休闲娱乐', icon: 'Gamepad2' },
  { id: 'ai', name: '人工智能', icon: 'Bot' },
];

// 首次部署时为空：不预置任何示例书签，由部署者自行导入或添加。
export const INITIAL_LINKS: LinkItem[] = [];

export interface SearchEngine {
  id: string;
  name: string;
  url: string; // e.g., https://www.google.com/search?q=
  icon: string; // url or key
}

export const DEFAULT_SEARCH_ENGINES: SearchEngine[] = [
    { id: 'local', name: '站内', url: '', icon: 'Search' },
    { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=', icon: 'https://www.google.com/favicon.ico' },
    { id: 'bing', name: '必应', url: 'https://www.bing.com/search?q=', icon: 'https://www.bing.com/favicon.ico' },
    { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=', icon: 'https://www.baidu.com/favicon.ico' },
    { id: 'github', name: 'GitHub', url: 'https://github.com/search?q=', icon: 'https://github.com/favicon.ico' },
    { id: 'bilibili', name: 'B站', url: 'https://search.bilibili.com/all?keyword=', icon: 'https://www.bilibili.com/favicon.ico' },
];
