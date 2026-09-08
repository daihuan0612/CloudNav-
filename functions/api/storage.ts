interface Env {
  CLOUDNAV_KV: any;
  PASSWORD: string;
}

// 统一的响应头
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-password',
};

// 处理 OPTIONS 请求（解决跨域预检）
export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
};

// GET: 获取数据（需要访问密码，纯私有模式）
export const onRequestGet = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;

  const providedPassword = request.headers.get('x-auth-password');
  const serverPassword = env.PASSWORD;
  if (!serverPassword || providedPassword !== serverPassword) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    // 从 KV 中读取数据
    const data = await env.CLOUDNAV_KV.get('app_data');
    
    if (!data) {
      // 如果没有数据，返回空结构
      return new Response(JSON.stringify({ links: [], categories: [] }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response(data, {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500,
      headers: corsHeaders,
    });
  }
};

// POST: 保存数据
export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;

  // 1. 验证密码
  const providedPassword = request.headers.get('x-auth-password');
  const serverPassword = env.PASSWORD;

  if (!serverPassword) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: PASSWORD not set' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  if (providedPassword !== serverPassword) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // 2. 保存数据
  try {
    const body = await request.json();
    // 将数据写入 KV
    await env.CLOUDNAV_KV.put('app_data', JSON.stringify(body));

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to save data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};