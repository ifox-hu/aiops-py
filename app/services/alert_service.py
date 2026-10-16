"""告警查询服务

对齐 Java 版 QueryMetricsTools：
- Mock 模式返回与 aiops-docs 对应的三条演示告警
- 真实模式调用 Prometheus /api/v1/alerts，并按 alertname 去重
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import httpx
from loguru import logger

from app.config import config


def _format_duration(active_at: str) -> str:
    """把 activeAt 时间字符串转换为 Java 版同款的持续时长文本。"""
    try:
        normalized = active_at.replace("Z", "+00:00")
        started = datetime.fromisoformat(normalized)
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - started
    except Exception as error:  # noqa: BLE001 - 与 Java 版一致，解析失败时降级
        logger.warning(f"解析告警时间失败: {active_at}, 错误: {error}")
        return "unknown"

    total_seconds = max(0, int(delta.total_seconds()))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}h{minutes}m{seconds}s"
    if minutes:
        return f"{minutes}m{seconds}s"
    return f"{seconds}s"


def _mock_alerts() -> List[Dict[str, Any]]:
    """构建 Mock 告警数据，与 aiops-docs 文档中的告警类型对应。"""
    now = datetime.now(timezone.utc)

    specs = [
        (
            "HighCPUUsage",
            "服务 payment-service 的 CPU 使用率持续超过 80%，当前值为 92%。"
            "实例: pod-payment-service-7d8f9c6b5-x2k4m，命名空间: production",
            25,
        ),
        (
            "HighMemoryUsage",
            "服务 order-service 的内存使用率持续超过 85%，当前值为 91%。"
            "JVM堆内存使用: 3.8GB/4GB，可能存在内存泄漏风险。"
            "实例: pod-order-service-5c7d8e9f1-m3n2p，命名空间: production",
            15,
        ),
        (
            "SlowResponse",
            "服务 user-service 的 P99 响应时间持续超过 3 秒，当前值为 4.2 秒。"
            "受影响接口: /api/v1/users/profile, /api/v1/users/orders。"
            "可能原因：数据库慢查询或下游服务延迟",
            10,
        ),
    ]

    alerts: List[Dict[str, Any]] = []
    for alert_name, description, minutes in specs:
        active_at = now - timedelta(minutes=minutes)
        active_at_text = active_at.isoformat().replace("+00:00", "Z")
        alerts.append(
            {
                "alert_name": alert_name,
                "description": description,
                "state": "firing",
                "active_at": active_at_text,
                "duration": _format_duration(active_at_text),
            }
        )
    return alerts


async def _fetch_prometheus_alerts() -> List[Dict[str, Any]]:
    """调用 Prometheus 告警接口并按 alertname 去重。"""
    url = f"{config.prometheus_base_url.rstrip('/')}/api/v1/alerts"
    logger.debug(f"请求 Prometheus API: {url}")
    async with httpx.AsyncClient(timeout=config.prometheus_timeout) as client:
        response = await client.get(url)
        response.raise_for_status()
        payload = response.json()

    if payload.get("status") != "success":
        raise RuntimeError(f"Prometheus API 返回非成功状态: {payload.get('status')}")

    alerts: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for alert in payload.get("data", {}).get("alerts", []):
        labels = alert.get("labels") or {}
        alert_name = labels.get("alertname")
        if not alert_name or alert_name in seen:
            continue
        seen.add(alert_name)
        active_at = alert.get("activeAt", "")
        alerts.append(
            {
                "alert_name": alert_name,
                "description": (alert.get("annotations") or {}).get("description", ""),
                "state": alert.get("state", "firing"),
                "active_at": active_at,
                "duration": _format_duration(active_at),
            }
        )
    return alerts


async def query_alerts() -> Dict[str, Any]:
    """返回告警列表，并显式标注数据来源是否为 Mock。"""
    mock = config.prometheus_mock_enabled
    if mock:
        alerts = _mock_alerts()
    else:
        alerts = await _fetch_prometheus_alerts()

    return {
        "mock": mock,
        "alerts": alerts,
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }