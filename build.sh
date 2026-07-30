#!/usr/bin/env bash
set -euo pipefail

VERSION="1.1.4"
BINARY_NAME="zarix-local"
DIST_DIR="dist"

build_js_bundle() {
    echo "Building JS bundle..."
    if [ ! -d "bundle/node_modules" ]; then
        (cd bundle && npm install --silent)
    fi
    (cd bundle && npx esbuild solana-entry.js \
        --bundle \
        --format=iife \
        --global-name=SolanaBundle \
        --platform=browser \
        --outfile=../frontend/solana-bundle.js \
        --minify \
        --define:global=globalThis)
    echo "  -> $(du -h frontend/solana-bundle.js | cut -f1)"
}

package_mac_app() {
    local bin_name="$1"
    local dmg_suffix="$2"
    local app_name="Zarix Local"
    local app_dir="${DIST_DIR}/${app_name}.app"
    local dmg_name="${app_name}-${VERSION}-${dmg_suffix}.dmg"

    echo "Packaging Mac App for ${dmg_suffix}..."
    rm -rf "${app_dir}"
    mkdir -p "${app_dir}/Contents/MacOS"
    mkdir -p "${app_dir}/Contents/Resources"

    cp "${DIST_DIR}/${bin_name}" "${app_dir}/Contents/MacOS/${BINARY_NAME}"
    if [ -f "assets/AppIcon.icns" ]; then
        cp "assets/AppIcon.icns" "${app_dir}/Contents/Resources/AppIcon.icns"
    fi

    cat > "${app_dir}/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>${BINARY_NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>com.zarix.local</string>
    <key>CFBundleName</key>
    <string>Zarix Local</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleVersion</key>
    <string>${VERSION}</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION}</string>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
EOF

    echo "Creating DMG with Applications shortcut..."
    local dmg_stage="${DIST_DIR}/dmg_stage"
    rm -rf "${dmg_stage}"
    mkdir -p "${dmg_stage}"
    cp -R "${app_dir}" "${dmg_stage}/"
    ln -s /Applications "${dmg_stage}/Applications"

    (cd "${DIST_DIR}" && hdiutil create -volname "${app_name}" -srcfolder "dmg_stage" -ov -format UDZO "${dmg_name}" >/dev/null)
    
    rm -rf "${app_dir}"
    rm -rf "${dmg_stage}"
    echo "  -> ${DIST_DIR}/${dmg_name}"
}

build_binary() {
    local target="${1:-}"
    local output_name=""

    if [ -z "$target" ]; then
        echo "Building for current platform..."
        cargo build --release
        local src="target/release/${BINARY_NAME}"
        output_name="${BINARY_NAME}"
    else
        echo "Building for ${target}..."
        if ! rustup target list --installed | grep -q "$target"; then
            rustup target add "$target"
        fi
        cargo build --release --target "$target"
        local src="target/${target}/release/${BINARY_NAME}"

        case "$target" in
            *windows*)
                src="${src}.exe"
                output_name="${BINARY_NAME}-${VERSION}-windows-x86_64.exe"
                ;;
            *aarch64*apple*)
                output_name="${BINARY_NAME}-${VERSION}-macos-arm64"
                ;;
            *apple*)
                output_name="${BINARY_NAME}-${VERSION}-macos-x86_64"
                ;;
            *linux*)
                output_name="${BINARY_NAME}-${VERSION}-linux-x86_64"
                ;;
            *)
                output_name="${BINARY_NAME}-${VERSION}-${target}"
                ;;
        esac
    fi

    [ ! -f "$src" ] && echo "Binary not found: $src" && exit 1
    mkdir -p "$DIST_DIR"
    cp "$src" "${DIST_DIR}/${output_name}"
    echo "  -> ${DIST_DIR}/${output_name} ($(du -h "${DIST_DIR}/${output_name}" | cut -f1))"

    if [[ "$target" == *apple* ]]; then
        local arch_suffix="macos-x86_64"
        if [[ "$target" == *aarch64* ]]; then
            arch_suffix="macos-arm64"
        fi
        package_mac_app "${output_name}" "${arch_suffix}"
    fi
}

generate_checksums() {
    (cd "$DIST_DIR" && sha256sum * > SHA256SUMS.txt 2>/dev/null || shasum -a 256 * > SHA256SUMS.txt)
    cat "${DIST_DIR}/SHA256SUMS.txt"
}

# always rebuild js first
build_js_bundle

PLATFORM="${1:-native}"
case "$PLATFORM" in
    native|"")
        build_binary
        ;;
    linux)
        build_binary "x86_64-unknown-linux-gnu"
        ;;
    macos)
        build_binary "x86_64-apple-darwin"
        ;;
    macos-arm)
        build_binary "aarch64-apple-darwin"
        ;;
    windows)
        if ! command -v x86_64-w64-mingw32-gcc &>/dev/null; then
            echo "mingw-w64 not found. Install: sudo apt install mingw-w64" && exit 1
        fi
        build_binary "x86_64-pc-windows-gnu"
        ;;
    all)
        build_binary "x86_64-unknown-linux-gnu"
        build_binary "x86_64-pc-windows-gnu" 2>/dev/null || echo "Windows skipped (no mingw)"
        build_binary "x86_64-apple-darwin" 2>/dev/null || echo "macOS x86 skipped"
        build_binary "aarch64-apple-darwin" 2>/dev/null || echo "macOS ARM skipped"
        generate_checksums
        ;;
    *)
        echo "Unknown: $PLATFORM (use: native, linux, macos, macos-arm, windows, all)" && exit 1
        ;;
esac

echo "Done -> ./${DIST_DIR}/"
