"""工具模块 - 供 Agent 调用的各种工具"""

from app.tools.knowledge_tool import retrieve_knowledge
from app.tools.time_tool import get_current_time
from app.tools.ops_tools import (
    get_available_log_topics,
    query_logs,
    query_prometheus_alerts,
)


def get_local_tools() -> list:
    """返回可用的本地工具列表（对齐 Java 版本地工具集合）。"""
    return [
        get_current_time,
        retrieve_knowledge,
        query_prometheus_alerts,
        get_available_log_topics,
        query_logs,
    ]


__all__ = [
    "retrieve_knowledge",
    "get_current_time",
    "query_prometheus_alerts",
    "get_available_log_topics",
    "query_logs",
    "get_local_tools",
]