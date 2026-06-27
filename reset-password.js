/**
 * 审稿通 - 管理员密码重置工具
 *
 * 用法：
 *   node server/reset-password.js                    # 交互式输入新密码
 *   node server/reset-password.js <新密码>            # 直接指定新密码
 *
 * 会把密码哈希保存到 server/config.json，重启服务器后生效
 */

const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const configPath = path.join(__dirname, 'config.json');

function saveConfig(adminPasswordHash) {
  let config = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  config.adminPasswordHash = adminPasswordHash;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log('✅ 密码已重置，重启服务器后生效');
  console.log('   配置文件: ' + configPath);
}

async function main() {
  let newPassword = process.argv[2];

  if (!newPassword) {
    // 交互式输入
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });

    newPassword = await new Promise((resolve) => {
      rl.question('请输入新密码: ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  if (!newPassword || newPassword.length < 6) {
    console.error('❌ 密码至少 6 位字符');
    process.exit(1);
  }

  // 生成 bcrypt 哈希
  const hash = bcrypt.hashSync(newPassword, 10);
  saveConfig(hash);
  process.exit(0);
}

main();