# Development setup

This project uses Node through nvm.

Before running npm commands, run:

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use

Only install dependencies when they are missing or when `package.json` / `package-lock.json` changed:

npm install

Only start the dev server when the task requires running the app:

npm run dev

# Codex command behavior

Do not repeatedly retry commands that fail because of sandbox or permission boundaries.

If a localhost request, local server check, browser verification, or dev-server probe is blocked by the sandbox, stop after the first failed attempt. Ask for the needed permission before retrying with elevated access, or report that the check could not be completed from the current permission context.

When the app is already running, reuse the existing server instead of starting another one. Prefer checking the app through the in-app browser when possible.
