/**
 * 审稿通 - 后台认证模块（安全增强版）
 *
 * 功能：
 *   1. bcrypt 加密密码
 *   2. 登录限频（IP 级别，5 次失败锁定 10 分钟）
 *   3. 支持 config.json 持久化配置（通过 reset-password.js 设置）
 *   4. 环境变量 ADMIN_USERNAME / ADMIN_PASSWORD 覆盖
 *   5. Token 过期 + 一键登出所有会话
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ========== 配置 ==========

const TOKEN_EXPIRE_MS = 24 * 60 * 60 * 1000;  // 24 小时

// 登录限频：每个 IP 最多失败次数
const MAX_FAIL_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 10;
const LOCKOUT_MS = LOCKOUT_MINUTES * 60 * 1000;

// ========== 读取密码配置（优先级：config.json > 环境变量 > 默认值） ==========

function loadAdminConfig() {
  const configPath = path.join(__dirname, 'config.json');
  const config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    : {};

  const username = process.env.ADMIN_USERNAME || config.adminUsername || 'admin';
  const passwordHash = config.adminPasswordHash
    || bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);

  return { username, passwordHash };
}

// ========== 状态 ==========

const adminConfig = loadAdminConfig();
const validTokens = new Map();         // token → { username, expiresAt, createdAt }
const failedAttempts = new Map();      // ip → { count, lastAttemptAt }

// ========== 登录限频 ==========

function checkRateLimit(ip) {
  const now = Date.now();
  const record = failedAttempts.get(ip);

  if (!record) return true; // 无记录，放行

  // 锁定时间已过，重置
  if (now - record.lastAttemptAt > LOCKOUT_MS) {
    failedAttempts.delete(ip);
    return true;
  }

  if (record.count >= MAX_FAIL_ATTEMPTS) {
    const remainingSeconds = Math.ceil((LOCKOUT_MS - (now - record.lastAttemptAt)) / 1000);
    const remainingMinutes = Math.ceil(remainingSeconds / 60);
    return { locked: true, remainingSeconds, remainingMinutes };
  }

  return true;
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = failedAttempts.get(ip) || { count: 0, lastAttemptAt: now };

  // 如果距离上次失败已超过锁定时间，重置计数
  if (now - record.lastAttemptAt > LOCKOUT_MS) {
    record.count = 0;
  }

  record.count += 1;
  record.lastAttemptAt = now;
  failedAttempts.set(ip, record);
}

function clearFailedAttempts(ip) {
  failedAttempts.delete(ip);
}

// ========== 登录 ==========

function login(username, password, ip) {
  // 1. 限频检查
  const rateCheck = checkRateLimit(ip);
  if (rateCheck && rateCheck.locked) {
    return {
      success: false,
      message: `登录频繁，请 ${rateCheck.remainingMinutes} 分钟后再试`,
      locked: true,
      remainingSeconds: rateCheck.remainingSeconds
    };
  }

  // 2. 验证用户名
  if (username !== adminConfig.username) {
    recordFailedAttempt(ip);
    return { success: false, message: '用户名或密码错误' };
  }

  // 3. 验证密码
  if (!bcrypt.compareSync(password, adminConfig.passwordHash)) {
    recordFailedAttempt(ip);
    return { success: false, message: '用户名或密码错误' };
  }

  // 4. 登录成功，清除失败记录
  clearFailedAttempts(ip);

  // 5. 生成 token
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  validTokens.set(token, {
    username,
    expiresAt: now + TOKEN_EXPIRE_MS,
    createdAt: now
  });

  return { success: true, token, message: '登录成功' };
}

// ========== Token 验证 ==========

function verifyToken(token) {
  if (!token || !validTokens.has(token)) {
    return false;
  }

  const session = validTokens.get(token);
  if (Date.now() > session.expiresAt) {
    validTokens.delete(token);
    return false;
  }

  return true;
}

// ========== 登出 ==========

function logout(token) {
  if (token && validTokens.has(token)) {
    validTokens.delete(token);
  }
}

// ========== 登出所有会话（一键踢下线） ==========

function logoutAll() {
  const count = validTokens.size;
  validTokens.clear();
  return count;
}

// ========== 获取活跃会话数 ==========

function getActiveSessionCount() {
  // 清理过期会话
  const now = Date.now();
  for (const [token, session] of validTokens.entries()) {
    if (now > session.expiresAt) {
      validTokens.delete(token);
    }
  }
  return validTokens.size;
}

module.exports = {
  login,
  verifyToken,
  logout,
  logoutAll,
  getActiveSessionCount,
  loadAdminConfig    // 导出以便外部使用
};