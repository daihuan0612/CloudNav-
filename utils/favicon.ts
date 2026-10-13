// 站点图标(favicon)工具 —— 国内网络可用，且尽量拿到"真图标"
//
// 降级链（按顺序，任何一跳失败/不是图片就换下一跳）：
//   ① 数据里存的 icon（data: 内嵌图 / 用户自己填的图 —— 直接可用）
//   ② 自己的 worker 图标代理 /api/icon?host=xxx
//      —— 服务端先试 /favicon.ico，不是图片就抓首页 HTML 解析 <link rel="icon">，
//         拿到真图标（用户自己那批站把图标放在 /icon.png、/pwa.png、/favicon.svg，
//         而 /favicon.ico 是 404 或返回 HTML，只有服务端解析才拿得到），
//         并且结果进 Cloudflare 边缘缓存 7 天 —— 这就是"没变化就用缓存"。
//   ③ 站点直抓 https://<host>/favicon.ico
//   ④ favicon.im 第三方兜底
//   ⑤ 老数据里的第三方地址（faviconextractor / gstatic）放最后兜一下
//   ⑥ 全失败 → 隐藏图片，露出卡片自带的"首字母"占位
//
// 为什么不再把第三方放前面（2026-10-13 实测）：favicon.im 1~3.2 秒、
// faviconextractor 3.4~10.3 秒且有的直接 404、gstatic 在国内连不上（10.7 秒失败）；
// 再叠加浏览器每域名 6 个并发，136 张图要排队好几分钟，表现就是"图标几乎都看不到"。

const normalizeUrl = (url: string): URL | null => {
  try {
    const u = (url || '').trim();
    return new URL(u.startsWith('http') ? u : 'https://' + u);
  } catch {
    return null;
  }
};

const hostOf = (url: string): string => {
  const u = normalizeUrl(url);
  return u ? u.hostname : '';
};

/** 第三方图标服务：慢/被墙，不作为首选（老数据里有 40+ 条这种） */
const THIRD_PARTY_ICON_HOSTS = [
  'faviconextractor.com',
  'favicon.im',
  'gstatic.com',
  'google.com',
  'googleapis.com',
];

export const isThirdPartyIcon = (src: string): boolean => {
  if (!src || src.startsWith('data:')) return false;
  try {
    const h = new URL(src, 'https://placeholder.invalid').hostname.toLowerCase();
    return THIRD_PARTY_ICON_HOSTS.some((d) => h === d || h.endsWith('.' + d));
  } catch {
    return false;
  }
};

/** 自己的图标代理地址（服务端抓 + 解析真图标 + 边缘缓存 7 天） */
export const getIconProxyUrl = (url: string): string => {
  const h = hostOf(url);
  return h ? `/api/icon?host=${encodeURIComponent(h)}` : '';
};

/** 生成图标 URL（站点直出 favicon.ico）—— 新增链接时"猜图标"用 */
export const getFaviconUrl = (url: string): string => {
  const h = hostOf(url);
  return h ? `https://${h}/favicon.ico` : '';
};

/**
 * 统一的"起始图标地址"：
 *   · data: 内嵌图 / 用户自己填的图（非第三方、不是本站 /favicon.ico）→ 直接用；
 *   · 第三方图标服务（faviconextractor、gstatic…慢或被墙）→ 换成自己的代理；
 *   · 站点自己的 /favicon.ico → 也换成代理：代理做的是同一件事，但会解析 <link rel=icon>
 *     拿到真图、还带 7 天边缘缓存（实测用户自己那批站 /favicon.ico 多半是 404 或返回 HTML，
 *     先试它等于白跑一趟）。
 */
export const getInitialIconSrc = (linkUrl: string, storedIcon?: string): string => {
  const stored = storedIcon || '';
  const host = hostOf(linkUrl);
  const isPlainFaviconIco = (() => {
    if (!stored || stored.startsWith('data:') || !host) return false;
    try {
      const u = new URL(stored, 'https://placeholder.invalid');
      return u.hostname === host && /\/favicon\.ico$/i.test(u.pathname);
    } catch {
      return false;
    }
  })();
  if (stored.startsWith('data:')) return stored;
  if (stored && !isThirdPartyIcon(stored) && !isPlainFaviconIco) return stored;
  return getIconProxyUrl(linkUrl) || stored;
};

/** 存的值之后的降级链（handleIconError 就按这个顺序走） */
const chainFor = (host: string): string[] => [
  `/api/icon?host=${encodeURIComponent(host)}`,
  `https://${host}/favicon.ico`,
  `https://favicon.im/${host}`,
];

/** 把 src 和候选地址都转成绝对 URL 再比（src 可能是 /api/icon?... 这种相对路径） */
const sameUrl = (a: string, b: string): boolean => {
  try {
    const base = typeof location !== 'undefined' ? location.origin : 'https://placeholder.invalid';
    return new URL(a, base).href === new URL(b, base).href;
  } catch {
    return a === b;
  }
};

/** 走到最后一跳了：藏掉图片，露出首字母 */
const showFallbackChar = (img: HTMLImageElement, fallbackText?: string) => {
  img.style.display = 'none';
  if (!fallbackText) return;
  const parent = img.parentElement;
  if (parent && !parent.querySelector('.favicon-fallback-char')) {
    const span = document.createElement('span');
    span.className = 'favicon-fallback-char';
    span.style.cssText = 'font-weight:bold;font-size:inherit;';
    span.textContent = fallbackText.charAt(0).toUpperCase();
    parent.appendChild(span);
  }
};

/**
 * <img onLoad> 处理器：favicon.im 抓不到真图时会返回它自家的**通用占位图**（固定 150×150），
 * 那还不如显示卡片自己的首字母 ⇒ 认出这种占位就当"没图标"处理。
 * （实测 2026-10-13：真图是 192×192 / 512×512 / 1024×1024 这类，占位一律 150×150。）
 */
export const handleIconLoad = (e: { currentTarget: HTMLImageElement }, fallbackText?: string) => {
  const img = e.currentTarget;
  const src = img.getAttribute('src') || '';
  if (src.includes('favicon.im/') && img.naturalWidth === 150 && img.naturalHeight === 150) {
    showFallbackChar(img, fallbackText);
  }
};

/**
 * <img onError> 处理器：按降级链往下走，走完就露出首字母。
 * 入参用结构化类型（不写 React.SyntheticEvent），避免 .ts 文件里引用 React 命名空间报 TS2503。
 */
export const handleIconError = (
  e: { currentTarget: HTMLImageElement },
  url: string,
  fallbackText?: string
) => {
  const img = e.currentTarget;
  const src = img.getAttribute('src') || '';
  const host = hostOf(url);
  if (!host) {
    showFallbackChar(img, fallbackText);
    return;
  }

  const chain = chainFor(host);
  const at = chain.findIndex((c) => sameUrl(c, src));
  const next = at === -1 ? chain[0] : chain[at + 1];

  if (next) {
    img.src = next;
    return;
  }
  showFallbackChar(img, fallbackText);
};
