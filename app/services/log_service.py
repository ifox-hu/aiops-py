"""日志查询服务

对齐 Java 版 QueryLogsTools：
- 提供 system-metrics / application-logs / database-slow-query / system-events 四个主题
- Mock 模式按下单条查询条件生成与告警关联的演示日志
- 真实模式暂未实现，直接返回明确的错误说明
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any, Dict, List
from zoneinfo import ZoneInfo

from loguru import logger

from app.config import config

_TIMEZONE = ZoneInfo("Asia/Shanghai")

VALID_REGIONS = ["ap-guangzhou", "ap-shanghai", "ap-beijing", "ap-chengdu"]
DEFAULT_REGION = "ap-guangzhou"


def get_available_log_topics() -> Dict[str, Any]:
    """返回可用日志主题，供 Agent 在查询前了解可选项。"""
    topics = [
        {
            "topic_name": "system-metrics",
            "description": "系统指标日志，包含 CPU、内存、磁盘使用率等系统资源监控数据",
            "example_queries": [
                "cpu_usage:>80",
                "memory_usage:>85",
                "disk_usage:>90",
                "level:WARN AND service:payment-service",
            ],
            "related_alerts": ["HighCPUUsage", "HighMemoryUsage", "HighDiskUsage"],
        },
        {
            "topic_name": "application-logs",
            "description": "应用日志，包含应用程序的错误日志、警告日志、慢请求日志、下游依赖调用日志等",
            "example_queries": [
                "level:ERROR",
                "level:FATAL",
                "http_status:500",
                "response_time:>3000",
                "slow",
                "downstream OR redis OR database OR mq",
            ],
            "related_alerts": ["ServiceUnavailable", "SlowResponse", "HighMemoryUsage"],
        },
        {
            "topic_name": "database-slow-query",
            "description": "数据库慢查询日志，包含执行时间较长的 SQL 查询，可用于分析数据库性能问题",
            "example_queries": ["query_time:>2", "table:orders", "query_type:SELECT", "*"],
            "related_alerts": ["SlowResponse", "ServiceUnavailable"],
        },
        {
            "topic_name": "system-events",
            "description": "系统事件日志，包含 Kubernetes Pod 重启、OOM Kill、容器崩溃等系统级事件",
            "example_queries": ["restart OR crash", "oom_kill", "event_type:PodRestart", "reason:OOMKilled"],
            "related_alerts": ["ServiceUnavailable", "HighMemoryUsage"],
        },
    ]
    return {
        "success": True,
        "topics": topics,
        "available_regions": VALID_REGIONS,
        "default_region": DEFAULT_REGION,
        "message": f"共有 {len(topics)} 个可用的日志主题。建议使用默认地域 'ap-guangzhou' 或省略 region 参数",
    }


def _entry(when: datetime, level: str, service: str, instance: str, message: str) -> Dict[str, Any]:
    return {
        "timestamp": when.strftime("%Y-%m-%d %H:%M:%S"),
        "level": level,
        "service": service,
        "instance": instance,
        "message": message,
    }


def _system_metrics_logs(now: datetime) -> List[Dict[str, Any]]:
    """系统指标日志：CPU、内存、磁盘三组演示数据。"""
    logs: List[Dict[str, Any]] = []
    for index in range(5):
        logs.append(
            _entry(
                now - timedelta(minutes=index * 2),
                "WARN",
                "payment-service",
                "pod-payment-service-7d8f9c6b5-x2k4m",
                f"CPU使用率过高: {92.0 - index * 1.5:.1f}%, 进程: java (PID: 1), 线程数: 245",
            )
        )
    for index in range(5):
        logs.append(
            _entry(
                now - timedelta(minutes=index * 3),
                "WARN",
                "order-service",
                "pod-order-service-5c7d8e9f1-m3n2p",
                f"内存使用率过高: {91.0 - index * 1.2:.1f}%, JVM堆内存: {3.8 - index * 0.1:.1f}GB/4GB",
            )
        )
    logs.append(
        _entry(
            now - timedelta(minutes=8),
            "WARN",
            "order-service",
            "pod-order-service-5c7d8e9f1-m3n2p",
            "频繁 Full GC 告警: 过去10分钟内发生 15 次 Full GC, 平均耗时 850ms, 建议检查内存泄漏",
        )
    )
    for index in range(3):
        logs.append(
            _entry(
                now - timedelta(minutes=index * 5),
                "WARN",
                "log-collector",
                "node-worker-01",
                f"磁盘使用率告警: /data 分区使用率 {85.0 + index * 2:.1f}%, 可用空间: {15.0 - index * 2:.1f}GB",
            )
        )
    return logs


def _application_logs(now: datetime) -> List[Dict[str, Any]]:
    """应用日志：错误日志、慢请求与下游依赖异常。"""
    logs: List[Dict[str, Any]] = [
        _entry(
            now - timedelta(minutes=5),
            "ERROR",
            "order-service",
            "pod-order-service-5c7d8e9f1-m3n2p",
            "数据库连接池耗尽: Cannot acquire connection from pool, active: 50/50, waiting: 23, timeout: 30000ms",
        ),
        _entry(
            now - timedelta(minutes=12),
            "FATAL",
            "order-service",
            "pod-order-service-5c7d8e9f1-m3n2p",
            "java.lang.OutOfMemoryError: Java heap space at "
            "com.example.order.service.OrderService.processLargeOrder(OrderService.java:156)",
        ),
        _entry(
            now - timedelta(minutes=7),
            "ERROR",
            "payment-service",
            "pod-payment-service-7d8f9c6b5-x2k4m",
            "Redis 连接超时: 无法连接到 Redis 集群, 节点: redis-cluster-01:6379, 超时: 3000ms",
        ),
        _entry(
            now - timedelta(minutes=9),
            "WARN",
            "order-service",
            "pod-order-service-5c7d8e9f1-m3n2p",
            "消息队列积压警告: 队列 order-process-queue 积压消息数: 15823, 消费速率下降",
        ),
    ]
    for index in range(3):
        logs.append(
            _entry(
                now - timedelta(minutes=3 + index),
                "ERROR",
                "user-service",
                "pod-user-service-8e9f0a1b2-k5j6h",
                f"HTTP 500 Internal Server Error: /api/v1/users/profile, 耗时: {5200 + index * 300}ms, "
                "错误: Database query timeout",
            )
        )
    for index in range(5):
        logs.append(
            _entry(
                now - timedelta(minutes=index * 2),
                "WARN",
                "user-service",
                "pod-user-service-8e9f0a1b2-k5j6h",
                f"慢请求警告: {'/api/v1/users/profile' if index % 2 == 0 else '/api/v1/users/orders'}, "
                f"响应时间: {4200 - index * 150}ms, 阈值: 3000ms",
            )
        )
    return logs


def _database_slow_query_logs(now: datetime) -> List[Dict[str, Any]]:
    """数据库慢查询日志。"""
    return [
        _entry(
            now - timedelta(minutes=3),
            "WARN",
            "mysql",
            "mysql-primary-01",
            "慢查询: SELECT * FROM orders WHERE user_id = ? AND status IN (?, ?, ?) ORDER BY created_at DESC "
            "LIMIT 100, 执行时间: 3.2s, 扫描行数: 1,245,678",
        ),
        _entry(
            now - timedelta(minutes=6),
            "WARN",
            "mysql",
            "mysql-primary-01",
            "慢查询: SELECT u.*, p.* FROM users u LEFT JOIN user_profiles p ON u.id = p.user_id "
            "WHERE u.last_login > ?, 执行时间: 2.8s, 全表扫描",
        ),
        _entry(
            now - timedelta(minutes=8),
            "WARN",
            "mysql",
            "mysql-primary-01",
            "慢查询: UPDATE orders SET status = ? WHERE created_at < ? AND status = ?, "
            "执行时间: 4.5s, 锁等待时间: 2.1s",
        ),
    ]


def _system_events_logs(now: datetime) -> List[Dict[str, Any]]:
    """系统事件日志：Pod 重启与 OOM Kill。"""
    return [
        _entry(
            now - timedelta(minutes=15),
            "WARN",
            "kubernetes",
            "kube-controller-manager",
            "Pod 重启事件: pod-order-service-5c7d8e9f1-m3n2p, 原因: OOMKilled, 容器退出码: 137, 重启次数: 3",
        ),
        _entry(
            now - timedelta(minutes=16),
            "ERROR",
            "kernel",
            "node-worker-02",
            "OOM Killer 触发: 进程 java (PID: 12345) 被杀死, 内存使用: 3.9GB, 内存限制: 4GB",
        ),
    ]


def _generic_logs(now: datetime, query: str, limit: int) -> List[Dict[str, Any]]:
    """通用兜底日志，与 Java 版行为一致。"""
    levels = ["ERROR", "WARN", "INFO"]
    logs: List[Dict[str, Any]] = []
    for index in range(min(limit, 10)):
        logs.append(
            _entry(
                now - timedelta(minutes=index),
                levels[index % 3],
                "generic-service",
                f"instance-{index}",
                f"日志消息 #{index}, 查询条件: {query}",
            )
        )
    return logs


def query_logs(log_topic: str, query: str = "", limit: int = 20, region: str = DEFAULT_REGION) -> Dict[str, Any]:
    """按主题查询日志，返回与 Java 版同构的结果结构。"""
    if not config.cls_mock_enabled:
        return {
            "success": False,
            "region": region,
            "log_topic": log_topic,
            "query": query,
            "logs": [],
            "total": 0,
            "message": "CLS 真实查询尚未实现，请启用 Mock 模式进行测试",
        }

    actual_limit = 20 if not limit or limit <= 0 else min(limit, 100)
    safe_query = (query or "").lower()
    topic = (log_topic or "system-metrics").lower()
    now = datetime.now(_TIMEZONE)

    if topic == "system-metrics":
        logs = _system_metrics_logs(now)
    elif topic == "application-logs":
        logs = _application_logs(now)
    elif topic == "database-slow-query":
        logs = _database_slow_query_logs(now)
    elif topic == "system-events":
        logs = _system_events_logs(now)
    else:
        logs = []

    if not logs:
        logs = _generic_logs(now, safe_query, actual_limit)

    if safe_query and topic == "system-metrics":
        selected = []
        if "cpu" in safe_query or ">80" in safe_query:
            selected.extend(log for log in logs if log["service"] == "payment-service")
        if any(term in safe_query for term in ("memory", ">85", "oom")):
            selected.extend(log for log in logs if log["service"] == "order-service")
        if "disk" in safe_query or "filesystem" in safe_query:
            selected.extend(log for log in logs if log["service"] == "log-collector")
        logs = selected or logs
    elif safe_query and topic == "application-logs":
        if "error" in safe_query or "fatal" in safe_query or "500" in safe_query:
            logs = [log for log in logs if log["level"] in ("ERROR", "FATAL")]
        elif "slow" in safe_query or "response_time" in safe_query or ">3000" in safe_query:
            logs = [log for log in logs if "慢请求" in log["message"]]

    if not safe_query:
        logs = logs[:5]
    logs = logs[:actual_limit]
    logger.info(f"日志查询完成: topic={log_topic}, 返回 {len(logs)} 条")

    return {
        "success": bool(logs),
        "mock": True,
        "region": region,
        "log_topic": log_topic,
        "query": query or "DEFAULT_QUERY",
        "logs": logs,
        "total": len(logs),
        "message": f"成功查询到 {len(logs)} 条日志" if logs else "未找到匹配的日志",
    }


async def query_configured_logs(log_topic: str, query: str = "", limit: int = 20,
                                region: str = DEFAULT_REGION) -> Dict[str, Any]:
    """Mock 使用本地日志，真实查询通过配置的 CLS MCP 服务。"""
    if config.cls_mock_enabled:
        return query_logs(log_topic, query, limit, region)

    from app.agent.mcp_client import get_mcp_tools_safely
    tools = await get_mcp_tools_safely(server_name="cls")
    tool = next((item for item in tools if item.name in ("query_logs", "queryLogs")), None)
    if tool is None:
        raise RuntimeError("CLS MCP 日志工具不可用，请检查 MCP_ENABLED 和 MCP_CLS_URL")
    result = await tool.ainvoke({
        "log_topic": log_topic, "query": query, "limit": max(1, min(limit, 100)), "region": region
    })
    if isinstance(result, list):
        result = "".join(block.get("text", "") for block in result if isinstance(block, dict))
    if isinstance(result, str):
        result = json.loads(result)
    if not isinstance(result, dict) or not result.get("success"):
        raise RuntimeError("CLS 查询失败或返回格式不兼容")
    return result
