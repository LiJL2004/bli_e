#!/usr/bin/env bash
echo '--- repo agent dirs ---'
find /home/devcontainers/bli_e/.opencode /home/devcontainers/bli_e/.workbuddy-ai -type f 2>/dev/null | head -40
echo '--- home agent/state dirs ---'
ls -d /home/devcontainers/.config/Code* /home/devcontainers/.vscode-server* /home/devcontainers/.local/share/opencode /home/devcontainers/.local/share/code-server 2>/dev/null
echo '--- vscode local history mentioning settingsPanel ---'
find /home/devcontainers/.config -type d -name 'History' 2>/dev/null | head
grep -rl 'settingsPanel' /home/devcontainers/.config/Code/User/History 2>/dev/null | head -20
echo '--- opencode data ---'
find /home/devcontainers/.local/share/opencode -type d 2>/dev/null | head -20
echo '--- workbuddy home ---'
find /home/devcontainers -maxdepth 2 -name '*workbuddy*' 2>/dev/null | head
echo '--- done ---'
