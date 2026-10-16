"""Platform contracts and agent orchestration without external model calls."""

import importlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.runnables import RunnableLambda

from app.config import config
from app.core.llm_factory import llm_factory
from app.main import app
from app.services.aiops_service import AIOpsService
from app.services.rag_agent_service import RagAgentService
from app.services.vector_search_service import SearchResult, vector_search_service
from app.tools import get_local_tools, query_prometheus_alerts


def events(response):
    return [json.loads(line[5:].strip()) for line in response.text.splitlines()
            if line.startswith("data:")]


class ToolModel(FakeMessagesListChatModel):
    def bind_tools(self, tools, **kwargs):
        return self

    def with_structured_output(self, schema, **kwargs):
        payload = {
            "Plan": {"steps": ["Query current alerts"]},
            "Act": {"action": "respond"},
            "Response": {"response": "# Alert report\nMock alert evidence collected."},
        }[schema.__name__]
        return RunnableLambda(lambda _: schema(**payload))


def tool_model():
    return ToolModel(responses=[
        AIMessage(content="", tool_calls=[{
            "id": "alerts-1", "name": "query_prometheus_alerts", "args": {}
        }]),
        AIMessage(content="Mock alerts: HighCPUUsage, HighMemoryUsage, SlowResponse"),
    ])


class PlatformContracts(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        # 强制清空网关与中转凭据，保证测试不触发真实模型调用
        for name, value in {"upload_path": self.tmp.name, "mcp_enabled": False,
                            "prometheus_mock_enabled": True, "cls_mock_enabled": True,
                            "dashscope_api_key": "", "relay_api_key": ""}.items():
            context = patch.object(config, name, value)
            context.start()
            self.addCleanup(context.stop)

    def test_alert_contract_and_filtered_logs(self):
        alerts = self.client.get("/api/platform/alerts").json()
        self.assertTrue(alerts["mock"])
        self.assertEqual(len(alerts["alerts"]), 3)
        logs = self.client.get("/api/platform/logs", params={
            "topic": "system-metrics", "query": "memory_usage:>85"
        }).json()
        self.assertTrue(logs["mock"])
        self.assertTrue(logs["result"]["logs"])
        self.assertEqual({item["service"] for item in logs["result"]["logs"]}, {"order-service"})

    def test_document_directory_and_traversal(self):
        Path(self.tmp.name, "guide.md").write_text("# Guide", encoding="utf-8")
        docs = self.client.get("/api/platform/documents").json()
        self.assertEqual(docs[0]["name"], "guide.md")
        content = self.client.get("/api/platform/documents/content", params={"name": "guide.md"})
        self.assertEqual(content.json()["content"], "# Guide")
        self.assertEqual(self.client.get("/api/platform/documents/content", params={"name": "../.env"}).status_code, 404)

    def test_upload_reports_index_failure(self):
        with patch("app.api.file.vector_index_service.index_single_file", side_effect=RuntimeError("no embeddings")):
            result = self.client.post("/api/upload", files={"file": ("guide.md", b"# Guide")})
        self.assertEqual(result.status_code, 500)
        self.assertIn("向量索引失败", result.json()["detail"])
        self.assertEqual(Path(self.tmp.name, "guide.md").read_bytes(), b"# Guide")

    def test_upload_validation_does_not_erase_existing_file(self):
        path = Path(self.tmp.name, "guide.md")
        path.write_bytes(b"original")
        result = self.client.post("/api/upload", files={"file": ("guide.md", b"")})
        self.assertEqual(result.status_code, 400)
        self.assertEqual(path.read_bytes(), b"original")

    def test_upload_success_and_custom_directory(self):
        with patch("app.api.file.vector_index_service.index_single_file") as index:
            result = self.client.post("/api/upload", files={"file": ("guide.markdown", b"# Guide")})
        self.assertEqual(result.json()["code"], 200)
        self.assertEqual(Path(index.call_args.args[0]).parent, Path(self.tmp.name))

    def test_missing_key_produces_one_clear_error(self):
        for url, body in (("/api/chat_stream", {"Id": "test", "Question": "alerts"}),
                          ("/api/platform/knowledge/stream", {"question": "alerts"}),
                          ("/api/ai_ops", {})):
            result = self.client.post(url, json=body)
            self.assertIn("text/event-stream", result.headers["content-type"])
            errors = [event for event in events(result) if event["type"] == "error"]
            self.assertEqual(len(errors), 1, url)
            self.assertIn("RELAY_API_KEY", errors[0]["data"])

    def test_knowledge_recall_sources_content_done_and_general_mode(self):
        async def chunks(_messages):
            yield AIMessageChunk(content="Answer ")
            yield AIMessageChunk(content="from evidence")

        model = SimpleNamespace(astream=chunks)
        source = SearchResult("doc-1", "Evidence", 0.2, {"_file_name": "guide.md"})
        with patch.object(config, "relay_api_key", "sk-test"), \
             patch.object(llm_factory, "create_chat_model", return_value=model), \
             patch.object(vector_search_service, "search_similar_documents", return_value=[source]) as search:
            result = events(self.client.post("/api/platform/knowledge/stream", json={"question": "alerts"}))
            self.assertEqual([event["type"] for event in result], ["sources", "content", "content", "done"])
            self.assertEqual(json.loads(result[0]["data"][0]["metadata"])["_file_name"], "guide.md")
            self.assertEqual(result[-1]["data"], "Answer from evidence")
            search.reset_mock()
            general = events(self.client.post("/api/platform/knowledge/stream", json={"question": "hello", "mode": "general"}))
            search.assert_not_called()
            self.assertEqual(general[0]["data"], [])

    def test_real_log_failure_is_not_replaced_with_mock_data(self):
        with patch.object(config, "cls_mock_enabled", False):
            result = self.client.get("/api/platform/logs")
        self.assertEqual(result.status_code, 502)

    def test_java_diagnosis_stream_delivers_report_then_done(self):
        async def diagnose(**kwargs):
            yield {"type": "report", "report": "# Report\n" + "Evidence " * 30}
            yield {"type": "complete", "diagnosis": {"report": "# Report"}}

        with patch("app.api.aiops.aiops_service.diagnose", side_effect=diagnose):
            result = events(self.client.post("/api/ai_ops"))
        self.assertEqual(result[-1]["type"], "done")
        self.assertIn("Evidence " * 30, "".join(item.get("data") or "" for item in result))
        self.assertFalse(any(item["type"] == "error" for item in result))

    def test_milvus_failure_returns_unavailable(self):
        with patch("app.api.health.utility.list_collections", side_effect=RuntimeError("offline")):
            result = self.client.get("/milvus/health")
        self.assertEqual(result.status_code, 503)


class AgentFlows(unittest.IsolatedAsyncioTestCase):
    async def test_react_agent_success_stream(self):
        with patch.object(config, "mcp_enabled", False), \
             patch.object(config, "prometheus_mock_enabled", True), \
             patch.object(llm_factory, "create_chat_model", return_value=tool_model()):
            result = [event async for event in RagAgentService().query_stream("alerts", "stream")]
        self.assertEqual(result[-1]["type"], "complete")
        self.assertIn("HighCPUUsage", "".join(event.get("data", "") for event in result))

    async def test_react_agent_calls_local_alert_tool_and_preserves_session(self):
        with patch.object(config, "mcp_enabled", False), \
             patch.object(config, "prometheus_mock_enabled", True), \
             patch.object(llm_factory, "create_chat_model", return_value=tool_model()):
            service = RagAgentService()
            answer = await service.query("Current alerts?", "test")
            self.assertIn("HighCPUUsage", answer)
            state = await service.agent.aget_state({"configurable": {"thread_id": "test"}})
            self.assertTrue(any(getattr(msg, "name", "") == "query_prometheus_alerts" for msg in state.values["messages"]))
            self.assertTrue(service.get_session_history("test"))
            self.assertTrue(service.clear_session("test"))
            self.assertEqual(service.get_session_history("test"), [])

    async def test_plan_execute_replan_outputs_report(self):
        planner = importlib.import_module("app.agent.aiops.planner")
        with patch.object(config, "mcp_enabled", False), \
             patch.object(config, "prometheus_mock_enabled", True), \
             patch.object(config, "relay_api_key", "sk-test"), \
             patch.object(planner, "retrieve_knowledge", SimpleNamespace(ainvoke=AsyncMock(return_value=""))), \
             patch.object(llm_factory, "create_chat_model", return_value=tool_model()):
            result = [event async for event in AIOpsService().diagnose("run")]
        self.assertEqual([event["type"] for event in result], ["plan", "step_complete", "report", "complete"])
        self.assertIn("Mock alert evidence", result[-1]["diagnosis"]["report"])

    async def test_async_alert_tool(self):
        with patch.object(config, "prometheus_mock_enabled", True):
            payload = json.loads(await query_prometheus_alerts.ainvoke({}))
        self.assertTrue(payload["mock"])
        self.assertEqual(len(payload["alerts"]), 3)


if __name__ == "__main__":
    unittest.main()
