# Conflux Desktop

The Conflux desktop client uses Tauri 2, Rust, TypeScript, Vite, Tailwind CSS, and Yjs.

## Requirements

- Node.js 22
- npm
- Rust stable
- [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/)

## Setup and run

```bash
cd desktop
npm ci
source "$HOME/.cargo/env"
npm start
```

The `source` command makes Cargo available immediately after installing Rust. A newly opened terminal loads it automatically.

## Commands

```bash
npm start         # Run the Tauri app in development mode
npm run dev       # Run only the Vite frontend
npm run build     # Type-check and build the frontend
npm run lint      # Check TypeScript with ESLint
npm test          # Run the Yjs convergence check
npm run package   # Build the native executable without an installer
cargo test --manifest-path src-tauri/Cargo.toml
```

Generated frontend and Rust build output is ignored by Git.
