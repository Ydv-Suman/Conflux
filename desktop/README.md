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

Identity Service must be available at `VITE_IDENTITY_API_URL`, and Workspace Service must be available at `VITE_WORKSPACE_API_URL`. The desktop client sends the in-memory bearer token to Workspace Service but deliberately omits Identity refresh cookies from cross-service requests.

The Projects area lists every project connected to the signed-in user. Opening a project reveals all assigned teams; member details and workstreams load only for teams the user belongs to. Project and team controls are capability-aware for usability, while Identity and Workspace Services remain responsible for every authorization decision.

## Commands

```bash
npm start         # Run the Tauri app
npm run dev       # Run the Vite frontend
npm run build     # Type-check and build the frontend
npm run lint      # Lint TypeScript
npm run package   # Build the native executable
```
