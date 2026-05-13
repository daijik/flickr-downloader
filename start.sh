#!/bin/bash
# ============================================================
# Flickr ダウンローダー 起動スクリプト
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTAINER_NAME="flickr-downloader"
IMAGE_NAME="flickr-downloader"
PORT="${PORT:-3000}"

# ダウンロードした写真・動画の保存先（必要に応じて変更してください）
DOWNLOAD_DIR="${DOWNLOAD_DIR:-$HOME/Downloads/flickrphotos}"

# ------------------------------------------------------------
# 前提チェック
# ------------------------------------------------------------
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo "エラー: .env ファイルが見つかりません。"
  echo "  cp $SCRIPT_DIR/.env.example $SCRIPT_DIR/.env"
  echo "  の後、FLICKR_API_KEY と FLICKR_API_SECRET を設定してください。"
  exit 1
fi

if ! command -v podman &>/dev/null; then
  echo "エラー: podman が見つかりません。インストールしてください。"
  exit 1
fi

# ------------------------------------------------------------
# GitHub から最新を取得
# ------------------------------------------------------------
echo "==> 最新コードを取得中..."
git -C "$SCRIPT_DIR" pull

# ------------------------------------------------------------
# 既存コンテナを停止・削除
# ------------------------------------------------------------
if podman ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER_NAME"; then
  echo "==> 既存コンテナを停止・削除中..."
  podman rm -f "$CONTAINER_NAME" >/dev/null
fi

# ------------------------------------------------------------
# イメージをビルド
# ------------------------------------------------------------
echo "==> イメージをビルド中..."
podman build -t "$IMAGE_NAME" "$SCRIPT_DIR"

# ------------------------------------------------------------
# ダウンロード先・データディレクトリを準備
# ------------------------------------------------------------
mkdir -p "$SCRIPT_DIR/data"
mkdir -p "$DOWNLOAD_DIR"

# ------------------------------------------------------------
# コンテナを起動
# ------------------------------------------------------------
echo "==> コンテナを起動中..."
podman run -d \
  --name "$CONTAINER_NAME" \
  -p "${PORT}:3000" \
  --env-file "$SCRIPT_DIR/.env" \
  -v "$SCRIPT_DIR/data:/opt/app-root/src/data" \
  -v "$DOWNLOAD_DIR:/downloads" \
  "$IMAGE_NAME"

echo ""
echo "起動しました: http://localhost:${PORT}"
echo "保存先フォルダ: $DOWNLOAD_DIR（UIでは /downloads と入力）"
echo ""
echo "ログ確認 : podman logs -f $CONTAINER_NAME"
