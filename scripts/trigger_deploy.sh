#!/usr/bin/env bash
# Helper: prepare repo, push to GitHub, and set Render/GH secrets using gh CLI.
# USAGE:
#   RENDER_API_KEY="..." RENDER_SERVICE_ID="..." ADMIN_API_KEY="..." \
#     ./scripts/trigger_deploy.sh --remote <git-remote-url> --branch main

set -euo pipefail

BRANCH="main"
REMOTE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote) REMOTE="$2"; shift 2;;
    --branch) BRANCH="$2"; shift 2;;
    *) echo "Unknown arg: $1"; exit 2;;
  esac
done

echo "Starting deploy helper..."

if ! command -v git >/dev/null 2>&1; then
  echo "git is required"; exit 2
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "gh (GitHub CLI) is required to set secrets. Install and authenticate first."; exit 2
fi

if [ ! -d .git ]; then
  echo "Initializing git repository..."
  git init
  git branch -M "$BRANCH"
fi

if [ -n "$REMOTE" ]; then
  echo "Adding remote origin -> $REMOTE"
  git remote remove origin 2>/dev/null || true
  git remote add origin "$REMOTE"
fi

echo "Staging and committing changes..."
git add -A
if git diff --staged --quiet; then
  git commit --allow-empty -m "chore(ci): trigger initial deploy"
else
  git commit -m "chore(ci): initial commit + trigger deploy" || true
fi

echo "Pushing to origin/$BRANCH..."
git push -u origin "$BRANCH"

echo "Setting GitHub secrets (if environment variables provided)..."
if [ -n "${RENDER_API_KEY:-}" ]; then
  gh secret set RENDER_API_KEY --body "$RENDER_API_KEY"
  echo "Set RENDER_API_KEY"
fi
if [ -n "${RENDER_SERVICE_ID:-}" ]; then
  gh secret set RENDER_SERVICE_ID --body "$RENDER_SERVICE_ID"
  echo "Set RENDER_SERVICE_ID"
fi
if [ -n "${ADMIN_API_KEY:-}" ]; then
  gh secret set ADMIN_API_KEY --body "$ADMIN_API_KEY"
  echo "Set ADMIN_API_KEY"
fi

echo "Done. GitHub Actions should start the workflow for branch $BRANCH." 
