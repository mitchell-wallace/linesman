#!/usr/bin/env bash
set -euo pipefail

TOOL_NAME="linesman"
REPO="mitchell-wallace/${TOOL_NAME}"

VERSION="${1:-${LINESMAN_VERSION:-}}"
VERSION="${VERSION#v}"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS" in
    linux) PLATFORM="linux" ;;
    darwin) PLATFORM="mac" ;;
    *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

ARCH=$(uname -m)
case "$ARCH" in
    x86_64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

if [ "$PLATFORM" = "linux" ] && [ "$ARCH" = "x64" ]; then
    EB_ARCH="x86_64"
else
    EB_ARCH="$ARCH"
fi

if [ -z "${VERSION}" ]; then
    LATEST_URL="https://api.github.com/repos/${REPO}/releases/latest"
    TAG=$(curl -fsSL "$LATEST_URL" | grep '"tag_name":' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
    if [ -z "$TAG" ]; then
        echo "Failed to fetch latest release tag"
        exit 1
    fi
    VERSION="${TAG#v}"
fi

BIN_DIR="$HOME/.local/bin"
LIB_DIR="$HOME/.local/lib/${TOOL_NAME}"

if [ "$PLATFORM" = "linux" ]; then
    EXT="AppImage"
    ASSET="${TOOL_NAME}_${VERSION}_${PLATFORM}_${EB_ARCH}.${EXT}"
    DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${VERSION}/${ASSET}"

    echo "Installing ${TOOL_NAME} v${VERSION} for Linux..."
    echo "Downloading ${ASSET}..."
    curl -fsSL "$DOWNLOAD_URL" -o "/tmp/${ASSET}"

    rm -f "$LIB_DIR/${TOOL_NAME}.AppImage"
    mkdir -p "$LIB_DIR"
    mv "/tmp/${ASSET}" "${LIB_DIR}/${TOOL_NAME}.AppImage"
    chmod +x "${LIB_DIR}/${TOOL_NAME}.AppImage"

    cat > "${BIN_DIR}/${TOOL_NAME}" << 'WRAPPER'
#!/usr/bin/env bash
export APPIMAGELAUNCHER_DISABLE=1
exec "$HOME/.local/lib/linesman/linesman.AppImage" "$@"
WRAPPER
    chmod +x "${BIN_DIR}/${TOOL_NAME}"

    ln -sf "${TOOL_NAME}" "${BIN_DIR}/lmn"

    echo "Installed ${TOOL_NAME} → ${LIB_DIR}/${TOOL_NAME}.AppImage"
    echo "Alias: lmn → ${BIN_DIR}/lmn"
elif [ "$PLATFORM" = "mac" ]; then
    EXT="zip"
    ASSET="${TOOL_NAME}_${VERSION}_${PLATFORM}_${EB_ARCH}.${EXT}"
    DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${VERSION}/${ASSET}"

    echo "Installing ${TOOL_NAME} v${VERSION} for macOS..."
    echo "Downloading ${ASSET}..."
    curl -fsSL "$DOWNLOAD_URL" -o "/tmp/${ASSET}"

    TMPDIR_EXTRACT=$(mktemp -d)
    unzip -q "/tmp/${ASSET}" -d "$TMPDIR_EXTRACT"

    APP_PATH=$(find "$TMPDIR_EXTRACT" -name "${TOOL_NAME}.app" -maxdepth 2 | head -1)
    if [ -z "$APP_PATH" ]; then
        APP_PATH=$(find "$TMPDIR_EXTRACT" -name "*.app" -maxdepth 2 | head -1)
    fi

    if [ -n "$APP_PATH" ]; then
        cp -R "$APP_PATH" "/Applications/${TOOL_NAME}.app"
        echo "Installed to /Applications/${TOOL_NAME}.app"
    else
        cp -R "$TMPDIR_EXTRACT"/* "/Applications/" 2>/dev/null || true
        echo "Extracted to /Applications/"
    fi

    APP_EXEC="/Applications/${TOOL_NAME}.app/Contents/MacOS/${TOOL_NAME}"
    if [ -f "$APP_EXEC" ]; then
        mkdir -p "$BIN_DIR"
        ln -sf "$APP_EXEC" "${BIN_DIR}/${TOOL_NAME}" 2>/dev/null || {
            sudo ln -sf "$APP_EXEC" "/usr/local/bin/${TOOL_NAME}"
            echo "CLI wrapper: /usr/local/bin/${TOOL_NAME}"
        }
        ln -sf "${TOOL_NAME}" "${BIN_DIR}/lmn" 2>/dev/null || {
            sudo ln -sf "$APP_EXEC" "/usr/local/bin/lmn"
        }
        echo "Alias: lmn"
    fi

    rm -rf "$TMPDIR_EXTRACT" "/tmp/${ASSET}"

    echo ""
    echo "Note: On first launch, macOS may block the app (unsigned)."
    echo "Right-click the app → Open → Open again to allow it."
fi

add_to_path() {
    FILE="$1"
    LINE='export PATH="$HOME/.local/bin:$PATH"'
    if [ -f "$FILE" ]; then
        if ! grep -Fxq "$LINE" "$FILE"; then
            echo "$LINE" >> "$FILE"
            echo "Updated $FILE"
        fi
    fi
}

if [ "$PLATFORM" = "linux" ]; then
    add_to_path "$HOME/.bashrc"
    add_to_path "$HOME/.zshrc"

    FISH_CONFIG="$HOME/.config/fish/config.fish"
    if [ -f "$FISH_CONFIG" ]; then
        FISH_LINE='set -gx PATH "$HOME/.local/bin" $PATH'
        if ! grep -Fxq "$FISH_LINE" "$FISH_CONFIG"; then
            echo "$FISH_LINE" >> "$FISH_CONFIG"
            echo "Updated $FISH_CONFIG"
        fi
    fi
fi

echo ""
echo "Installation complete. Restart your shell or run 'source ~/.bashrc' (or equivalent) to update PATH."
echo "Usage: cd your-project && ${TOOL_NAME}"
echo "       cd your-project && lmn"
