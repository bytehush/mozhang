/* 错误收集钩子（V0.15.6 从 index.html 内联外置）：
   收集加载期与运行期未捕获错误（含堆栈）到 window.__errors，
   冒烟检查看它是否为空。必须作为第一个脚本加载。
   外置原因：server.js 现已加 CSP（script-src 'self'），内联脚本会被拦截。 */
window.__errors = [];
window.addEventListener('error', function (e) {
  window.__errors.push((e.message || '未知错误') + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno + '\n' + (e.error && e.error.stack ? e.error.stack.split('\n').slice(0, 4).join('\n') : ''));
});
