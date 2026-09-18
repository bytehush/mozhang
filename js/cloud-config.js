/* 云端部署配置（V0.15.4 分享版引入）
   本地版：留空即可，AI 走 server.js 的 /api/ai；
   云端版：部署时把此文件替换为 { aiProxy: 'HTTP云函数转发地址' }，
   AI 军师改走云端转发，其余功能不变。 */
window.MOZHANG_CLOUD = null;
