/**
 * 本地服务器：1) 提供网页文件  2) 转发 AI 请求到各模型厂商（OpenAI 兼容接口）
 * 启动方式：双击「启动记账APP.bat」，或命令行运行 node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');

const ROOT = __dirname;
const BASE_PORT = 8787;
const ZHIPU_API = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

// V0.15.6 安全响应头：nosniff 防嗅探；DENY 防点击劫持；
// CSP 禁内联脚本/外域脚本（XSS 纵深防御，诊断脚本已外置为 js/errhook.js）
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self' https: http:; font-src 'self'; " +
    "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
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

// ---------- 接口地址安全校验（仅允许公网 http/https） ----------
// V0.15.6 加固：URL.hostname 对 IPv6 保留中括号（如 [::ffff:127.0.0.1]），原实现对中括号
// 形态整段漏判。现统一剥离中括号/zone id 后展开为 8 组 hextet 判断，并识别
// IPv4 映射（::ffff:0:0/96）、IPv4 兼容（::/96）、NAT64（64:ff9b::/96）、
// 6to4（2002::/16）等内嵌 IPv4 的形态，还原成 IPv4 套用同一内网黑名单。
function ipv4Forbidden(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||          // 运营商级 NAT
    (a === 169 && b === 254) ||                    // 链路本地
    (a === 172 && b >= 16 && b <= 31) ||           // 私网
    (a === 192 && b === 168) ||                    // 私网
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||       // 基准测试段
    a >= 224;                                      // 组播/保留
}

// 把（可能含 :: 压缩的）IPv6 展开为 8 个数字 hextet；形态非法返回 null
function expandIPv6(addr) {
  if (!/^[\da-f:]+$/i.test(addr)) return null;
  let head = addr, tail = null;
  const dc = addr.indexOf('::');
  if (dc >= 0) {
    if (addr.indexOf('::', dc + 1) >= 0) return null;   // 只允许一处 ::
    head = addr.slice(0, dc);
    tail = addr.slice(dc + 2);
  }
  const toParts = s => (s === '' ? [] : s.split(':'));
  const headParts = toParts(head);
  const tailParts = tail == null ? [] : toParts(tail);
  const fill = 8 - headParts.length - tailParts.length;
  if (dc < 0 && headParts.length !== 8) return null;
  if (dc >= 0 && fill < 1) return null;                 // :: 至少压缩一个全零组
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
  // 未指定地址（::）与环回（::1）
  if (h.every(x => x === 0) || (h.slice(0, 7).every(x => x === 0) && h[7] === 1)) {
    throw new Error('不允许访问内网或保留地址');
  }
  // IPv4 映射（::ffff:0:0/96）还原成 IPv4 再判；IPv4 兼容（::/96）已弃用，一律拒绝
  if (h.slice(0, 5).every(x => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
    if (h[5] === 0) throw new Error('不允许访问内网或保留地址');
    if (ipv4Forbidden(v4of(h[6], h[7]))) throw new Error('不允许访问内网或保留地址');
    return;
  }
  // NAT64（64:ff9b::/96）与 6to4（2002::/16）内嵌 IPv4 同样还原再判
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every(x => x === 0)) {
    if (ipv4Forbidden(v4of(h[6], h[7]))) throw new Error('不允许访问内网或保留地址');
    return;
  }
  if (h[0] === 0x2002) {
    if (ipv4Forbidden(v4of(h[1], h[2]))) throw new Error('不允许访问内网或保留地址');
    return;
  }
  // 组播 ff00::/8、链路本地 fe80::/10、唯一本地 fc00::/7、Teredo 2001:0::/32
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
  // 客户端断开检测挂在「响应」的 close 上：req 的 close 在新版 Node 里
  // 请求体读完就会触发，会误中止上游请求，导致浏览器一直等不到回复
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
    // 浏览器中断（停止按钮/关页）时同步中止对厂商的请求
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
        // Agent 工具声明（Function Calling）：仅在客户端声明了工具时透传
        ...(Array.isArray(tools) && tools.length ? { tools } : {}),
      }),
    });

    // 厂商返回错误（通常是 JSON），无论是否要求流式都原样转发
    if (!resp.ok || !resp.body || (wantStream && !(resp.headers.get('content-type') || '').includes('event-stream'))) {
      // 有些厂商对 stream 请求也回 JSON；若拿到的是 SSE 就照流转发
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
      // SSE 流式透传：逐块转发，绝不缓冲
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
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
    if (!clientGone) sendJSON(res, 500, { error: { message: '本地服务转发失败：' + err.message } });
  }
}

function serveStatic(req, res) {
  let urlPath;
  // V0.15.6：decodeURIComponent 对畸形百分号序列（如 GET /%）会抛 URIError，
  // 原先未捕获会带崩整个进程（单个请求即远程 DoS）——现在回落为 400
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
  catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end('Bad Request');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  // 拒绝点开头的路径段（.git / .agents 等敏感目录与隐藏文件）
  if (urlPath.split(/[\\/]/).some(seg => seg.startsWith('.'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  const filePath = path.normalize(path.join(ROOT, urlPath));
  // 前缀比对带路径分隔符：否则同级同前缀目录（如「记录账单APP备份」）会被误放行
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
      res.end('404 Not Found: ' + urlPath);
      return;
    }
    res.writeHead(200, Object.assign({
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    }, SECURITY_HEADERS));
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/ai') {
    handleAI(req, res);
  } else if (req.method === 'GET') {
    serveStatic(req, res);
  } else {
    res.writeHead(405); res.end('Method Not Allowed');
  }
});

// 端口被占用时自动向后找 5 个
function listen(port, tries) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && tries > 0) {
      console.log(`端口 ${port} 被占用，改用 ${port + 1} ...`);
      listen(port + 1, tries - 1);
    } else {
      console.error('启动失败：', err.message);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log('==============================================');
    console.log('  墨账 · 多账本记账 已启动！');
    console.log(`  请用浏览器打开:  http://127.0.0.1:${port}`);
    console.log('  关闭窗口即可停止服务。数据保存在本机浏览器中。');
    console.log('  AI 支持智谱/DeepSeek/通义/Kimi/自定义厂商。');
    console.log('==============================================');
  });
}

listen(BASE_PORT, 5);
