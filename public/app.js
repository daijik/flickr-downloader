const $ = id => document.getElementById(id);

// --- 年月セレクトの初期化 ---
function populateYears(id, selected) {
  const el = $(id);
  const cur = new Date().getFullYear();
  for (let y = cur; y >= 2000; y--) {
    const o = document.createElement('option');
    o.value = y;
    o.textContent = `${y}年`;
    if (y === (selected ?? cur)) o.selected = true;
    el.appendChild(o);
  }
}

function populateMonths(id, selected) {
  const el = $(id);
  const cur = new Date().getMonth() + 1;
  for (let m = 1; m <= 12; m++) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = `${m}月`;
    if (m === (selected ?? cur)) o.selected = true;
    el.appendChild(o);
  }
}

const now = new Date();
populateYears('singleYear');
populateMonths('singleMonth');
populateYears('startYear', now.getFullYear() - 1);
populateMonths('startMonth', 1);
populateYears('endYear');
populateMonths('endMonth');

// --- モード切替 ---
document.querySelectorAll('input[name="mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    $('singleMode').classList.toggle('hidden', radio.value !== 'single');
    $('rangeMode').classList.toggle('hidden', radio.value !== 'range');
  });
});

// --- 認証状態確認 ---
async function checkAuth() {
  const data = await fetch('/api/auth/status').then(r => r.json());
  const authEl = $('authStatus');

  if (data.authenticated) {
    authEl.innerHTML =
      `<span>ログイン中: <span class="username">${data.username}</span></span>` +
      `<a href="/auth/logout" class="btn-link">ログアウト</a>`;
    $('main').classList.remove('hidden');
    $('loginSection').classList.add('hidden');
  } else {
    authEl.innerHTML = '';
    $('main').classList.add('hidden');
    $('loginSection').classList.remove('hidden');
  }
}

checkAuth();

// --- ダウンロード開始 ---
$('downloadBtn').addEventListener('click', () => {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  let sy, sm, ey, em;

  if (mode === 'single') {
    sy = ey = +$('singleYear').value;
    sm = em = +$('singleMonth').value;
  } else {
    sy = +$('startYear').value;
    sm = +$('startMonth').value;
    ey = +$('endYear').value;
    em = +$('endMonth').value;
  }

  if (sy > ey || (sy === ey && sm > em)) {
    alert('開始年月が終了年月より後になっています');
    return;
  }

  const folder = $('folderInput').value.trim();
  if (!folder) {
    alert('保存先フォルダを入力してください');
    return;
  }

  startDownload(sy, sm, ey, em, $('sizeSelect').value, folder);
});

function addLog(text, cls) {
  const log = $('progressLog');
  const el = document.createElement('div');
  el.className = `log-entry${cls ? ' ' + cls : ''}`;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function startDownload(sy, sm, ey, em, size, folder) {
  const btn = $('downloadBtn');
  const section = $('progressSection');
  const fill = $('progressFill');
  const info = $('progressInfo');
  const log = $('progressLog');

  btn.disabled = true;
  section.classList.remove('hidden');
  log.innerHTML = '';
  fill.style.width = '0%';
  info.textContent = '接続中...';

  const params = new URLSearchParams({ startYear: sy, startMonth: sm, endYear: ey, endMonth: em, size, folder });
  const es = new EventSource(`/api/download/stream?${params}`);
  let total = 0;

  es.onmessage = ({ data }) => {
    const ev = JSON.parse(data);

    if (ev.type === 'total') {
      total = ev.count;
      info.textContent = total === 0
        ? '対象の写真が見つかりませんでした'
        : `0 / ${total} 件`;
      if (total === 0) { es.close(); btn.disabled = false; }

    } else if (ev.type === 'progress') {
      const pct = total > 0 ? (ev.current / total * 100).toFixed(1) : 0;
      fill.style.width = `${pct}%`;
      info.textContent = `${ev.current} / ${total} 件 (${pct}%)`;

      if (ev.error) {
        addLog(`✗ ${ev.error}`, 'error');
      } else if (ev.skipped) {
        addLog(`→ スキップ: ${ev.title || ''}`, 'skip');
      } else {
        addLog(`✓ ${ev.title || ''}`);
      }

    } else if (ev.type === 'done') {
      fill.style.width = '100%';
      info.textContent = `完了: ${ev.downloaded} 件ダウンロード / ${ev.errors} 件エラー`;
      addLog(`ダウンロード完了 (${ev.downloaded} 件)`, 'done');
      es.close();
      btn.disabled = false;

    } else if (ev.type === 'error') {
      info.textContent = `エラー: ${ev.message}`;
      addLog(`✗ ${ev.message}`, 'error');
      es.close();
      btn.disabled = false;
    }
  };

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) return;
    info.textContent = 'サーバーとの接続が切断されました';
    addLog('接続エラー', 'error');
    es.close();
    btn.disabled = false;
  };
}
