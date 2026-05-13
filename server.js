require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TOKENS_FILE = path.join(DATA_DIR, '.tokens.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

if (!process.env.FLICKR_API_KEY || !process.env.FLICKR_API_SECRET) {
  console.error('Error: FLICKR_API_KEY と FLICKR_API_SECRET を .env に設定してください');
  process.exit(1);
}

const CONSUMER_KEY = process.env.FLICKR_API_KEY;
const CONSUMER_SECRET = process.env.FLICKR_API_SECRET;
const CALLBACK_URL = `http://localhost:${PORT}/auth/callback`;

// 認証トークンの永続化
function loadTokens() {
  try {
    if (fs.existsSync(TOKENS_FILE)) return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  } catch {}
  return {};
}

function saveTokens(t) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2));
}

const store = { requestTokenSecret: '', ...loadTokens() };

// --- OAuth 1.0a ---
function oauthSign(method, url, params, tokenSecret) {
  const sorted = Object.keys(params).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');
  const base = [method.toUpperCase(), encodeURIComponent(url), encodeURIComponent(sorted)].join('&');
  const key = `${encodeURIComponent(CONSUMER_SECRET)}&${encodeURIComponent(tokenSecret || '')}`;
  return crypto.createHmac('sha1', key).update(base).digest('base64');
}

// oauthExtras: Authorizationヘッダーに含めるOAuthパラメータ (oauth_callback, oauth_verifier等)
// queryParams: 署名計算に含めるが、ヘッダーには含めないリクエストパラメータ
function makeAuthHeader(method, url, oauthExtras, queryParams, token, tokenSecret) {
  const o = {
    oauth_consumer_key: CONSUMER_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: '1.0',
    ...(oauthExtras || {}),
  };
  if (token) o.oauth_token = token;
  o.oauth_signature = oauthSign(method, url, { ...o, ...(queryParams || {}) }, tokenSecret);
  return 'OAuth ' + Object.keys(o).sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(o[k])}"`)
    .join(', ');
}

// --- HTTP ヘルパー ---
function httpGet(url, headers, depth = 0) {
  if (depth > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(httpGet(res.headers.location, headers, depth + 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

function downloadFile(url, destPath, depth = 0) {
  if (depth > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(downloadFile(res.headers.location, destPath, depth + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      try {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
      } catch (e) {
        return reject(e);
      }
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      out.on('finish', resolve);
      out.on('error', e => { out.destroy(); reject(e); });
      res.on('error', e => { out.destroy(); reject(e); });
    }).on('error', reject);
  });
}

// --- Flickr API ---
async function flickrCall(method, params) {
  const url = 'https://www.flickr.com/services/rest/';
  const qp = { method, format: 'json', nojsoncallback: '1', ...params };
  const auth = makeAuthHeader('GET', url, null, qp, store.accessToken, store.accessTokenSecret);
  const qs = Object.entries(qp).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const res = await httpGet(`${url}?${qs}`, { Authorization: auth });
  const data = JSON.parse(res.body);
  if (data.stat === 'fail') throw new Error(data.message);
  return data;
}

// --- ダウンロード処理 ---
const SIZE_FALLBACKS = {
  s: ['url_s', 'url_z', 'url_l'],
  z: ['url_z', 'url_l', 'url_s'],
  l: ['url_l', 'url_z', 'url_s'],
  o: ['url_o', 'url_l', 'url_z'],
};

async function* streamDownload(sy, sm, ey, em, size, folder) {
  const pad = n => String(n).padStart(2, '0');
  const extras = 'url_s,url_z,url_l,url_o,date_taken,originalformat';
  const lastDay = new Date(ey, em, 0).getDate();
  const minDate = `${sy}-${pad(sm)}-01 00:00:00`;
  const maxDate = `${ey}-${pad(em)}-${pad(lastDay)} 23:59:59`;

  const first = await flickrCall('flickr.photos.search', {
    user_id: 'me', min_taken_date: minDate, max_taken_date: maxDate,
    extras, per_page: 500, page: 1,
  });

  const total = parseInt(first.photos.total);
  yield { type: 'total', count: total };
  if (total === 0) { yield { type: 'done', downloaded: 0, errors: 0 }; return; }

  let done = 0, errs = 0;
  const pages = first.photos.pages;

  for (let page = 1; page <= pages; page++) {
    const data = page === 1 ? first : await flickrCall('flickr.photos.search', {
      user_id: 'me', min_taken_date: minDate, max_taken_date: maxDate,
      extras, per_page: 500, page,
    });

    for (const photo of data.photos.photo) {
      const isVideo = photo.media === 'video';

      // URL と拡張子の決定
      let downloadUrl, ext;
      if (isVideo) {
        try {
          const streamData = await flickrCall('flickr.video.getStreamInfo', { photo_id: photo.id });
          const streams = [].concat(streamData.streams?.stream || []);
          const stream = ['orig', 'hd', 'sd'].map(t => streams.find(s => s.type === t)).find(Boolean);
          downloadUrl = stream?._content;
          ext = 'mp4';
        } catch (e) {
          errs++;
          yield { type: 'progress', current: done + errs, total, error: `動画情報取得失敗: ${photo.title || photo.id}` };
          continue;
        }
      } else {
        downloadUrl = (SIZE_FALLBACKS[size] || SIZE_FALLBACKS.l).map(k => photo[k]).find(Boolean);
        ext = photo.originalformat || downloadUrl?.match(/\.(\w+)(\?|$)/)?.[1] || 'jpg';
      }

      if (!downloadUrl) {
        errs++;
        yield { type: 'progress', current: done + errs, total, error: `URLなし: ${photo.id}` };
        continue;
      }

      // Flickr returns 'datetaken' (no underscore) and 'datetakenunknown'=1 when date is unset
      const takenMatch = photo.datetakenunknown !== '1'
        ? (photo.datetaken || '').match(/^(\d{4})-(\d{2})/)
        : null;
      let year, month;
      if (takenMatch) {
        year = takenMatch[1];
        month = takenMatch[2];
      } else if (photo.dateupload) {
        const d = new Date(parseInt(photo.dateupload) * 1000);
        year = String(d.getFullYear());
        month = String(d.getMonth() + 1).padStart(2, '0');
      } else {
        year = 'unknown';
        month = 'unknown';
      }
      const destPath = path.join(folder, year, month, `${photo.id}.${ext}`);

      if (fs.existsSync(destPath)) {
        done++;
        yield { type: 'progress', current: done + errs, total, skipped: true, title: photo.title, isVideo };
        continue;
      }

      if (stopRequested) {
        yield { type: 'stopped', downloaded: done, errors: errs };
        return;
      }

      try {
        await downloadFile(downloadUrl, destPath);
        done++;
        yield { type: 'progress', current: done + errs, total, title: photo.title, isVideo };
      } catch (e) {
        errs++;
        yield { type: 'progress', current: done + errs, total, error: e.message };
      }
    }
  }

  yield { type: 'done', downloaded: done, errors: errs };
}

// --- 停止フラグ ---
let stopRequested = false;

// --- ルーティング ---
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/auth/status', (_, res) => {
  res.json({ authenticated: !!store.accessToken, username: store.username || '' });
});

app.get('/auth/start', async (_, res) => {
  try {
    const url = 'https://www.flickr.com/services/oauth/request_token';
    const auth = makeAuthHeader('GET', url, { oauth_callback: CALLBACK_URL }, null, '', '');
    const r = await httpGet(url, { Authorization: auth });
    if (r.status !== 200) throw new Error(r.body);
    const p = querystring.parse(r.body);
    if (!p.oauth_token) throw new Error(`レスポンス異常: ${r.body}`);
    store.requestTokenSecret = p.oauth_token_secret;
    res.redirect(`https://www.flickr.com/services/oauth/authorize?oauth_token=${p.oauth_token}&perms=read`);
  } catch (e) {
    res.status(500).send(`<pre>認証エラー: ${e.message}</pre>`);
  }
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { oauth_token, oauth_verifier } = req.query;
    if (!oauth_token || !oauth_verifier) throw new Error('OAuthパラメータがありません');
    const url = 'https://www.flickr.com/services/oauth/access_token';
    const qp = { oauth_verifier };
    const auth = makeAuthHeader('GET', url, null, qp, oauth_token, store.requestTokenSecret);
    const r = await httpGet(`${url}?oauth_verifier=${encodeURIComponent(oauth_verifier)}`, { Authorization: auth });
    if (r.status !== 200) throw new Error(r.body);
    const p = querystring.parse(r.body);
    if (!p.oauth_token) throw new Error(`レスポンス異常: ${r.body}`);
    store.accessToken = p.oauth_token;
    store.accessTokenSecret = p.oauth_token_secret;
    store.username = p.username;
    store.userId = p.user_nsid;
    store.requestTokenSecret = '';
    saveTokens({ accessToken: store.accessToken, accessTokenSecret: store.accessTokenSecret, username: store.username, userId: store.userId });
    res.redirect('/');
  } catch (e) {
    res.status(500).send(`<pre>コールバックエラー: ${e.message}</pre>`);
  }
});

app.get('/auth/logout', (_, res) => {
  store.accessToken = '';
  store.accessTokenSecret = '';
  store.username = '';
  store.userId = '';
  if (fs.existsSync(TOKENS_FILE)) fs.unlinkSync(TOKENS_FILE);
  res.redirect('/');
});

app.post('/api/download/stop', (_, res) => {
  stopRequested = true;
  res.json({ ok: true });
});

app.get('/api/download/stream', async (req, res) => {
  if (!store.accessToken) return res.status(401).json({ error: '未認証' });
  const { startYear, startMonth, endYear, endMonth, size, folder } = req.query;
  if (!startYear || !startMonth || !endYear || !endMonth || !size || !folder) {
    return res.status(400).json({ error: 'パラメータが不足しています' });
  }
  stopRequested = false;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = d => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(d)}\n\n`); };
  try {
    for await (const e of streamDownload(+startYear, +startMonth, +endYear, +endMonth, size, folder)) {
      send(e);
    }
  } catch (e) {
    send({ type: 'error', message: e.message });
  }
  if (!res.writableEnded) res.end();
});

app.post('/api/shutdown', (_, res) => {
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 300);
});

app.listen(PORT, () => {
  console.log(`Flickr ダウンローダー起動中: http://localhost:${PORT}`);
});
