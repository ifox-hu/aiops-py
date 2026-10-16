"""运维工具集

对齐 Java 版 agent/tool 下的工具，让 Agent 在本地 Mock 模式下也能查询告警与日志：
- query_prometheus_alerts    查询活动告警（Prometheus 或 Mock）
- get_available_log_topics   列出可用日志主题
- query_logs                 按主题查询日志
"""

from __future__ import annotations

import json

from langchain_core.tools import tool
from loguru import logger

from app.services.alert_service import query_alerts
from app.services.log_service import DEFAULT_REGION, get_available_log_topics as _topics, query_logs as _query_logs


@tool
async def query_prometheus_alerts() -> str:
    """查询当前活动告警。

    当需要了解系统当前有哪些告警、排查告警根因或核对告警状态时使用此工具。
    返回 JSON 字符串，包含 success、alerts 与 message 字段；alerts 中的每项包含
    alert_name、description、state、active_at 和 duration。
    """
    try:
        payload = await _run_query_alerts()
        return json.dumps(payload, ensure_ascii=False, indent=2)
    except Exception as error:  # noqa: BLE001 - 工具失败时返回可读错误
        logger.error(f"查询告警失败: {error}")
        return json.dumps({"success": False, "message": f"查询失败: {error}"}, ensure_ascii=False)


async def _run_query_alerts():
    result = await query_alerts()
    return {
        "success": True,
        "alerts": result.get("alerts", []),
        "mock": result.get("mock", False),
        "message": f"成功检索到 {len(result.get('alerts', []))} 个活动告警",
    }


@tool
def get_available_log_topics() -> str:
    """获取所有可用的日志主题及其说明。

    查询日志前先调用此工具，了解有哪些日志主题可用。
    """
    return json.dumps(_topics(), ensure_ascii=False, indent=2)


@tool
async def query_logs(log_topic: str, query: str = "", limit: int = 20, region: str = DEFAULT_REGION) -> str:
    """从日志服务查询日志。

    可用日志主题：system-metrics（CPU/内存/磁盘等系统指标）、application-logs（应用错误与慢请求）、
    database-slow-query（数据库慢查询）、system-events（Pod 重启、OOM Kill 等系统事件）。

    Args:
        log_topic: 日志主题名称。
        query: 查询条件，支持 Lucene 语法，如 level:ERROR；为空时返回该主题核心日志。
        limit: 返回日志条数，默认 20，最大 100。
        region: 地域，默认 ap-guangzhou。
    """
    try:
        from app.services.log_service import query_configured_logs
        result = await query_configured_logs(log_topic=log_topic, query=query, limit=limit, region=region)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except Exception as error:  # noqa: BLE001 - 工具失败时返回可读错误
        logger.error(f"查询日志失败: {error}")
        return json.dumps({"success": False, "message": f"查询失败: {error}"}, ensure_ascii=False)
