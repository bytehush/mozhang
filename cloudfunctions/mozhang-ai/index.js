/**
 * 墨账 · 云端 AI 转发（HTTP 云函数，监听 9000 端口）
 * 职责：网页部署到云端托管后，替代本地 server.js 的 /api/ai 转发。
 *  - 接收浏览器 POST {apiKey, model, messages, baseUrl, stream, temperature, maxTokens, tools}
 *  - 校验目标为公网 http/https（SSRF 防护，与 server.js 同一套逻辑）
 *  - SSE 流式透传（与本地版一致）
 *  - 全程带 CORS 头（托管域名与函数域名不同源）
 * 不存储任何数据；apiKey 只在单次请求中透传。
 */
const http = require('http');
const dns = require('dns').promises;
const net = require('net');

const PORT = 9000;
const ZHIPU_API = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }, CORS_HEADERS));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2 * 1024 * 1024) reject(new Error('请求体过大'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('JSON 格式错误')); }
    });
    req.on('error', reject);
  });
}

// ---------- 接口地址安全校验（仅允许公网 http/https，防内网探测） ----------
function assertPublicIP(ip) {
  const v4 = net.isIPv4(ip) ? ip.split('.').map(Number) : null;
  if (v4) {
    const [a, b, c] = v4;
    const bad =
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224;
    if (bad) throw new Error('不允许访问内网或保留地址');
    return;
  }
  const s = String(ip).toLowerCase();
  if (s === '::' || s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80')) {
    throw new Error('不允许访问内网或保留地址');
  }
}

async function assertPublicHttpURL(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('接口地址格式不正确'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('接口地址仅允许 http/https');
  const host = u.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('不允许的接口地址');
  }
  if (net.isIP(host)) {
    assertPublicIP(host);
    return u;
  }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs || !addrs.length) throw new Error('接口地址无法解析');
  addrs.forEach(a => assertPublicIP(a.address));
  return u;
}

async function handleAI(req, res) {
  let clientGone = false;
  res.on('close', () => { clientGone = true; });
  try {
    const { apiKey, model, messages, temperature, baseUrl, stream, maxTokens, tools } = await readBody(req);
    if (!apiKey) return sendJSON(res, 400, { error: { message: '缺少 API Key，请先到「设置 → 模型设置」填写' } });
    if (!messages || !Array.isArray(messages)) return sendJSON(res, 400, { error: { message: '参数错误：messages 缺失' } });

    const target = (baseUrl && String(baseUrl).trim()) || ZHIPU_API;
    let urlObj;
    try {
      urlObj = await assertPublicHttpURL(target);
    } catch (e) {
      return sendJSON(res, 400, { error: { message: '接口地址被拒绝：' + e.message } });
    }

    const wantStream = stream === true;
    const controller = new AbortController();
    res.on('close', () => { if (clientGone && !res.writableEnded) controller.abort(); });

    const resp = await fetch(urlObj, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'glm-4-flash',
        messages,
        temperature: typeof temperature === 'number' ? temperature : 0.7,
        max_tokens: typeof maxTokens === 'number' ? Math.min(Math.max(maxTokens, 256), 32768) : 3072,
        stream: wantStream,
        ...(Array.isArray(tools) && tools.length ? { tools } : {}),
      }),
    });

    if (!resp.ok || !resp.body || (wantStream && !(resp.headers.get('content-type') || '').includes('event-stream'))) {
      const ctype = resp.headers.get('content-type') || '';
      if (resp.ok && resp.body && ctype.includes('event-stream')) {
        // 落到下面的流式转发
      } else {
        const text = await resp.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { error: { message: text.slice(0, 500) } }; }
        sendJSON(res, resp.status, data);
        return;
      }
    }

    if (wantStream && (resp.headers.get('content-type') || '').includes('event-stream')) {
      res.writeHead(200, Object.assign({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      }, CORS_HEADERS));
      try {
        for await (const chunk of resp.body) {
          if (clientGone) break;
          res.write(chunk);
        }
      } catch (e) { /* 上游或客户端中断，静默收尾 */ }
      try { res.end(); } catch { /* 忽略 */ }
      return;
    }

    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: { message: text.slice(0, 500) } }; }
    sendJSON(res, resp.status, data);
  } catch (err) {
    if (!clientGone) sendJSON(res, 500, { error: { message: '云端转发失败：' + err.message } });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  const pathname = (req.url || '/').split('?')[0];
  if (req.method === 'POST' && (pathname === '/' || pathname === '/api/ai')) {
    handleAI(req, res);
  } else if (req.method === 'GET') {
    sendJSON(res, 200, { ok: true, service: 'mozhang-ai' });
  } else {
    res.writeHead(405, CORS_HEADERS);
    res.end('Method Not Allowed');
  }
});

server.listen(PORT, () => {
  console.log('mozhang-ai 已启动，监听端口 ' + PORT);
});
