// 站点图标(favicon)工具：国内网络可用方案
// 1) 主：直抓站点根路径 /favicon.ico（与站点同网络可达，无需第三方）
// 2) 备：favicon.im（覆盖面广，302 自动跳转到 CDN 图片）

const normalizeUrl = (url: string): URL | null => {
  try {
    const u = url.trim();
    return new URL(u.startsWith('http') ? u : 'https://' + u);
  } catch {
    return null;
  }
};

/** 生成图标 URL（站点直出 favicon.ico） */
export const getFaviconUrl = (url: string): string => {
  const u = normalizeUrl(url);
  return u ? `https://${u.hostname}/favicon.ico` : '';
};

/** 图标加载失败的降级 URL（favicon.im 服务） */
export const getFaviconFallback = (url: string): string => {
  const u = normalizeUrl(url);
  return u ? `https://favicon.im/${u.hostname}` : '';
};

/**
 * 渲染 onError 降级链：
 *   第三方/老数据(gstatic等) → 站点直抓 /favicon.ico → favicon.im → 隐藏并显示占位首字母
 */
export const handleIconError = (e: React.SyntheticEvent<HTMLImageElement>, url: string, fallbackText?: string) => {
  const img = e.currentTarget;
  const src = img.getAttribute('src') || '';
  const u = normalizeUrl(url);
  if (!u) {
    img.style.display = 'none';
    return;
  }
  if (src.includes('favicon.im')) {
    // 已是最后一级，放弃
    img.style.display = 'none';
    if (fallbackText) {
      const parent = img.parentElement;
      if (parent && !parent.querySelector('.favicon-fallback-char')) {
        const span = document.createElement('span');
        span.className = 'favicon-fallback-char';
        span.style.cssText = 'font-weight:bold;font-size:inherit;';
        span.textContent = fallbackText.charAt(0).toUpperCase();
        parent.appendChild(span);
      }
    }
    return;
  }
  if (!src.endsWith('/favicon.ico')) {
    // 第三方/老数据 → 先换站点直抓
    img.src = `https://${u.hostname}/favicon.ico`;
    return;
  }
  // 站点直抓失败 → favicon.im
  img.src = `https://favicon.im/${u.hostname}`;
};
