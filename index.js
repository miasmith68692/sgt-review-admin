/**
 * 审稿通 - 后台管理服务器
 * Express 服务器：提供管理页面静态资源 + API 接口
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const db = require('./db');
const auth = require('./auth');

// ========== 配置（必须与 tools/generate-key.js 一致） ==========
const LICENSE_SECRET = 'sgt_review_secret_key_2026';
const PLAN_DAYS = {
  trial: 3, weekly: 7, halfmonth: 15, monthly: 30, quarterly: 90, halfyear: 180, yearly: 365
};
const PLAN_NAMES = {
  trial: '试用', weekly: '一周', halfmonth: '半月', monthly: '月度', quarterly: '季度', halfyear: '半年', yearly: '年度'
};
// =============================================================

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- 中间件 ----------
app.use(cors());
app.use(express.json());

// 静态文件：管理页面
app.use(express.static(path.join(__dirname)));

// ---------- 工具函数 ----------

function toBase64Url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateKey(plan, uid) {
  const exp = new Date();
  exp.setDate(exp.getDate() + PLAN_DAYS[plan]);
  const payloadObj = { plan, exp: exp.toISOString().slice(0, 10), uid, seed: Math.random().toString(36).substring(2, 8) };
  const payload = toBase64Url(JSON.stringify(payloadObj));
  const sig = crypto.createHmac('sha256', LICENSE_SECRET).update(payload)
    .digest('hex');
  return { key: payload + '.' + sig, payloadObj };
}

// ---------- 认证中间件 ----------

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!auth.verifyToken(token)) {
    return res.status(401).json({ success: false, message: '未登录或登录已过期' });
  }
  next();
}

// ---------- API 路由 ----------

// 管理员登录
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const result = auth.login(username, password, ip);
  if (result.success) {
    res.json({ success: true, token: result.token, message: '登录成功' });
  } else {
    const status = result.locked ? 429 : 401;
    res.status(status).json({ success: false, message: result.message });
  }
});

// 退出登录
app.post('/api/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  auth.logout(token);
  res.json({ success: true, message: '已退出登录' });
});

// 登出所有会话（一键踢下线）
app.post('/api/logout-all', requireAuth, (req, res) => {
  const count = auth.logoutAll();
  res.json({ success: true, message: '已登出全部会话', count });
});

// 获取活跃会话数
app.get('/api/sessions', requireAuth, (req, res) => {
  const count = auth.getActiveSessionCount();
  res.json({ success: true, activeSessions: count });
});

// 生成激活码（需认证）
app.post('/api/genkey', requireAuth, async (req, res) => {
  const { plan, uid } = req.body;

  if (!PLAN_DAYS[plan]) {
    return res.status(400).json({ success: false, message: '无效的套餐类型' });
  }
  if (!uid || uid.trim() === '') {
    return res.status(400).json({ success: false, message: '用户 ID 不能为空' });
  }

  const { key, payloadObj } = generateKey(plan, uid.trim());

  // 存入数据库
  await db.insertCode({
    plan,
    uid: uid.trim(),
    key_value: key,
    expire_date: payloadObj.exp
  });

  res.json({
    success: true,
    key,
    plan,
    planName: PLAN_NAMES[plan],
    uid: uid.trim(),
    expireDate: payloadObj.exp
  });
});

// 获取激活码列表（需认证）
app.get('/api/keys', requireAuth, async (req, res) => {
  const codes = await db.getAllCodes();
  // 给每个记录添加显示用的 planName
  const result = codes.map(c => ({
    ...c,
    planName: PLAN_NAMES[c.plan] || c.plan
  }));
  res.json({ success: true, data: result });
});

// 用户激活上报（无需认证）
app.post('/api/report', async (req, res) => {
  const { uid, plan, expiry, activatedAt } = req.body;
  if (!uid || !plan) {
    return res.status(400).json({ success: false, message: '参数不完整' });
  }

  const updated = await db.markReported(uid, plan);
  res.json({
    success: true,
    matched: updated,
    message: updated ? '上报成功' : '未找到匹配的未使用记录'
  });
});

// ---------- 启动服务器 ----------

(async () => {
  await db.initDatabase();

  app.listen(PORT, () => {
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('  审稿通 - 后台管理服务');
    console.log('═══════════════════════════════════════');
    console.log('  管理页面: http://localhost:' + PORT + '/admin.html');
    console.log('  API 接口: http://localhost:' + PORT + '/api');
    console.log('  默认账号: admin / admin123');
    console.log('  （请通过环境变量 ADMIN_USERNAME / ADMIN_PASSWORD 修改）');
    console.log('═══════════════════════════════════════');
    console.log('');
  });
})();