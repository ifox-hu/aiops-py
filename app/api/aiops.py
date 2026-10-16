"""
AIOps 智能运维接口

同时提供两套流式接口：
- POST /api/aiops     Plan-Execute-Replan 结构化事件流（本项目的原生接口）
- POST /api/ai_ops    Java 版兼容接口，事件形如 {"type": "content|error|done", "data": "..."}
"""

import json
from uuid import uuid4
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse
from loguru import logger

from app.models.aiops import AIOpsRequest
from app.services.aiops_service import aiops_service

router = APIRouter()

import asyncio


@router.post("/aiops")
async def diagnose_stream(request: AIOpsRequest):
    """
    AIOps 故障诊断接口（流式 SSE）

    **功能说明：**
    - 自动获取当前系统的活动告警
    - 使用 Plan-Execute-Replan 模式进行智能诊断
    - 流式返回诊断过程和结果

    **SSE 事件类型：**

    1. `status` - 状态更新

    2. `plan` - 诊断计划制定完成

    3. `step_complete` - 步骤执行完成

    4. `report` - 最终诊断报告

    5. `complete` - 诊断完成

    6. `error` - 错误信息

    Args:
        request: AIOps 诊断请求

    Returns:
        SSE 事件流
    """
    session_id = request.session_id or "default"
    logger.info(f"[会话 {session_id}] 收到 AIOps 诊断请求（流式）")

    async def event_generator():
        try:
            async for event in aiops_service.diagnose(session_id=session_id):
                yield {
                    "event": "message",
                    "data": json.dumps(event, ensure_ascii=False)
                }

                if event.get("type") in ["complete", "error"]:
                    break

            logger.info(f"[会话 {session_id}] AIOps 诊断流式响应完成")

        except Exception as e:
            logger.opt(exception=True).error("[会话 {}] AIOps 诊断流式响应异常: {}", session_id, e)
            yield {
                "event": "message",
                "data": json.dumps({
                    "type": "error",
                    "stage": "exception",
                    "message": f"诊断异常: {str(e)}"
                }, ensure_ascii=False)
            }

    return EventSourceResponse(event_generator())


def _sse(payload: dict) -> str:
    """按 Java 版 SSE 格式输出消息帧。"""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post("/ai_ops")
async def ai_ops_stream():
    """Java 版兼容的 AI 智能运维接口（SSE 流式）。

    对齐 Java 版行为：先输出一段进度提示，再按 50 字符切分输出最终报告，
    事件类型只有 content / error / done。
    """
    logger.info("收到 AI 智能运维请求 - 启动多 Agent 协作流程")

    async def event_generator():
        try:
            yield _sse({"type": "content", "data": "正在读取告警并拆解任务...\n"})

            report = ""
            error_message = ""
            async for event in aiops_service.diagnose(session_id=str(uuid4())):
                event_type = event.get("type")
                if event_type == "report":
                    report = event.get("report", "") or ""
                elif event_type == "complete":
                    diagnosis = event.get("diagnosis") or {}
                    report = report or diagnosis.get("report", "") or ""
                elif event_type == "error":
                    error_message = event.get("message", "诊断流程失败")

            if error_message and not report:
                yield _sse({"type": "error", "data": error_message})
                yield _sse({"type": "done", "data": None})
                return

            if not report:
                yield _sse({"type": "content", "data": "多 Agent 流程已完成，但未能生成最终报告。"})
                yield _sse({"type": "done", "data": None})
                return

            yield _sse({"type": "content", "data": "\n\n" + "=" * 60 + "\n"})
            yield _sse({"type": "content", "data": "告警分析报告\n\n"})

            chunk_size = 50
            for index in range(0, len(report), chunk_size):
                yield _sse({"type": "content", "data": report[index:index + chunk_size]})

            yield _sse({"type": "content", "data": "\n" + "=" * 60 + "\n\n"})
            yield _sse({"type": "done", "data": None})
            logger.info("AI Ops 多 Agent 编排完成")

        except asyncio.CancelledError:  # noqa: TRY302 - 客户端断开
            logger.info("AI Ops 客户端已断开")
            raise
        except Exception as e:
            logger.opt(exception=True).error("AI Ops 多 Agent 协作失败: {}", e)
            yield _sse({"type": "error", "data": f"AI Ops 流程失败: {e}"})
            yield _sse({"type": "done", "data": None})

    headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream; charset=utf-8",
        headers=headers,
    )
