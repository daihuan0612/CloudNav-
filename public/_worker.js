/**
 * CloudNav —— Cloudflare Pages「高级模式」(Advanced Mode) 入口
 *
 * 为什么用 _worker.js 而不是 functions/ 目录？
 *   官方文档：拖拽部署（Dashboard Drag and drop）不支持编译 functions 文件夹，
 *   但 _worker.js 同时支持 Wrangler 部署和拖拽部署。
 *   因此本文件让项目可以「打包成 zip 直接拖进 Cloudflare」上线。
 *
 * 注意：
 *   1. 只要输出目录里存在 _worker.js，Pages 就会忽略整个 /functions 目录。
 *      （仓库里保留 functions/ 仅为旧部署方式兜底，实际生效的是本文件。）
 *   2. 高级模式下本 Worker 接管全部请求，非 /api/ 的请求必须转交给静态资源，
 *      否则整站会白屏 —— 因此最后一行是 env.ASSETS.fetch(request)。
 *   3. 本文件必须是纯 JavaScript（Pages 不会编译 _worker.ts），且使用 Module Worker 语法。
 *
 * 依赖的绑定（在 Cloudflare 项目设置里配置）：
 *   - KV 命名空间绑定，变量名必须为 CLOUDNAV_KV
 *   - 环境变量（建议加密）PASSWORD，值为站点访问密码
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-password',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

const preflight = () => new Response(null, { status: 204, headers: CORS });

const unauthorized = () => json({ error: 'Unauthorized' }, 401);

/** 恒定时间比较：不要用 === 逐字符比密码（长度/前缀会被时序侧信道探出来） */
const safeEqual = (a, b) => {
  const x = String(a == null ? '' : a);
  const y = String(b == null ? '' : b);
  // 任何一边是空串都不算通过（空密码 / 少传请求头一律拒绝）
  if (!x || !y) return false;
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
};

/** 校验访问密码；未配置 PASSWORD 时同样视为不通过 */
const authPass = (request, env) => {
  const expected = env.PASSWORD;
  if (!expected) return false;
  return safeEqual(request.headers.get('x-auth-password'), expected);
};

/* ----------------------------- /api/verify ----------------------------- */
/* 解锁界面用：body { password } → { success } */
async function apiVerify(request, env) {
  try {
    const body = await request.json();
    const ok = !!env.PASSWORD && safeEqual(body.password, env.PASSWORD);
    return json({ success: ok }, ok ? 200 : 401);
  } catch (err) {
    return json({ error: 'Bad request' }, 400);
  }
}

/* ----------------------------- /api/storage ---------------------------- */
/* GET：读取全站数据（需鉴权） */
async function storageGet(request, env) {
  if (!authPass(request, env)) return unauthorized();
  try {
    const data = await env.CLOUDNAV_KV.get('app_data');
    if (!data) return json({ links: [], categories: [] });
    return new Response(data, {
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  } catch (err) {
    return json({ error: 'Failed to fetch data' }, 500);
  }
}

/* POST：保存全站数据（需鉴权） */
async function storagePost(request, env) {
  if (!env.PASSWORD) {
    return json({ error: 'Server misconfigured: PASSWORD not set' }, 500);
  }
  if (!authPass(request, env)) return unauthorized();
  try {
    const body = await request.json();
    await env.CLOUDNAV_KV.put('app_data', JSON.stringify(body));
    return json({ success: true });
  } catch (err) {
    return json({ error: 'Failed to save data' }, 500);
  }
}

/* ------------------------------ /api/link ------------------------------ */
/* 浏览器插件「一键保存」用：body { title, url, description?, icon?, categoryId? } */
async function linkPost(request, env) {
  if (!authPass(request, env)) return unauthorized();
  try {
    const newLinkData = await request.json();

    if (!newLinkData.title || !newLinkData.url) {
      return json({ error: 'Missing title or url' }, 400);
    }

    const currentDataStr = await env.CLOUDNAV_KV.get('app_data');
    let currentData = { links: [], categories: [] };
    if (currentDataStr) currentData = JSON.parse(currentDataStr);
    // KV 里的数据被手改过 / 是很老的格式：这里必须自己兜住，
    // 否则下面的 .find 会直接抛异常，插件那边只看到 500
    if (!currentData || typeof currentData !== 'object' || Array.isArray(currentData)) currentData = {};
    if (!Array.isArray(currentData.links)) currentData.links = [];
    if (!Array.isArray(currentData.categories)) currentData.categories = [];

    let targetCatId = '';
    let targetCatName = '';

    // 1) 优先使用调用方指定的分类
    if (newLinkData.categoryId) {
      const explicitCat = currentData.categories.find((c) => c.id === newLinkData.categoryId);
      if (explicitCat) {
        targetCatId = explicitCat.id;
        targetCatName = explicitCat.name;
      }
    }

    // 2) 否则自动挑选（收集/未分类/inbox… → common → 第一个分类）
    if (!targetCatId) {
      if (currentData.categories && currentData.categories.length > 0) {
        const keywords = ['收集', '未分类', 'inbox', 'temp', 'later'];
        const match = currentData.categories.find((c) =>
          keywords.some((k) => c.name.toLowerCase().includes(k))
        );

        if (match) {
          targetCatId = match.id;
          targetCatName = match.name;
        } else {
          const common = currentData.categories.find((c) => c.id === 'common');
          if (common) {
            targetCatId = 'common';
            targetCatName = common.name;
          } else {
            targetCatId = currentData.categories[0].id;
            targetCatName = currentData.categories[0].name;
          }
        }
      } else {
        targetCatId = 'common';
        targetCatName = '默认';
      }
    }

    const newLink = {
      // 同一毫秒连存两条（右键连点、脚本批量）时，纯时间戳 id 会撞车 → 优先用 randomUUID
      id: (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
        ? globalThis.crypto.randomUUID()
        : Date.now().toString(),
      title: newLinkData.title,
      url: newLinkData.url,
      description: newLinkData.description || '',
      categoryId: targetCatId,
      createdAt: Date.now(),
      pinned: false,
      icon: newLinkData.icon || undefined,
    };

    currentData.links = [newLink, ...(currentData.links || [])];
    await env.CLOUDNAV_KV.put('app_data', JSON.stringify(currentData));

    return json({ success: true, link: newLink, categoryName: targetCatName });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

/* ------------------------------ /api/check ----------------------------- */
/* 死链检测：body { urls: [...] }（单次最多 50 条），返回每条探测结果 */
const PROBE_TIMEOUT_MS = 8000;

/** 拒绝内网/回环/链路本地地址（SSRF 基础防护） */
function isBlockedUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return 'invalid url';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'protocol not allowed';
  }
  const host = url.hostname.toLowerCase();

  // IPv6：URL 解析出来的 hostname 是带方括号的（'[::1]'），以前拿它跟 '::1' 比永远不相等，
  // 于是 http://[::1]/ 这类地址能绕过内网拦截。这里先剥括号再判断。
  if (host.startsWith('[') || host.includes(':')) {
    const v6 = host.replace(/^\[/, '').replace(/\]$/, '');
    if (v6 === '::1' || v6 === '::' || v6 === '0:0:0:0:0:0:0:1') return 'local host';
    if (/^f[cd][0-9a-f]{2}:/.test(v6)) return 'private/internal ip';   // fc00::/7 ULA
    if (/^fe[89ab][0-9a-f]:/.test(v6)) return 'link-local ip';         // fe80::/10
    // IPv4-mapped：::ffff:127.0.0.1 或 ::ffff:7f00:1
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedUrl(`http://${mapped[1]}/`);
    const mappedHex = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      return isBlockedUrl(`http://${[hi >> 8, hi & 255, lo >> 8, lo & 255].join('.')}/`);
    }
    return '';
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const parts = host.split('.').map(Number);
    const a = parts[0];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && parts[1] === 254) ||
      (a === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (a === 192 && parts[1] === 168) ||
      (a === 100 && parts[1] >= 64 && parts[1] <= 127) ||   // 100.64/10 运营商级 NAT
      (a === 198 && (parts[1] === 18 || parts[1] === 19)) || // 198.18/15 基准测试网段
      a >= 224
    ) {
      return 'private/internal ip';
    }
  } else if (host === 'localhost' || host === '0.0.0.0') {
    return 'local host';
  }
  return '';
}

async function probe(url) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: '*/*',
      },
    });
    // 不下载响应体，直接释放连接
    try {
      await res.body?.cancel();
    } catch (e) {}
    return { ok: true, status: res.status, ms: Date.now() - started, error: '' };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: String(err?.name || err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkPost(request, env) {
  if (!authPass(request, env)) return unauthorized();
  try {
    const body = await request.json();
    const urls = (body.urls || []).slice(0, 50);

    const results = await Promise.all(
      urls.map(async (url) => {
        const block = isBlockedUrl(url);
        if (block) {
          return { url, ok: false, status: 0, ms: 0, error: 'blocked: ' + block };
        }
        return { url, ...(await probe(url)) };
      })
    );

    return json({ success: true, data: results });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

/* ----------------------------- /api/webdav ----------------------------- */
/* WebDAV 备份代理（需鉴权）：body { operation, config, payload } */

/** Basic 认证头：btoa 只吃 Latin-1，用户名/密码里只要有一个中文（或 emoji）就直接抛异常，
 *  以前整个请求会 500，前端只看到一句"上传失败"。这里先按 UTF-8 转成字节再 base64。 */
const base64Utf8 = (text) => {
  const bytes = new TextEncoder().encode(String(text == null ? '' : text));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};

async function webdavPost(request, env) {
  if (!authPass(request, env)) return unauthorized();
  try {
    const body = await request.json();
    const { operation, config, payload } = body;

    if (!config || !config.url || !config.username || !config.password) {
      return json({ error: 'Missing configuration' }, 400);
    }

    // 目录必须以 / 结尾；文件名固定
    let baseUrl = config.url.trim();
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    const fileUrl = baseUrl + 'cloudnav_backup.json';

    const authHeader = `Basic ${base64Utf8(`${config.username}:${config.password}`)}`;

    let fetchUrl = baseUrl;
    let method = 'PROPFIND';
    const headers = { Authorization: authHeader, 'User-Agent': 'CloudNav/1.0' };
    let requestBody;
    let replacedOld = false; // 上传时是否真的覆盖掉了旧备份（给前端/排查用）
    let deletedStatus = null; // 覆盖时那次 DELETE 的返回码（排查用：204=真删掉了）
    let oldBackupText = null; // 删旧文件前先留一份原文，PUT 失败时用来回滚
    let rollbackStatus = null; // 回滚那次 PUT 的返回码（排查用）
    let rollbackOk = false; // 回滚是否成功

    if (operation === 'check') {
      fetchUrl = baseUrl;
      method = 'PROPFIND';
      headers['Depth'] = '0';
    } else if (operation === 'upload') {
      // ⚠️ 图床（CloudFlare-ImgBed 等）的 WebDAV 是**简化实现：PUT 不做覆盖** ——
      //    它把内容转手给普通上传接口，同名文件会被自动改名成 cloudnav_backup(1).json、(2).json…
      //    （图床 functions/upload/uploadTools.js 的 buildUniqueFileId 里那段 counter 逻辑）。
      //    不删旧文件的话，图库里会越堆越多；而"恢复"读的是固定名，永远只能读到**最早**那一份。
      // ⇒ 上传前先探测、存在就先删，再 PUT，保证永远只有一个 cloudnav_backup.json（且是最新的）。
      const probe = await fetch(fileUrl, { method: 'PROPFIND', headers: { ...headers, Depth: '0' } });
      const existed = probe.status === 207;
      if (probe.body) await probe.body.cancel().catch(() => {});
      if (existed) {
        // 先留一份旧备份原文：DELETE 成功、PUT 失败的话，唯一的站外备份就没了
        // （图床 PUT 不做覆盖，所以不能"先传新的再删旧的"，只能"取旧 → 删 → 传新的 → 失败则写回旧的"）。
        try {
          const oldRes = await fetch(fileUrl, { method: 'GET', headers });
          if (oldRes.ok) oldBackupText = await oldRes.text();
          else if (oldRes.body) await oldRes.body.cancel().catch(() => {});
        } catch (e) {
          // 取不到就算了：至少不让上传因为"读不到旧文件"而失败
          oldBackupText = null;
        }
        const del = await fetch(fileUrl, { method: 'DELETE', headers });
        if (del.body) await del.body.cancel().catch(() => {});
        deletedStatus = del.status;
        if (!del.ok && del.status !== 404) {
          // 删不掉就别传：否则又会多出一份 (N)，而恢复读的还是旧的那一份 —— 静默出错更糟
          return json(
            {
              error: `删除旧备份失败（HTTP ${del.status}），已中止上传：否则会再生成一份 cloudnav_backup(N).json，而"恢复"仍会读到旧文件`,
              success: false,
              status: del.status,
            },
            502
          );
        }
      }
      fetchUrl = fileUrl;
      method = 'PUT';
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(payload);
      replacedOld = existed;
    } else if (operation === 'download') {
      fetchUrl = fileUrl;
      method = 'GET';
    } else {
      return json({ error: 'Invalid operation' }, 400);
    }

    // 服务端发起请求，不受浏览器 CORS 限制
    const response = await fetch(fetchUrl, { method, headers, body: requestBody });

    if (operation === 'download') {
      if (!response.ok) {
        if (response.status === 404) {
          return json({ error: 'Backup file not found' }, 404);
        }
        return json({ error: `WebDAV Error: ${response.status}` }, response.status);
      }
      const data = await response.json();
      return json(data);
    }

    // WebDAV 成功码：200 / 201 / 204 / 207
    const success = response.ok || response.status === 207;

    // 上传失败、而旧备份已经被删掉 ⇒ 立刻把旧内容写回去。
    // 否则"唯一的站外备份"就没了，而前端只会显示一句"上传失败"。
    if (!success && operation === 'upload' && replacedOld && oldBackupText) {
      if (response.body) await response.body.cancel().catch(() => {});
      try {
        const rb = await fetch(fileUrl, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: oldBackupText,
        });
        rollbackStatus = rb.status;
        rollbackOk = rb.ok || rb.status === 207;
        if (rb.body) await rb.body.cancel().catch(() => {});
      } catch (e) {
        rollbackOk = false;
      }
    }

    return json({
      success,
      status: response.status,
      ...(operation === 'upload' ? { replacedOld, deletedStatus, rollbackStatus, rollbackOk } : {}),
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

/* ------------------------------ /api/icon ------------------------------ */
/* 卡片图标代理（公开，故意不鉴权 —— <img src> 带不了自定义请求头）：
 *   GET /api/icon?host=example.com
 *   ① 先试 https://<host>/favicon.ico
 *   ② 不是图片 / 太大就抓首页 HTML，解析 <link rel="...icon..." href="...">：
 *      同域优先、apple-touch/mask 靠后、声明尺寸小的优先；跨域也接受（很多站图标在 CDN 上），
 *      但目标地址同样过一遍 isBlockedUrl，避免被当内网探测/任意图床代理。
 *   ③ 最多试 3 个候选、总预算 15 秒；挑到 ≤200KB 的就停，否则用见过的最小一张
 *   ④ 都不行 → 404（前端自己显示首字母）
 * 结果写进 Cloudflare 边缘缓存 7 天，同时给浏览器 Cache-Control 7 天。
 *
 * 为什么需要它（2026-10-13 实测）：
 *   · 第三方图标服务又慢又常常抓不到真图：favicon.im 1~3.2 秒、faviconextractor 3.4~10.3 秒且有的 404、
 *     gstatic 在国内直接连不上（10.7 秒后彻底失败）；浏览器每域名只允许 6 个并发 ⇒ 136 张图要排队几分钟。
 *   · 用户自己那批站把图标放在 /icon.png、/pwa.png、/favicon.svg，而 /favicon.ico 是 404 或返回 HTML
 *     ⇒ 只有"服务端解析 HTML"才拿得到真图（Cloudflare 的出口也不受墙影响）。
 */
const ICON_PAGE_TIMEOUT_MS = 6000;   // 抓首页 HTML
const ICON_FETCH_TIMEOUT_MS = 10000; // 抓图标本体（实测 xpg.de5.net/favicon.svg 600KB 要 8 秒）
const ICON_TOTAL_BUDGET_MS = 15000;  // 整个接口的总预算
const ICON_MAX_BYTES = 2 * 1024 * 1024; // 2MB 兜底（实测有站把 /pwa.png 做成 649KB）
const ICON_NICE_BYTES = 200 * 1024;     // 优先挑小于这个的：卡片只显示 24~48px，别为它下 600KB
const ICON_MAX_TRIES = 3;
const ICON_CACHE_SECONDS = 7 * 24 * 3600;
const ICON_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const isImageResponse = (res) =>
  !!res && res.status === 200 && (res.headers.get('content-type') || '').toLowerCase().startsWith('image/');

async function fetchIconUrl(url, timeoutMs, accept, cacheTtl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': ICON_UA, Accept: accept },
      // 让 Cloudflare 边缘也缓存上游响应（跨域同样有效）—— 与 Cache API 互为保险
      cf: { cacheEverything: true, cacheTtl: cacheTtl || 3600 },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** 抓一张图并校验（必须是图片、不超上限）；不合格返回 null */
async function fetchImage(url, timeoutMs) {
  try {
    const r = await fetchIconUrl(url, timeoutMs, 'image/*,*/*;q=0.8', ICON_CACHE_SECONDS);
    if (!isImageResponse(r)) {
      if (r.body) await r.body.cancel().catch(() => {});
      return null;
    }
    const buf = await r.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > ICON_MAX_BYTES) return null;
    return { buf, type: r.headers.get('content-type') || 'image/x-icon' };
  } catch (e) {
    return null;
  }
}

/** 首页 HTML 里所有 <link rel="...icon..."> → 绝对 URL；同域优先、apple-touch/mask 靠后、声明尺寸小的优先 */
function collectDeclaredIcons(html, baseUrl, host) {
  const found = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = (tag.match(/\brel\s*=\s*["']([^"']*)["']/i) || tag.match(/\brel\s*=\s*([^\s>]+)/i) || [])[1] || '';
    if (!/icon/i.test(rel)) continue;
    const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    let abs;
    try {
      abs = new URL(href, baseUrl);
    } catch (e) {
      continue;
    }
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
    if (isBlockedUrl(abs.toString())) continue;
    const sizes = (tag.match(/\bsizes\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    found.push({
      url: abs.toString(),
      sameHost: abs.hostname.toLowerCase() === host ? 0 : 1,
      touch: /apple-touch|mask-icon/i.test(rel) ? 1 : 0,
      px: parseInt((sizes.match(/(\d+)/) || [])[1] || '0', 10) || 999,
    });
  }
  found.sort((a, b) => a.sameHost - b.sameHost || a.touch - b.touch || a.px - b.px);
  return [...new Set(found.map((f) => f.url))];
}

async function apiIcon(request, env, ctx) {
  const rawHost = (new URL(request.url).searchParams.get('host') || '').trim().toLowerCase();
  // 只接受纯主机名（不要协议/路径/端口/IP），并复用 /api/check 那套内网拦截
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(rawHost)) {
    return json({ error: 'Bad host' }, 400);
  }
  const blocked = isBlockedUrl(`https://${rawHost}/`);
  if (blocked) return json({ error: 'blocked: ' + blocked }, 400);

  let cache = null;
  try {
    cache = caches.default;
  } catch (e) {}
  // ⚠️ 缓存键必须是本站 zone 的 URL：用假域名（icon-cache.invalid）Cache API 会静默不生效
  const cacheKey = new Request(new URL(`/api/icon?host=${encodeURIComponent(rawHost)}`, request.url).toString(), {
    method: 'GET',
  });
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const h = new Response(hit.body, hit);
        h.headers.set('X-Icon-Cache', 'hit');
        return h;
      }
    } catch (e) {}
  }

  const deadline = Date.now() + ICON_TOTAL_BUDGET_MS;

  // 候选顺序：/favicon.ico 快路径 → 首页里声明的图标（同域、小尺寸优先）
  const candidates = [`https://${rawHost}/favicon.ico`];

  // ① 快路径：/favicon.ico 本身是图片就直接用
  let best = await fetchImage(candidates[0], ICON_FETCH_TIMEOUT_MS);

  // ② 不够理想（没有 / 不是图片 / 太大）→ 抓首页 HTML 解析声明的图标
  if (!best || best.buf.byteLength > ICON_NICE_BYTES) {
    try {
      const page = await fetchIconUrl(
        `https://${rawHost}/`,
        ICON_PAGE_TIMEOUT_MS,
        'text/html,application/xhtml+xml,*/*;q=0.8',
        86400
      );
      if (page.status === 200) {
        const html = (await page.text()).slice(0, 300000);
        candidates.push(...collectDeclaredIcons(html, `https://${rawHost}/`, rawHost));
      } else if (page.body) {
        await page.body.cancel().catch(() => {});
      }
    } catch (e) {}
  }

  // ③ 依次试候选，挑到"够小"的就停；否则保留见过的最小一张
  let tries = best ? 1 : 0;
  for (const candidate of candidates.slice(1)) {
    if (tries >= ICON_MAX_TRIES || Date.now() > deadline) break;
    tries++;
    const got = await fetchImage(candidate, ICON_FETCH_TIMEOUT_MS);
    if (!got) continue;
    if (!best || got.buf.byteLength < best.buf.byteLength) best = got;
    if (best.buf.byteLength <= ICON_NICE_BYTES) break;
  }

  if (!best) {
    // 负缓存：130 个域名里有 29 个站真的没有图标，不缓存的话每次打开都要白试一遍
    // （每个约 2 秒，还占着浏览器每域名 6 个并发的额度）。存 1 天，比正缓存的 7 天短。
    const neg = new Response(JSON.stringify({ error: 'No icon' }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
        'X-Icon-Cache': cache ? 'miss' : 'off',
        ...CORS,
      },
    });
    if (cache) {
      try {
        ctx.waitUntil(cache.put(cacheKey, neg.clone()));
      } catch (e) {}
    }
    return neg;
  }

  const out = new Response(best.buf, {
    headers: {
      'Content-Type': best.type,
      'Cache-Control': `public, max-age=${ICON_CACHE_SECONDS}, immutable`,
      'X-Icon-Cache': cache ? 'miss' : 'off',
      ...CORS,
    },
  });
  if (cache) {
    try {
      ctx.waitUntil(cache.put(cacheKey, out.clone()));
    } catch (e) {}
  }
  return out;
}

/* -------------------------------- 路由 -------------------------------- */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // 兼容尾部斜杠：/api/storage/ 等价于 /api/storage
    const path =
      url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;

    if (path.startsWith('/api/')) {
      if (request.method === 'OPTIONS') return preflight();

      switch (path) {
        case '/api/verify':
          if (request.method === 'POST') return apiVerify(request, env);
          break;

        case '/api/storage':
          if (request.method === 'GET') return storageGet(request, env);
          if (request.method === 'POST') return storagePost(request, env);
          break;

        case '/api/link':
          if (request.method === 'POST') return linkPost(request, env);
          break;

        case '/api/check':
          if (request.method === 'POST') return checkPost(request, env);
          break;

        case '/api/icon':
          if (request.method === 'GET') return apiIcon(request, env, ctx);
          break;

        case '/api/webdav':
          if (request.method === 'POST') return webdavPost(request, env);
          break;

        default:
          return json({ error: 'Not found' }, 404);
      }

      return json({ error: 'Method not allowed' }, 405);
    }

    // 其余全部交给 Pages 静态资源（必须保留，否则整站白屏）
    return env.ASSETS.fetch(request);
  },
};
