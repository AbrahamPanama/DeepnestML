#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.legacy/electron-v1.4.13-darwin-x64"
RUNTIME_ZIP="$ROOT_DIR/.legacy/electron-v1.4.13-darwin-x64.zip"
ELECTRON_BINARY="$RUNTIME_DIR/Electron.app/Contents/MacOS/Electron"

run_x64() {
  arch -x86_64 /bin/zsh -lc "export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin; cd \"$ROOT_DIR\"; $1"
}

mkdir -p "$ROOT_DIR/.legacy"

if [ ! -d "$RUNTIME_DIR/Electron.app" ]; then
  curl -L -o "$RUNTIME_ZIP" "https://github.com/electron/electron/releases/download/v1.4.13/electron-v1.4.13-darwin-x64.zip"
  unzip -q "$RUNTIME_ZIP" -d "$RUNTIME_DIR"
fi

run_x64 "npm install --omit=dev --ignore-scripts --no-package-lock"

run_x64 "CPLUS_INCLUDE_PATH=/opt/homebrew/include CPPFLAGS=-I/opt/homebrew/include npx node-gyp configure --target=1.4.13 --arch=x64 --dist-url=https://electronjs.org/headers"
run_x64 "CPLUS_INCLUDE_PATH=/opt/homebrew/include CPPFLAGS=-I/opt/homebrew/include npx node-gyp build --target=1.4.13 --arch=x64 --dist-url=https://electronjs.org/headers"

codesign --deep --force --sign - "$RUNTIME_DIR/Electron.app"
codesign --force --sign - "$ROOT_DIR/build/Release/addon.node"

echo "Legacy runtime ready."
echo "Electron binary: $ELECTRON_BINARY"
echo "Run the app with: npm run legacy:start"
