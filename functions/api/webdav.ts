
// WebDAV 备份代理（需访问密码鉴权，与其他端点一致）
export const onRequestPost = async (context: { request: Request; env: { PASSWORD: string } }) => {
  const { request, env } = context;

  // 鉴权：无密码拒绝（防未授权使用代理与探测）
  const providedPassword = request.headers.get('x-auth-password');
  const serverPassword = env.PASSWORD;
  if (!serverPassword || providedPassword !== serverPassword) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as any;
    const { operation, config, payload } = body;
    
    if (!config || !config.url || !config.username || !config.password) {
        return new Response(JSON.stringify({ error: 'Missing configuration' }), { status: 400 });
    }

    // 1. URL 处理：确保目录以 / 结尾
    let baseUrl = config.url.trim();
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    
    // 文件名固定
    const filename = 'cloudnav_backup.json';
    const fileUrl = baseUrl + filename;

    // 2. 构建认证 Header (Cloudflare Worker 环境支持 btoa)
    const authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`;
    
    let fetchUrl = baseUrl;
    let method = 'PROPFIND';
    let headers: Record<string, string> = {
        'Authorization': authHeader,
        'User-Agent': 'CloudNav/1.0'
    };
    let requestBody = undefined;

    // 3. 根据操作类型构建请求
    if (operation === 'check') {
        // PROPFIND 检查连接
        fetchUrl = baseUrl;
        method = 'PROPFIND';
        headers['Depth'] = '0'; // 仅检查根目录存在性
    } else if (operation === 'upload') {
        // PUT 上传文件
        fetchUrl = fileUrl;
        method = 'PUT';
        headers['Content-Type'] = 'application/json';
        requestBody = JSON.stringify(payload); 
    } else if (operation === 'download') {
        // GET 下载文件
        fetchUrl = fileUrl;
        method = 'GET';
    } else {
        return new Response(JSON.stringify({ error: 'Invalid operation' }), { status: 400 });
    }

    // 4. 发起服务器端请求 (无 CORS 限制)
    const response = await fetch(fetchUrl, {
        method,
        headers,
        body: requestBody
    });

    // 5. 处理响应
    
    // 下载操作特殊处理
    if (operation === 'download') {
        if (!response.ok) {
             // 如果文件不存在 (404)，返回特定的错误信息
             if (response.status === 404) {
                 return new Response(JSON.stringify({ error: 'Backup file not found' }), { status: 404 });
             }
             return new Response(JSON.stringify({ error: `WebDAV Error: ${response.status}` }), { status: response.status });
        }
        const data = await response.json();
        return new Response(JSON.stringify(data), { 
            headers: { 'Content-Type': 'application/json' } 
        });
    }

    // 检查和上传操作：判断状态码
    // WebDAV 成功状态码通常为 200, 201(Created), 204(No Content), 207(Multi-Status)
    const success = response.ok || response.status === 207;
    
    return new Response(JSON.stringify({ success, status: response.status }), { 
        headers: { 'Content-Type': 'application/json' } 
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
