
// Dead-link check endpoint (overseas probe via Cloudflare Worker edge)
// POST /api/check  body: { "urls": ["https://...", ...] }  (max 50 per call)
// Returns per-URL: { url, ok, status, ms, error }
interface Env {
  CLOUDNAV_KV: any;
  PASSWORD: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-password',
  'Access-Control-Max-Age': '86400',
};

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};

const TIMEOUT_MS = 8000;

// 拒绝探测内网/回环/链路本地地址（SSRF 基础防护）
function isBlockedUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return 'invalid url';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'protocol not allowed';
  }
  const host = url.hostname.toLowerCase();
  // 字面量 IP：拒绝私有/回环/链路本地/保留段
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const parts = host.split('.').map(Number);
    const a = parts[0];
    if (
      a === 0 || a === 10 || a === 127 ||
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

async function probe(url: string) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
    // Free the connection without downloading the body
    try {
      await res.body?.cancel();
    } catch (e) {}
    return { ok: true, status: res.status, ms: Date.now() - started, error: '' };
  } catch (err: any) {
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

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;

  // Auth check (same as other endpoints)
  const providedPassword = request.headers.get('x-auth-password');
  const serverPassword = env.PASSWORD;
  if (!serverPassword || providedPassword !== serverPassword) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const body = (await request.json()) as { urls?: string[] };
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

    return new Response(JSON.stringify({ success: true, data: results }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};
