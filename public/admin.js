let allVisits = [];
const $ = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function duration(seconds) {
  const value = Number(seconds) || 0;
  if (value < 60) return `${value} 秒`;
  if (value < 3600) return `${Math.floor(value / 60)} 分 ${value % 60} 秒`;
  return `${Math.floor(value / 3600)} 时 ${Math.floor(value % 3600 / 60)} 分`;
}

function render() {
  const keyword = $('search').value.trim().toLowerCase();
  const filtered = allVisits.filter(v => JSON.stringify(v).toLowerCase().includes(keyword));
  $('rows').innerHTML = filtered.map(v => `<tr>
    <td><span class="dot ${v.status === 'online' ? 'online' : ''}"></span>${v.status === 'online' ? '在线' : '离线'}</td>
    <td>${new Date(v.startedAt).toLocaleString('zh-CN')}</td>
    <td>${duration(v.durationSeconds)}</td>
    <td title="匿名访客 ID: ${escapeHtml(v.visitorId)}">${escapeHtml(v.deviceKey)}</td>
    <td>${escapeHtml(v.deviceType)}</td>
    <td>${escapeHtml(v.os)} / ${escapeHtml(v.browser)}</td>
    <td>${escapeHtml(v.screen)}<br><small>窗口 ${escapeHtml(v.viewport)}</small></td>
    <td>${escapeHtml(v.language)}<br><small>${escapeHtml(v.timezone)}</small></td>
    <td title="${escapeHtml(v.referrer)}">${escapeHtml(v.referrer || '直接访问')}</td>
  </tr>`).join('');
  $('empty').style.display = filtered.length ? 'none' : 'block';
}

async function load() {
  const response = await fetch('/api/admin/visits');
  if (response.status === 401) {
    $('login').style.display = 'grid';
    $('dashboard').style.display = 'none';
    return;
  }
  const data = await response.json();
  allVisits = data.visits;
  $('total').textContent = data.summary.total;
  $('unique').textContent = data.summary.unique;
  $('online').textContent = data.summary.online;
  $('updated').textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN')}`;
  $('login').style.display = 'none';
  $('dashboard').style.display = 'block';
  render();
}

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('error').textContent = '';
  const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('password').value }) });
  if (!response.ok) { $('error').textContent = '密码错误，请重试'; return; }
  $('password').value = '';
  load();
});

$('logout').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  location.reload();
});
$('search').addEventListener('input', render);
load().catch(() => { $('error').textContent = '暂时无法连接服务器'; });
setInterval(() => { if ($('dashboard').style.display === 'block') load().catch(() => {}); }, 10000);
