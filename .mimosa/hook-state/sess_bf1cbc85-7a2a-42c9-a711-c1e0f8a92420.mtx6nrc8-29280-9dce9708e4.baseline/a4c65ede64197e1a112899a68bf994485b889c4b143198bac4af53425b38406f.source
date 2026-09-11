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
function assertPublicIP(ip) {
  const v4 = net.isIPv4(ip) ? ip.split('.').map(Number) : null;
  if (v4) {
    const [a, b, c] = v4;
    const bad =
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||          // 运营商级 NAT
      (a === 169 && b === 254) ||                    // 链路本地
      (a === 172 && b >= 16 && b <= 31) ||           // 私网
      (a === 192 && b === 168) ||                    // 私网
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) ||       // 基准测试段
      a >= 224;                                      // 组播/保留
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
  // 客户端断开检测挂在「响应」的 close 上：req 的 close 在新版 Node 里
  // 请求体读完就会触发，会误中止上游请求，导致浏览器一直等不到回复
  let clientGone = false;
  res.on('close', () => { clientGone = true; });
  try {
    const { apiKey, model, messages, temperature, baseUrl, stream, maxTokens } = await readBody(req);
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
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + urlPath);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
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
