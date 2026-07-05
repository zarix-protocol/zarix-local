#!/usr/bin/env bash
set -euo pipefail

VERSION="1.1.2"
BINARY_NAME="zarix-local"
DIST_DIR="dist"

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

if [ -f "${DIST_DIR}/zarix-local-1.1.2-macos-x86_64" ]; then
    package_mac_app "zarix-local-1.1.2-macos-x86_64" "macos-x86_64"
fi

if [ -f "${DIST_DIR}/zarix-local-1.1.2-macos-arm64" ]; then
    package_mac_app "zarix-local-1.1.2-macos-arm64" "macos-arm64"
fi

echo "Done packaging!"
