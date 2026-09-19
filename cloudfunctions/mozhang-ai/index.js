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
// V0.15.6 加固（与 server.js 同一套逻辑）：URL.hostname 对 IPv6 保留中括号，
// 原实现对 [::ffff:127.0.0.1] 等形态整段漏判。现剥离中括号/zone id 后展开为
// 8 组 hextet 统一判断，并识别 IPv4 映射/兼容、NAT64、6to4 等内嵌 IPv4 的形态。
function ipv4Forbidden(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

function expandIPv6(addr) {
  if (!/^[\da-f:]+$/i.test(addr)) return null;
  let head = addr, tail = null;
  const dc = addr.indexOf('::');
  if (dc >= 0) {
    if (addr.indexOf('::', dc + 1) >= 0) return null;
    head = addr.slice(0, dc);
    tail = addr.slice(dc + 2);
  }
  const toParts = s => (s === '' ? [] : s.split(':'));
  const headParts = toParts(head);
  const tailParts = tail == null ? [] : toParts(tail);
  const fill = 8 - headParts.length - tailParts.length;
  if (dc < 0 && headParts.length !== 8) return null;
  if (dc >= 0 && fill < 1) return null;
  const parts = headParts.concat(dc >= 0 ? Array(fill).fill(0) : [], tailParts);
  if (parts.length !== 8) return null;
  return parts.map(s => parseInt(s, 16));
}

function assertPublicIP(rawIp) {
  let ip = String(rawIp).trim().toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  const zone = ip.indexOf('%');
  if (zone >= 0) ip = ip.slice(0, zone);
  if (net.isIPv4(ip)) {
    if (ipv4Forbidden(ip)) throw new Error('不允许访问内网或保留地址');
    return;
  }
  const h = expandIPv6(ip);
  if (!h) throw new Error('不允许访问内网或保留地址');
  const v4of = (hi, lo) => `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  if (h.every(x => x === 0) || (h.slice(0, 7).every(x => x === 0) && h[7] === 1)) {
    throw new Error('不允许访问内网或保留地址');
  }
  if (h.slice(0, 5).every(x => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
    if (h[5] === 0) throw new Error('不允许访问内网或保留地址');
    if (ipv4Forbidden(v4of(h[6], h[7]))) throw new Error('不允许访问内网或保留地址');
    return;
  }
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every(x => x === 0)) {
    if (ipv4Forbidden(v4of(h[6], h[7]))) throw new Error('不允许访问内网或保留地址');
    return;
  }
  if (h[0] === 0x2002) {
    if (ipv4Forbidden(v4of(h[1], h[2]))) throw new Error('不允许访问内网或保留地址');
    return;
  }
  const top16 = h[0];
  if ((top16 >> 8) === 0xff ||
      (top16 & 0xffc0) === 0xfe80 ||
      (top16 & 0xfe00) === 0xfc00 ||
      (top16 === 0x2001 && h[1] === 0)) {
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
  // 关键：先剥掉 IPv6 中括号再判断，否则 net.isIP 对 "[::1]" 失效、字符串比对也对不上
  const bareHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (net.isIP(bareHost)) {
    assertPublicIP(bareHost);
    return u;
  }
  const addrs = await dns.lookup(bareHost, { all: true });
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
