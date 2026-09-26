# Conflux Desktop

This folder contains the Conflux desktop client, built with Electron, TypeScript, Vite, and Electron Forge.

## Requirements

- Node.js
- npm

## Setup and run

Run these commands from the repository root:

```bash
cd desktop
npm ci
npm start
```

## Available commands

```bash
npm start         # Run the app in development mode
npm run lint      # Check TypeScript files with ESLint
npm run package   # Package the app without creating an installer
npm run make      # Create platform-specific distributables
npm run publish   # Publish distributables (requires publisher configuration)
```

Build output is written to `out/` and is ignored by Git.

## macOS Electron cache permission fix

If Electron cannot write to `~/Library/Caches/electron`, restore ownership and reinstall its binary:

```bash
sudo chown -R "$(id -un)":"$(id -gn)" "$HOME/Library/Caches/electron"
npx install-electron --no
npm start
```

Do not run `npm install` with `sudo`.
