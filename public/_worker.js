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

/** 校验访问密码；未配置 PASSWORD 时同样视为不通过 */
const authPass = (request, env) => {
  const expected = env.PASSWORD;
  if (!expected) return false;
  return request.headers.get('x-auth-password') === expected;
};

/* ----------------------------- /api/verify ----------------------------- */
/* 解锁界面用：body { password } → { success } */
async function apiVerify(request, env) {
  try {
    const body = await request.json();
    const ok = !!env.PASSWORD && body.password === env.PASSWORD;
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
      id: Date.now().toString(),
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
      a >= 224
    ) {
      return 'private/internal ip';
    }
  } else if (host === 'localhost' || host === '::1' || host === '0.0.0.0') {
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

    const authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`;

    let fetchUrl = baseUrl;
    let method = 'PROPFIND';
    const headers = { Authorization: authHeader, 'User-Agent': 'CloudNav/1.0' };
    let requestBody;

    if (operation === 'check') {
      fetchUrl = baseUrl;
      method = 'PROPFIND';
      headers['Depth'] = '0';
    } else if (operation === 'upload') {
      fetchUrl = fileUrl;
      method = 'PUT';
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(payload);
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
    return json({ success, status: response.status });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

/* -------------------------------- 路由 -------------------------------- */
export default {
  async fetch(request, env) {
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
