# Conflux Desktop

Tauri 2 desktop authentication client built with TypeScript, Vite, and Tailwind CSS.

## Requirements

- Node.js 22
- npm
- Rust stable
- [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/)

## Setup

```bash
npm ci
cp .env.example .env
npm start
```

The identity service must be available at `VITE_IDENTITY_API_URL`.

## Commands

```bash
npm start         # Run the Tauri app
npm run dev       # Run the Vite frontend
npm run build     # Type-check and build the frontend
npm run lint      # Lint TypeScript
npm run package   # Build the native executable
```
