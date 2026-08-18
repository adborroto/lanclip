#!/usr/bin/env bash
# ============================================================
# LanClip — Shell alias installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/adborroto/lanclip/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/adborroto/lanclip/main/install.sh | bash -s -- http://192.168.1.10:4040
# ============================================================

set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
RED="\033[31m"
RESET="\033[0m"

MARKER="# lanclip-aliases"

info()    { echo -e "${CYAN}▸${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
error()   { echo -e "${RED}✗${RESET} $*" >&2; exit 1; }

echo ""
echo -e "${BOLD}📋 LanClip — Shell alias installer${RESET}"
echo "   github.com/adborroto/lanclip"
echo ""

# ── 1. Resolve server URL ────────────────────────────────────
LANCLIP_URL="${1:-}"

if [[ -z "$LANCLIP_URL" ]]; then
  # Try to detect if running interactively
  if [[ -t 0 ]]; then
    read -rp "$(echo -e "${BOLD}Enter LanClip server URL${RESET} [e.g. http://192.168.1.10:4040]: ")" LANCLIP_URL
  else
    error "URL required. Pass it as argument:\n  curl ... | bash -s -- http://192.168.1.10:4040"
  fi
fi

# Trim trailing slash
LANCLIP_URL="${LANCLIP_URL%/}"

if [[ ! "$LANCLIP_URL" =~ ^https?:// ]]; then
  error "Invalid URL: $LANCLIP_URL (must start with http:// or https://)"
fi

# ── 2. Detect shell rc files ─────────────────────────────────
RC_FILES=()

[[ -f "$HOME/.bashrc" ]]   && RC_FILES+=("$HOME/.bashrc")
[[ -f "$HOME/.bash_profile" && ! -f "$HOME/.bashrc" ]] && RC_FILES+=("$HOME/.bash_profile")
[[ -f "$HOME/.zshrc" ]]    && RC_FILES+=("$HOME/.zshrc")
[[ -f "$HOME/.config/fish/config.fish" ]] && RC_FILES+=("$HOME/.config/fish/config.fish")

if [[ ${#RC_FILES[@]} -eq 0 ]]; then
  warn "No shell rc file found. Creating $HOME/.bashrc"
  touch "$HOME/.bashrc"
  RC_FILES=("$HOME/.bashrc")
fi

info "Detected shell config files:"
for f in "${RC_FILES[@]}"; do echo "  $f"; done
echo ""

# ── 3. Build snippet ─────────────────────────────────────────
SNIPPET_BASH=$(cat <<EOF

${MARKER}
export LANCLIP_URL="${LANCLIP_URL}"

# Copy stdin to LanClip
lcp() { cat | curl -s -X POST "\${LANCLIP_URL}/api/clips" --data-binary @- -H "Content-Type: text/plain" | grep -o '"id":"[^"]*"' | head -1; }

# Paste latest clip
lpaste() { curl -s "\${LANCLIP_URL}/api/clips/latest/raw"; }

# Paste a specific clip by ID
lget() { curl -s "\${LANCLIP_URL}/api/clips/\${1}/raw"; }

# Search clips (URL-encodes the query via curl)
lsearch() { curl -sG "\${LANCLIP_URL}/api/clips/search" --data-urlencode "q=\${1}" | python3 -m json.tool 2>/dev/null || curl -sG "\${LANCLIP_URL}/api/clips/search" --data-urlencode "q=\${1}"; }

# List recent clips
lls() { curl -s "\${LANCLIP_URL}/api/clips?limit=10" | python3 -m json.tool 2>/dev/null; }
# ${MARKER}-end
EOF
)

SNIPPET_FISH=$(cat <<EOF

${MARKER}
set -x LANCLIP_URL "${LANCLIP_URL}"

function lcp; cat | curl -s -X POST "\$LANCLIP_URL/api/clips" --data-binary @- -H "Content-Type: text/plain"; end
function lpaste; curl -s "\$LANCLIP_URL/api/clips/latest/raw"; end
function lget; curl -s "\$LANCLIP_URL/api/clips/\$argv[1]/raw"; end
function lsearch; curl -sG "\$LANCLIP_URL/api/clips/search" --data-urlencode "q=\$argv[1]"; end
function lls; curl -s "\$LANCLIP_URL/api/clips?limit=10"; end
# ${MARKER}-end
EOF
)

# ── 4. Install into each rc file ─────────────────────────────
INSTALLED=()

for RC in "${RC_FILES[@]}"; do
  # Idempotency check — skip if already installed
  if grep -qF "$MARKER" "$RC" 2>/dev/null; then
    # Update the URL if it changed
    if grep -qF "LANCLIP_URL=\"$LANCLIP_URL\"" "$RC" 2>/dev/null || grep -qF "LANCLIP_URL \"$LANCLIP_URL\"" "$RC" 2>/dev/null; then
      warn "Already installed in $RC (same URL — skipping)"
    else
      warn "Already installed in $RC but URL differs — updating..."
      # Remove old block (between markers)
      TMP=$(mktemp)
      awk "/^${MARKER}$/,/^# ${MARKER}-end$/{next} 1" "$RC" > "$TMP"
      mv "$TMP" "$RC"
      if [[ "$RC" == *"fish"* ]]; then
        echo "$SNIPPET_FISH" >> "$RC"
      else
        echo "$SNIPPET_BASH" >> "$RC"
      fi
      success "Updated URL in $RC"
    fi
    continue
  fi

  if [[ "$RC" == *"fish"* ]]; then
    echo "$SNIPPET_FISH" >> "$RC"
  else
    echo "$SNIPPET_BASH" >> "$RC"
  fi

  INSTALLED+=("$RC")
  success "Installed aliases in $RC"
done

# ── 5. Summary ───────────────────────────────────────────────
echo ""
echo -e "${BOLD}Available commands:${RESET}"
echo "  lcp          Pipe stdin → LanClip  (cat file.txt | lcp)"
echo "  lpaste       Paste latest clip"
echo "  lget <id>    Paste a specific clip by ID"
echo "  lsearch <q>  Search clips"
echo "  lls          List 10 most recent clips"
echo ""

if [[ ${#INSTALLED[@]} -gt 0 ]]; then
  echo -e "${BOLD}Reload your shell to activate:${RESET}"
  for f in "${INSTALLED[@]}"; do
    echo -e "  ${CYAN}source $f${RESET}"
  done
  echo ""
fi

echo -e "${GREEN}${BOLD}Done!${RESET} LanClip server: ${CYAN}${LANCLIP_URL}${RESET}"
echo ""
