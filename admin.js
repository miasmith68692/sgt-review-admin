/**
 * 审稿通 - 后台管理交互逻辑
 */

// ========== 状态管理 ==========
let authToken = null;
let allKeys = [];

// ========== DOM 引用 ==========
const $ = (id) => document.getElementById(id);

const loginPage = $('loginPage');
const adminPage = $('adminPage');
const loginUsername = $('loginUsername');
const loginPassword = $('loginPassword');
const loginBtn = $('loginBtn');
const loginError = $('loginError');
const logoutBtn = $('logoutBtn');
const logoutAllBtn = $('logoutAllBtn');
const sessionCount = $('sessionCount');
const adminUserDisplay = $('adminUserDisplay');

const genPlan = $('genPlan');
const genUid = $('genUid');
const genBtn = $('genBtn');
const genResult = $('genResult');
const resultPlan = $('resultPlan');
const resultUid = $('resultUid');
const resultExpire = $('resultExpire');
const resultKey = $('resultKey');
const copyKeyBtn = $('copyKeyBtn');

const searchInput = $('searchInput');
const statsSummary = $('statsSummary');
const keysBody = $('keysBody');
const keysTable = $('keysTable');

// ========== API 调用 ==========
const API_BASE = '';

async function apiCall(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = 'Bearer ' + authToken;
  }
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

// ========== 登录 ==========

loginBtn.addEventListener('click', handleLogin);
loginPassword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleLogin();
});

async function handleLogin() {
  const username = loginUsername.value.trim();
  const password = loginPassword.value.trim();
  if (!username || !password) {
    loginError.textContent = '请输入用户名和密码';
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = '登录中...';
  loginError.textContent = '';

  const result = await apiCall('POST', '/api/login', { username, password });

  loginBtn.disabled = false;
  loginBtn.textContent = '登 录';

  if (result.success) {
    authToken = result.token;
    adminUserDisplay.textContent = '管理员：' + username;
    loginPage.style.display = 'none';
    adminPage.style.display = 'flex';
    adminPage.style.flexDirection = 'column';
    loadKeys();
    updateSessionCount();
  } else {
    loginError.textContent = result.message || '登录失败';
  }
}

logoutBtn.addEventListener('click', async () => {
  await apiCall('POST', '/api/logout');
  authToken = null;
  adminPage.style.display = 'none';
  loginPage.style.display = 'flex';
  loginPassword.value = '';
  loginError.textContent = '';
});

// 登出所有设备
if (logoutAllBtn) {
  logoutAllBtn.addEventListener('click', async () => {
    if (!confirm('确定要登出所有登录设备吗？\n其他登录此账号的会话将被强制下线。')) return;
    const result = await apiCall('POST', '/api/logout-all');
    alert('已登出 ' + (result.count || 0) + ' 个会话');
    // 自己也被登出
    authToken = null;
    adminPage.style.display = 'none';
    loginPage.style.display = 'flex';
    loginPassword.value = '';
    loginError.textContent = '';
  });
}

// ========== 生成激活码 ==========

genBtn.addEventListener('click', handleGenerate);
genUid.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleGenerate();
});

async function handleGenerate() {
  const plan = genPlan.value;
  const uid = genUid.value.trim();

  if (!uid) {
    showGenError('请输入用户 ID');
    return;
  }

  genBtn.disabled = true;
  genBtn.textContent = '生成中...';

  const result = await apiCall('POST', '/api/genkey', { plan, uid });

  genBtn.disabled = false;
  genBtn.textContent = '生 成';

  if (result.success) {
    resultPlan.textContent = result.planName + ' (' + result.plan + ')';
    resultUid.textContent = result.uid;
    resultExpire.textContent = result.expireDate;
    resultKey.textContent = result.key;
    genResult.style.display = 'block';
    genUid.value = '';
    loadKeys(); // 刷新列表
  } else {
    showGenError(result.message || '生成失败');
  }
}

function showGenError(msg) {
  genResult.style.display = 'block';
  genResult.innerHTML = '<div class="result-label" style="color:#e74c3c;">❌ ' + msg + '</div>';
  setTimeout(() => { genResult.style.display = 'none'; }, 3000);
}

// 复制激活码
copyKeyBtn.addEventListener('click', () => {
  const key = resultKey.textContent;
  navigator.clipboard.writeText(key).then(() => {
    copyKeyBtn.textContent = '✅ 已复制';
    setTimeout(() => { copyKeyBtn.textContent = '📋 复制激活码'; }, 2000);
  }).catch(() => {
    // fallback
    const range = document.createRange();
    range.selectNodeContents(resultKey);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges();
    copyKeyBtn.textContent = '✅ 已复制';
    setTimeout(() => { copyKeyBtn.textContent = '📋 复制激活码'; }, 2000);
  });
});

// ========== 加载激活码列表 ==========

async function loadKeys() {
  const result = await apiCall('GET', '/api/keys');
  if (result.success) {
    allKeys = result.data;
    renderKeys();
  }
}

function renderKeys() {
  const keyword = searchInput.value.trim().toLowerCase();
  const filtered = keyword
    ? allKeys.filter(k => k.uid.toLowerCase().includes(keyword))
    : allKeys;

  // 统计
  const total = allKeys.length;
  const activated = allKeys.filter(k => k.status === 'activated').length;
  const unused = total - activated;
  statsSummary.textContent = `共 ${total} 条 · 已使用 ${activated} · 未使用 ${unused}`;

  if (filtered.length === 0) {
    keysBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#999;padding:40px;">暂无数据</td></tr>';
    return;
  }

  keysBody.innerHTML = filtered.map(k => {
    const statusClass = k.status === 'activated' ? 'status-activated' : 'status-unused';
    const statusText = k.status === 'activated' ? '已使用' : '未使用';
    const reportedTime = k.reported_at
      ? new Date(k.reported_at).toLocaleString('zh-CN', { hour12: false })
      : '—';
    const genTime = new Date(k.generated_at).toLocaleString('zh-CN', { hour12: false });
    return `<tr>
      <td>${k.id}</td>
      <td>${k.planName}</td>
      <td>${k.uid}</td>
      <td>${k.expire_date}</td>
      <td>${genTime}</td>
      <td><span class="status-badge ${statusClass}">${statusText}</span></td>
      <td>${reportedTime}</td>
      <td class="key-cell" title="${k.key_value}">${k.key_value}</td>
    </tr>`;
  }).join('');
}

// 搜索防抖
let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderKeys, 300);
});

// 定时刷新（每 30 秒）
setInterval(() => {
  if (authToken) {
    loadKeys();
    updateSessionCount();
  }
}, 30000);

// ========== 会话管理 ==========

async function updateSessionCount() {
  try {
    const result = await apiCall('GET', '/api/sessions');
    if (result.success && sessionCount) {
      sessionCount.textContent = result.activeSessions + ' 个活跃会话';
    }
  } catch (e) {
    // 静默失败
  }
}