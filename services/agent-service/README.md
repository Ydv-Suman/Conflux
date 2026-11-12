# Conflux Agent Service

Python and FastAPI service for Conflux task-scoped AI agents. Runs belong to a
project, team, workstream, and task; unrelated workstreams must not share context.

## Current scope

This is the service scaffold. It provides a FastAPI application, a public health
endpoint, and generated API documentation. Agent runs, model providers,
authorization, persistence, and desktop integration are not implemented yet.
No model API key, database, or other Conflux service is needed to run the scaffold.

## Requirements

- Python 3.12; local development is pinned to **3.12.16**.
  We use this mature line for library compatibility. It receives security updates;
  see [Python release status](https://devguide.python.org/versions/).
- [uv](https://docs.astral.sh/uv/getting-started/installation/) for the environment
  and locked dependencies.

## Run locally

From the repository root:

```bash
cd services/agent-service
uv sync
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

`uv sync` creates a local `.venv` and installs the dependencies recorded in
`uv.lock`. uv can download the configured Python version if needed. The first run
requires network access. Stop the development server with Ctrl+C.

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Process health |
| `/docs` | Interactive API documentation |
| `/redoc` | Alternative API documentation |
| `/openapi.json` | OpenAPI schema |

Check the running service:

```bash
curl http://127.0.0.1:8000/health
```

Expected response:

```json
{"status":"ok","service":"agent-service"}
```

The health response confirms the process is running; it does not claim that model
providers or future dependencies are ready.

## Checks and GitHub CI

Run the application checks from this service directory:

```bash
uv sync --locked
uv pip check
uv run --locked python -m compileall -q app tests
uv run --locked python -m unittest discover -s tests -v
```

[Agent Service CI](../../.github/workflows/agent-ci.yml) runs these checks for
pushes and pull requests affecting this service or its workflow. It installs the
Python version from `.python-version`, checks the lockfile without updating it,
tests health and documentation routes, and starts Uvicorn on port **8000** for an
HTTP health check. It can also be started manually from GitHub Actions. No model
keys or service credentials are required.

## First milestone: read-only Coder proposals

Build this workflow before returning to shared Git checkpoints:

1. Submit a task for the active project, team, and workstream. Verify identity and
   team capabilities before accepting runs or exposing their events/results.
2. Supply explicitly selected repository files through the desktop. Exclude
   secrets and private/ignored paths, and record the inputs used for the run.
   A client repository path is not a readable server filesystem path.
3. Run one Coder agent and stream progress, responses, and completion/failure.
4. Return a candidate patch without modifying shared documents or local working
   files. Validate its paths and present the before/after diff in Monaco.
5. Support cancellation, timeouts, usage/cost limits, and visible provider errors.

Acceptance: a user asks the Coder to change a file, watches progress, and reviews
the proposed diff. Canonical files remain unchanged.

Model-provider and agent-framework selection remains open. Add dependencies when
implementing that integration. Do not introduce command execution or file writes
as part of the read-only proposal milestone.

## Later work

- Consistent shared snapshot capture and coordinated Git checkpoints.
- Isolated execution and tests, then human-approved patch application with
  stale-input checks that account for concurrent shared edits.
- Reviewer and Security agents operating on the same candidate patch.
- Durable run recovery and queues when the execution model requires them.

Workspace Service continues to own project/workstream metadata and future shared
checkpoint coordination. Collaboration Service owns live document/tree state and
attribution. Tauri/Rust owns local filesystem, Git, and eventual terminal execution.
The Agent Service owns task/run orchestration and model-provider interactions.

## Layout

```text
agent-service/
├── app/
│   ├── __init__.py
│   └── main.py
├── .python-version
├── tests/
│   └── test_app.py
├── pyproject.toml
├── uv.lock
└── README.md
```

See the [FastAPI documentation](https://fastapi.tiangolo.com/tutorial/first-steps/)
and [Conflux architecture](../../docs/architecture.md).
