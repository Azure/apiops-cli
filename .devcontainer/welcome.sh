#!/usr/bin/env bash

# Only print the banner in interactive terminals.
if [[ $- != *i* ]]; then
  return
fi

WELCOME_MARKER_FILE="$HOME/.config/apiops-cli/welcome-shown"

# Print only once per container/user lifecycle.
if [[ -f "$WELCOME_MARKER_FILE" ]]; then
  return
fi

mkdir -p "$HOME/.config/apiops-cli"
touch "$WELCOME_MARKER_FILE"

printf "👋 Welcome to apiops-cli!\n\n"
printf "📚 To get started, run:\n"
printf "  npm ci && npm run build\n\n"
