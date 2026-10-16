"""共享工具装配

对齐 Java 版的工具装配方式：
- 本地方法工具（时间、内部文档、Prometheus 告警、日志）始终可用
- MCP 服务提供的工具在其可用时合并进来

MCP 服务未启动或依赖版本不匹配时，Agent 仍能基于本地工具完成告警与日志查询，
因此工作台的「开始智能诊断」在 Mock 模式下可以独立跑通。
"""

from __future__ import annotations

from typing import Any, List

from loguru import logger

from app.agent.mcp_client import get_available_tools, get_mcp_tools_safely
from app.tools import get_local_tools


async def build_agent_tools() -> List[Any]:
    """返回本地工具 + MCP 工具（MCP 不可用时自动降级）。"""
    return await get_available_tools(get_local_tools())


def log_tools(tools: List[Any]) -> None:
    """记录可用工具名称，便于排查工具未生效的问题。"""
    if not tools:
        logger.warning("当前没有可用工具")
        return
    names = [getattr(tool, "name", str(tool)) for tool in tools]
    logger.info(f"可用工具列表: {', '.join(names)}")


__all__ = ["build_agent_tools", "get_mcp_tools_safely", "log_tools"]
