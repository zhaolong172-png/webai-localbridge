const http = require('http');
const fs = require('fs');
const path = require('path');

function api(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: '127.0.0.1',
      port: 33004,
      path: p,
      method: method,
      headers: data ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      } : {}
    };
    const req = http.request(options, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch { resolve(b); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const configPath = path.join(process.env.APPDATA || 'C:/Users/ZhaoQianlong', '..', 'WorkBuddy', '2026-06-07-00-13-22', 'mcp-tunnel', 'mcp-tunnel-config.json');
  console.log('使用配置文件:', configPath);
  // 实际上直接用已知路径
  const realConfigPath = 'C:/Users/ZhaoQianlong/WorkBuddy/2026-06-07-00-13-22/mcp-tunnel/mcp-tunnel-config.json';

  // 1. 先读原始状态
  let config = JSON.parse(fs.readFileSync(realConfigPath, 'utf8'));
  console.log('=== 原始状态 ===');
  console.log('  rootBoundaryMode =', config.rootBoundaryMode);
  console.log('  commandExecution =', config.commandExecution);
  console.log('  fileFastConfirm =', config.fileFastConfirm);

  // 2. 设成 Case D（三个都开启）
  console.log('\n=== 设成 Case D（三个都开启）===');
  await api('POST', '/api/set-root-boundary-mode', { mode: 'cross-root' });
  await api('POST', '/api/set-file-fast-confirm', { enabled: true });
  await api('POST', '/api/set-command-execution', { enabled: true });
  await new Promise(r => setTimeout(r, 1000));
  let s = await api('GET', '/api/status');
  console.log('  API状态: rootBoundaryMode=' + s.rootBoundaryMode + ', fileFastConfirm=' + s.fileFastConfirm + ', commandExecution=' + s.commandExecution);
  config = JSON.parse(fs.readFileSync(realConfigPath, 'utf8'));
  console.log('  配置文件: commandExecution=' + config.commandExecution);

  // 3. 切回 root-only
  console.log('\n=== 切回 root-only ===');
  await api('POST', '/api/set-root-boundary-mode', { mode: 'root-only' });
  await new Promise(r => setTimeout(r, 1000));
  s = await api('GET', '/api/status');
  console.log('  API状态: rootBoundaryMode=' + s.rootBoundaryMode + ', commandExecution=' + s.commandExecution);

  // 4. 读配置文件，看 commandExecution 实际值
  config = JSON.parse(fs.readFileSync(realConfigPath, 'utf8'));
  console.log('\n=== 配置文件实际值 ===');
  console.log('  rootBoundaryMode =', config.rootBoundaryMode);
  console.log('  commandExecution =', config.commandExecution);
  console.log('  fileFastConfirm =', config.fileFastConfirm);

  if (config.commandExecution === true) {
    console.log('\n⚠️ 问题确认：切回 root-only 后后端未自动清除 commandExecution');
    console.log('   配置文件中 commandExecution 仍为 true');
    console.log('   风险：重启后 commandExecution 可能为 true');
  } else {
    console.log('\n✅ 后端已自动清除 commandExecution，配置文件中为', config.commandExecution);
  }

  // 5. 恢复原始状态
  console.log('\n=== 恢复原始状态 ===');
  await api('POST', '/api/set-root-boundary-mode', { mode: config.rootBoundaryMode || 'cross-root' });
  await api('POST', '/api/set-file-fast-confirm', { enabled: config.fileFastConfirm || false });
  await api('POST', '/api/set-command-execution', { enabled: config.commandExecution || false });
  console.log('  已恢复');
}

main().catch(e => console.error('错误:', e.message));
