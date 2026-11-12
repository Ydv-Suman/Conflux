from fastapi import FastAPI

app = FastAPI(
    title="Conflux Agent Service",
    description="Task-scoped AI agent execution and orchestration for Conflux.",
    version="0.1.0",
)


@app.get("/health", tags=["Health"])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "agent-service"}
