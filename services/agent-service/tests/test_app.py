import json
import unittest

from app.main import app


class ApplicationTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, path: str) -> bytes:
        messages = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            messages.append(message)

        await app(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": "GET",
                "scheme": "http",
                "path": path,
                "raw_path": path.encode(),
                "query_string": b"",
                "root_path": "",
                "headers": [],
                "server": ("localhost", 8000),
                "client": ("127.0.0.1", 12345),
            },
            receive,
            send,
        )
        status = next(
            message["status"]
            for message in messages
            if message["type"] == "http.response.start"
        )
        self.assertEqual(status, 200)
        return b"".join(
            message.get("body", b"")
            for message in messages
            if message["type"] == "http.response.body"
        )

    async def test_health(self):
        self.assertEqual(
            json.loads(await self.request("/health")),
            {"status": "ok", "service": "agent-service"},
        )

    async def test_api_documentation(self):
        for path in ("/docs", "/redoc"):
            with self.subTest(path=path):
                self.assertIn(b"Conflux Agent Service", await self.request(path))
        schema = json.loads(await self.request("/openapi.json"))
        self.assertIn("get", schema["paths"]["/health"])
