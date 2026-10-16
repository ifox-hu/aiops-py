"""平台视图与知识问答接口

对齐 Java 版 PlatformController：
- GET  /api/platform/alerts              活动告警（含 mock 标记）
- GET  /api/platform/logs                日志查询
- GET  /api/platform/documents           上传目录中的文档列表
- GET  /api/platform/documents/content   按文件名读取文档内容
- POST /api/platform/knowledge/stream    知识库优先 / 通用问答（SSE）

SSE 事件格式与 Java 版一致：{"type": "sources|content|done|error", "data": ...}
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel, Field

from app.config import config
from app.services.alert_service import query_alerts
from app.services.log_service import DEFAULT_REGION, query_configured_logs
from app.services.platform_rag_service import platform_rag_service

router = APIRouter()

_DOCUMENT_PATTERN = re.compile(r".*\.(md|markdown|txt)$", re.IGNORECASE)
_MAX_HISTORY_MESSAGES = 12
_MAX_HISTORY_CHARS = 16000


class KnowledgeRequest(BaseModel):
    """知识问答请求，字段与 Java 版 KnowledgeRequest 对齐。"""

    question: str = Field(default="", description="用户问题")
    history: Optional[List[Dict[str, str]]] = Field(default=None, description="对话历史")
    mode: str = Field(default="knowledge", description="knowledge 或 general")


def _upload_root() -> Path:
    return Path(config.upload_path).resolve()


def _to_iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _sse(payload: Dict[str, Any]) -> str:
    """把事件序列化为 SSE 帧，前端按 data: 行解析。"""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.get("/alerts")
async def alerts() -> Dict[str, Any]:
    """返回活动告警，并显式标注数据来源。"""
    try:
        return await query_alerts()
    except Exception as error:  # noqa: BLE001 - 对外返回统一错误
        logger.error(f"告警查询失败: {error}")
        raise HTTPException(status_code=502, detail="告警查询失败") from error


@router.get("/logs")
async def logs(
    topic: str = Query(default="application-logs"),
    query: str = Query(default=""),
    limit: int = Query(default=20),
    region: str = Query(default=DEFAULT_REGION),
) -> Dict[str, Any]:
    """按主题查询日志，返回值中带 mock 标记。"""
    try:
        result = await query_configured_logs(log_topic=topic, query=query, limit=limit, region=region)
    except Exception as error:
        logger.error("日志查询失败: {}", error)
        raise HTTPException(status_code=502, detail="日志查询失败，请检查 CLS MCP 服务配置") from error
    return {"mock": config.cls_mock_enabled, "result": result}


@router.get("/documents")
async def documents() -> List[Dict[str, Any]]:
    """列出上传目录中可用的知识文档。"""
    root = _upload_root()
    if not root.exists():
        return []

    items: List[Dict[str, Any]] = []
    for path in sorted(root.iterdir()):
        if not path.is_file() or not _DOCUMENT_PATTERN.fullmatch(path.name):
            continue
        stat = path.stat()
        items.append(
            {
                "name": path.name,
                "size": stat.st_size,
                "updatedAt": _to_iso(stat.st_mtime),
            }
        )
    return items


@router.get("/documents/content")
async def document_content(name: str = Query(...)) -> Dict[str, str]:
    """按文件名读取文档内容，拒绝目录穿越。"""
    root = _upload_root()
    target = (root / name).resolve()
    if target.parent != root or not target.is_file() or not _DOCUMENT_PATTERN.fullmatch(name):
        raise HTTPException(status_code=404, detail="文档不存在")
    return {"name": name, "content": target.read_text(encoding="utf-8")}


@router.post("/knowledge/stream")
async def knowledge_stream(request: KnowledgeRequest) -> StreamingResponse:
    """知识库优先或通用问答，以 SSE 返回 sources / content / done。"""
    question = (request.question or "").strip()
    if not question or len(question) > 1000:
        raise HTTPException(status_code=400, detail="问题需为 1–1000 个字符")

    # 只接受受限的对话窗口，且不接受客户端传入的系统提示。
    history: List[Dict[str, str]] = []
    for message in (request.history or [])[-_MAX_HISTORY_MESSAGES:]:
        role = message.get("role")
        content = message.get("content")
        if role in ("user", "assistant") and content:
            history.append({"role": role, "content": content[:_MAX_HISTORY_CHARS]})

    mode = (request.mode or "knowledge").lower()

    async def event_source():
        queue: asyncio.Queue[Optional[Dict[str, Any]]] = asyncio.Queue()

        async def run() -> None:
            try:
                async for event in platform_rag_service.query_stream(
                    question=question, history=history, mode=mode
                ):
                    await queue.put(event)
            except Exception as error:  # noqa: BLE001 - 与 Java 版一致，统一转为 error 事件
                logger.error(f"知识问答失败: {error}")
                await queue.put(
                    {"type": "error", "data": "知识问答失败，请检查模型与向量服务后重试。"}
                )
            finally:
                await queue.put(None)

        task = asyncio.create_task(run())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield _sse(event)
        finally:
            if not task.done():
                task.cancel()

    headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    return StreamingResponse(
        event_source(),
        media_type="text/event-stream; charset=utf-8",
        headers=headers,
    )
