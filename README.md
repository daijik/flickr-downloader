# Flickr ダウンローダー

Flickr で管理している写真を、年月単位でローカルにダウンロードする Web アプリです。

## 機能

- Flickr アカウントへの OAuth 認証
- 単月指定・期間指定でのダウンロード
- ダウンロードサイズの選択（Small / Medium / Large / Original）
- 写真・動画の両対応
- 年月別フォルダへの自動整理
- リアルタイムの進捗表示・停止ボタン
- 認証トークンの永続化（再起動後も再ログイン不要）
- 起動スクリプト（最新取得・ビルド・起動を一括実行）

**ダウンロード後のフォルダ構成**

```
指定フォルダ/
  2024/
    01/
      {photo_id}.jpg
    02/
      ...
  2023/
    12/
      ...
```

## 必要なもの

- [Podman](https://podman.io/)
- Flickr API キー（[Flickr App Garden](https://www.flickr.com/services/apps/create/) で取得）

## セットアップ

### 1. リポジトリをクローン

```bash
git clone https://github.com/your-username/flickr-downloader.git
cd flickr-downloader
```

### 2. 環境変数ファイルを作成

```bash
cp .env.example .env
```

`.env` を編集して Flickr API キーを設定します。

```
FLICKR_API_KEY=your_api_key_here
FLICKR_API_SECRET=your_api_secret_here
```

### 3. 起動

```bash
./start.sh
```

以上で「最新コード取得 → ビルド → 起動」が一括で実行されます。

#### 保存先フォルダを指定したい場合

デフォルトの保存先は `~/Downloads/flickrphotos` です。変更する場合は `DOWNLOAD_DIR` を指定してください。

```bash
DOWNLOAD_DIR=/Volumes/外付けHDD/Photos ./start.sh
```

#### ポートを変更したい場合

```bash
PORT=8080 ./start.sh
```

#### 手動で起動したい場合

```bash
podman build -t flickr-downloader .
podman run -p 3000:3000 \
  --env-file .env \
  -v ./data:/opt/app-root/src/data \
  -v /Users/yourname/Downloads/flickrphotos:/downloads \
  flickr-downloader
```

ブラウザで `http://localhost:3000` を開いてください。

> **Note（macOS + Podman）**  
> コンテナ内から Mac の `/Users/...` パスに直接書き込もうとすると権限エラーになります。  
> 必ず `-v /mac/path:/downloads` でマウントし、UI では `/downloads` を入力してください。

## 使い方

1. 「Flickr でログイン」ボタンをクリックして OAuth 認証
2. 期間（単月または範囲）・サイズ・保存先フォルダを指定
   - **保存先フォルダにはコンテナ内のパスを入力**（例: `/downloads`）
   - ホスト側の保存先は `-v /mac/path:/downloads` でマウントしておく
3. 「ダウンロード開始」をクリック

認証トークンは `data/` ディレクトリに保存されます。コンテナを再起動しても再ログインは不要です。

## ファイル構成

```
.
├── start.sh         # 起動スクリプト（最新取得・ビルド・起動を一括実行）
├── Dockerfile
├── server.js        # Express サーバー（OAuth / Flickr API / ダウンロード処理）
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── data/            # 認証トークン保存先（.gitkeep のみ管理）
├── package.json
├── .env.example
└── .gitignore
```

## ライセンス

MIT
