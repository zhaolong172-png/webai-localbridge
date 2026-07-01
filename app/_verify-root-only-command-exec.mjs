const http = require('http');
const fs = require('fs');

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: '127.0.0.1',
      port: 33004,
      path,
      method,
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
  // 1. 先设成 Case D（三个都开启）
  console.log('=== 先设成 Case D（三个都开启）===');
  await api('POST', '/api/set-root-boundary-mode', { mode: 'cross-root' });
  await api('POST', '/api/set-file-fast-confirm', { enabled: true });
  await api('POST', '/api/set-command-execution', { enabled: true });
  await new Promise(r => setTimeout(r, 800));
  let s = await api('GET', '/api/status');
  console.log('Case D 状态: rootBoundaryMode=' + s.rootBoundaryMode
    + ', fileFastConfirm=' + s.fileFastConfirm
    + ', commandExecution=' + s.commandExecution);

  // 2. 切回 root-only
  console.log('\n=== 切回 root-only ===');
  await api('POST', '/api/set-root-boundary-mode', { mode: 'root-only' });
  await new Promise(r => setTimeout(r, 800));
  s = await api('GET', '/api/status');
  console.log('切回后 /api/status: rootBoundaryMode=' + s.rootBoundaryMode
    + ', commandExecution=' + s.commandExecution);

  // 3. 直接读配置文件
  const configPath = 'C:/Users/ZhaoQianlong/WorkBuddy/2026-06-07-00-13-22/mcp-tunnel/mcp-tunnel-config.json';
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('\n配置文件实际值:');
  console.log('  rootBoundaryMode = ' + config.rootBoundaryMode);
  console.log('  commandExecution = ' + config.commandExecution);
  console.log('  fileFastConfirm = ' + config.fileFastConfirm);

  if (config.commandExecution === true) {
    console.log('\n⚠️ 问题确认：切回 root-only 后后端未自动清除 commandExecution');
    console.log('   配置文件中 commandExecution 仍为 true');
  } else {
    console.log('\n✅ 后端已自动清除 commandExecution');
  }
}

main().catch(e => console.error('错误:', e.message));
