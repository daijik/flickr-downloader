# Flickr ダウンローダー

Flickr で管理している写真を、年月単位でローカルにダウンロードする Web アプリです。

## 機能

- Flickr アカウントへの OAuth 認証
- 単月指定・期間指定でのダウンロード
- ダウンロードサイズの選択（Small / Medium / Large / Original）
- 年月別フォルダへの自動整理
- リアルタイムの進捗表示
- 認証トークンの永続化（再起動後も再ログイン不要）

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

### 3. イメージをビルド

```bash
podman build -t flickr-downloader .
```

## 起動

```bash
podman run -p 3000:3000 \
  --env-file .env \
  -v ./data:/opt/app-root/src/data:Z \
  -v /path/to/save/photos:/photos:Z \
  flickr-downloader
```

| オプション | 説明 |
|---|---|
| `--env-file .env` | API キーを渡す |
| `-v ./data:...` | 認証トークンをホスト側に永続化 |
| `-v /path/to/save/photos:/photos:Z` | ダウンロード先ディレクトリをマウント |

ブラウザで `http://localhost:3000` を開いてください。

> **Note**  
> `:Z` は SELinux 環境でのファイルアクセス権を正しく設定する Podman のフラグです。  
> SELinux を使用していない環境では省略できます。

## 使い方

1. 「Flickr でログイン」ボタンをクリックして OAuth 認証
2. 期間（単月または範囲）・サイズ・保存先フォルダを指定
   - フォルダはコンテナ内のパスを入力（例: `/photos/Flickr`）
3. 「ダウンロード開始」をクリック

認証トークンは `data/` ディレクトリに保存されます。コンテナを再起動しても再ログインは不要です。

## ファイル構成

```
.
├── Dockerfile
├── server.js        # Express サーバー（OAuth / Flickr API / ダウンロード処理）
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── package.json
├── .env.example
└── .gitignore
```

## ライセンス

MIT
