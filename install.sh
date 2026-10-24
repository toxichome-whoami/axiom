#!/bin/sh
set -e

# Axiom automated single-command installer
# Usage: curl -fsSL https://raw.githubusercontent.com/toxichome-whoami/axiom/main/install.sh | sh

REPO="toxichome-whoami/axiom"
GITHUB_URL="https://github.com/${REPO}"

# Process command-line flags
AUTO_CONFIRM=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) AUTO_CONFIRM=1 ;;
  esac
done

if [ -n "${NONINTERACTIVE}" ] || [ -n "${CI}" ]; then
  AUTO_CONFIRM=1
fi

# Detect OS
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "${OS}" in
  linux*)   PLATFORM_OS="linux" ;;
  darwin*)  PLATFORM_OS="darwin" ;;
  msys*|mingw*|cygwin*) PLATFORM_OS="windows" ;;
  *)
    echo "Error: Unsupported operating system: ${OS}" >&2
    exit 1
    ;;
esac

# Detect Architecture
ARCH="$(uname -m)"
case "${ARCH}" in
  x86_64|amd64)   PLATFORM_ARCH="amd64" ;;
  arm64|aarch64)  PLATFORM_ARCH="arm64" ;;
  *)
    echo "Error: Unsupported architecture: ${ARCH}" >&2
    exit 1
    ;;
esac

PLATFORM="${PLATFORM_OS}_${PLATFORM_ARCH}"

echo "==> Detecting latest release of Axiom..."
LATEST_TAG=$(curl -s "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name":' | head -n 1 | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "${LATEST_TAG}" ]; then
  LATEST_TAG="v0.1.15"
fi

# Check for existing installation
EXISTING_BIN=""
if command -v axiom >/dev/null 2>&1; then
  EXISTING_BIN="$(command -v axiom)"
elif [ -f "./axiom" ]; then
  EXISTING_BIN="./axiom"
elif [ -f "./axiom.exe" ]; then
  EXISTING_BIN="./axiom.exe"
fi

if [ -n "${EXISTING_BIN}" ] && [ -x "${EXISTING_BIN}" ]; then
  CURRENT_VER=$("${EXISTING_BIN}" --version 2>/dev/null | head -n 1 | awk '{print $NF}' || echo "")
  CUR_NORM=$(echo "${CURRENT_VER}" | sed 's/^v//')
  LATEST_NORM=$(echo "${LATEST_TAG}" | sed 's/^v//')

  if [ -n "${CUR_NORM}" ]; then
    if [ "${CUR_NORM}" = "${LATEST_NORM}" ]; then
      echo "==> Axiom is already installed and up to date (${CURRENT_VER})."
      if [ "${AUTO_CONFIRM}" -eq 0 ]; then
        PROMPT_REPLY=""
        if [ -r /dev/tty ]; then
          printf "Do you want to reinstall/overwrite it? [y/N]: "
          read -r PROMPT_REPLY </dev/tty
        elif [ -t 0 ]; then
          printf "Do you want to reinstall/overwrite it? [y/N]: "
          read -r PROMPT_REPLY
        fi
        case "${PROMPT_REPLY}" in
          [yY]|[yY][eE][sS]) ;;
          *)
            echo "==> Installation cancelled. Axiom remains at ${CURRENT_VER}."
            exit 0
            ;;
        esac
      fi
    else
      echo "==> Existing installation detected: Axiom ${CURRENT_VER}"
      echo "==> Latest available release: ${LATEST_TAG}"
      if [ "${AUTO_CONFIRM}" -eq 0 ]; then
        PROMPT_REPLY=""
        if [ -r /dev/tty ]; then
          printf "Would you like to update to ${LATEST_TAG}? [Y/n]: "
          read -r PROMPT_REPLY </dev/tty
        elif [ -t 0 ]; then
          printf "Would you like to update to ${LATEST_TAG}? [Y/n]: "
          read -r PROMPT_REPLY
        fi
        case "${PROMPT_REPLY}" in
          [nN]|[nN][oO])
            echo "==> Update cancelled. Keeping existing version ${CURRENT_VER}."
            exit 0
            ;;
          *) ;;
        esac
      fi
    fi
  fi
fi

EXT="tar.gz"
if [ "${PLATFORM_OS}" = "windows" ]; then
  EXT="zip"
fi

FILENAME="axiom_${LATEST_TAG}_${PLATFORM}.${EXT}"
DOWNLOAD_URL="${GITHUB_URL}/releases/download/${LATEST_TAG}/${FILENAME}"

echo "==> Downloading Axiom ${LATEST_TAG} for ${PLATFORM}..."
TMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t 'axiom')
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

curl -fSL "${DOWNLOAD_URL}" -o "${TMP_DIR}/${FILENAME}"

echo "==> Extracting archive..."
if [ "${EXT}" = "zip" ]; then
  if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "${TMP_DIR}/${FILENAME}" -d "${TMP_DIR}"
  elif command -v tar >/dev/null 2>&1; then
    tar -xf "${TMP_DIR}/${FILENAME}" -C "${TMP_DIR}"
  fi
else
  tar -xzf "${TMP_DIR}/${FILENAME}" -C "${TMP_DIR}"
fi

BIN_DIR="/usr/local/bin"
TARGET_DIR="."

if [ -w "${BIN_DIR}" ]; then
  TARGET_DIR="${BIN_DIR}"
elif [ -n "${SUDO_USER}" ] && command -v sudo >/dev/null 2>&1; then
  TARGET_DIR="${BIN_DIR}"
fi

PKG_DIR="${TMP_DIR}/axiom_${LATEST_TAG}_${PLATFORM}"
BIN_NAME="axiom"
if [ "${PLATFORM_OS}" = "windows" ]; then
  BIN_NAME="axiom.exe"
fi

if [ -f "${PKG_DIR}/${BIN_NAME}" ]; then
  SRC_BIN="${PKG_DIR}/${BIN_NAME}"
elif [ -f "${TMP_DIR}/${BIN_NAME}" ]; then
  SRC_BIN="${TMP_DIR}/${BIN_NAME}"
else
  SRC_BIN=$(find "${TMP_DIR}" -name "${BIN_NAME}" -type f | head -n 1)
fi

if [ -z "${SRC_BIN}" ] || [ ! -f "${SRC_BIN}" ]; then
  echo "Error: Could not locate ${BIN_NAME} binary in downloaded archive." >&2
  exit 1
fi

chmod +x "${SRC_BIN}"

if [ -n "${EXISTING_BIN}" ] && [ -w "$(dirname "${EXISTING_BIN}")" ]; then
  TARGET_BIN="${EXISTING_BIN}"
  echo "==> Updating ${BIN_NAME} at ${TARGET_BIN}..."
  cp -f "${SRC_BIN}" "${TARGET_BIN}"
  INSTALLED_PATH="${TARGET_BIN}"
elif [ "${TARGET_DIR}" = "${BIN_DIR}" ] && [ ! -w "${BIN_DIR}" ]; then
  echo "==> Installing ${BIN_NAME} to ${BIN_DIR} (requires sudo)..."
  sudo cp "${SRC_BIN}" "${BIN_DIR}/${BIN_NAME}"
  INSTALLED_PATH="${BIN_DIR}/${BIN_NAME}"
elif [ -w "${BIN_DIR}" ]; then
  echo "==> Installing ${BIN_NAME} to ${BIN_DIR}..."
  cp "${SRC_BIN}" "${BIN_DIR}/${BIN_NAME}"
  INSTALLED_PATH="${BIN_DIR}/${BIN_NAME}"
else
  echo "==> Installing ${BIN_NAME} to current directory (${PWD})..."
  cp "${SRC_BIN}" "./${BIN_NAME}"
  INSTALLED_PATH="./${BIN_NAME}"
fi

echo "==> Successfully installed Axiom ${LATEST_TAG} to ${INSTALLED_PATH}!"
echo ""
echo "Run Axiom with:"
echo "  ${INSTALLED_PATH} server run"
echo ""
echo "Open the Admin Web UI at:"
echo "  http://localhost:4500/system"
