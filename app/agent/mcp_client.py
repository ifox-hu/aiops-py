"""
MCP 客户端管理
提供全局单例的 MCP 客户端，避免重复初始化

对齐 Java 版的工具装配方式：
- 本地方法工具（时间、内部文档、告警、日志）始终可用，`cls.mock-enabled=true` 时日志查询走本地 Mock
- MCP 服务提供的工具在其可用时合并进来，不可用时降级为「仅本地工具」而不是让应用启动失败
"""

import asyncio
from typing import Optional, Dict, Any, List
from loguru import logger


# 全局 MCP 客户端（延迟初始化）
_mcp_client: Optional[Any] = None
_mcp_available: Optional[bool] = None

try:  # pragma: no cover - 依赖环境，导入失败时降级为本地工具模式
    from langchain_mcp_adapters.client import MultiServerMCPClient
    from langchain_mcp_adapters.interceptors import MCPToolCallRequest
    from mcp.types import CallToolResult, TextContent

    MCP_IMPORT_ERROR: Optional[str] = None
except Exception as _import_error:  # noqa: BLE001 - 兼容不同版本组合
    MultiServerMCPClient = None  # type: ignore[assignment]
    MCPToolCallRequest = None  # type: ignore[assignment]
    CallToolResult = None  # type: ignore[assignment]
    TextContent = None  # type: ignore[assignment]
    MCP_IMPORT_ERROR = str(_import_error)


def mcp_available() -> bool:
    """判断 MCP 适配层是否可用。"""
    return MultiServerMCPClient is not None


async def retry_interceptor(
    request: Any,
    handler,
    max_retries: int = 3,
    delay: float = 1.0,
):
    """MCP 工具调用重试拦截器

    当工具调用失败时，使用指数退避策略自动重试。
    如果所有重试都失败，返回包含错误信息的结果而不是抛出异常。
    """
    last_error = None

    for attempt in range(max_retries):
        try:
            logger.info(
                f"调用 MCP 工具: {request.name} "
                f"(服务器: {request.server_name}, 第 {attempt + 1}/{max_retries} 次尝试)"
            )
            result = await handler(request)
            logger.info(f"MCP 工具 {request.name} 调用成功")
            return result

        except Exception as e:
            last_error = e
            logger.warning(
                f"MCP 工具 {request.name} 调用失败 "
                f"(第 {attempt + 1}/{max_retries} 次): {str(e)}"
            )

            if attempt < max_retries - 1:
                wait_time = delay * (2 ** attempt)
                logger.info(f"等待 {wait_time:.1f} 秒后重试...")
                await asyncio.sleep(wait_time)

    error_msg = f"工具 {request.name} 在 {max_retries} 次重试后仍然失败: {str(last_error)}"
    logger.error(error_msg)
    return CallToolResult(
        content=[TextContent(type="text", text=error_msg)],
        isError=True
    )


# 从配置文件读取 MCP 服务器配置
from app.config import config

DEFAULT_MCP_SERVERS = config.mcp_servers


async def get_mcp_client(
    servers: Optional[Dict[str, Dict[str, str]]] = None,
    tool_interceptors: Optional[List] = None,
    force_new: bool = False
):
    """获取或初始化 MCP 客户端（不带重试拦截器）

    这是一个单例模式，确保整个应用只有一个 MCP 客户端实例（除非 force_new=True）。
    """
    global _mcp_client

    if not mcp_available():
        raise RuntimeError(f"MCP 适配层不可用: {MCP_IMPORT_ERROR}")

    if force_new:
        logger.info("创建新的 MCP 客户端实例（非单例）")
        return _create_mcp_client(servers or DEFAULT_MCP_SERVERS, tool_interceptors)

    if _mcp_client is None:
        logger.info("初始化全局 MCP 客户端...")
        _mcp_client = _create_mcp_client(servers or DEFAULT_MCP_SERVERS, tool_interceptors)
        logger.info("全局 MCP 客户端初始化完成")

    return _mcp_client


async def get_mcp_client_with_retry(
    servers: Optional[Dict[str, Dict[str, str]]] = None,
    tool_interceptors: Optional[List] = None,
    force_new: bool = False
):
    """获取或初始化带重试功能的 MCP 客户端"""
    interceptors = [retry_interceptor]
    if tool_interceptors:
        interceptors.extend(tool_interceptors)

    return await get_mcp_client(
        servers=servers,
        tool_interceptors=interceptors,
        force_new=force_new
    )


async def get_mcp_tools_safely(server_name: str | None = None) -> List[Any]:
    """安全地获取 MCP 工具列表。

    MCP 服务未启动、依赖版本不匹配或连接失败时返回空列表，
    保证 Agent 仍可基于本地工具运行。
    """
    global _mcp_available

    if not config.mcp_enabled:
        return []
    if not mcp_available():
        if _mcp_available is not False:
            logger.warning(f"MCP 适配层不可用，仅使用本地工具: {MCP_IMPORT_ERROR}")
            _mcp_available = False
        return []

    try:
        client = await get_mcp_client_with_retry()
        if server_name:
            tools = await asyncio.wait_for(
                client.get_tools(server_name=server_name), config.mcp_connect_timeout
            )
        else:
            results = await asyncio.gather(
                *(asyncio.wait_for(client.get_tools(server_name=name), config.mcp_connect_timeout)
                  for name in config.mcp_servers),
                return_exceptions=True,
            )
            tools = []
            for result in results:
                if isinstance(result, BaseException):
                    logger.warning("MCP 服务加载失败: {}", result)
                else:
                    tools.extend(result)
        if _mcp_available is not True:
            logger.info(f"MCP 工具加载成功，共 {len(tools)} 个")
            _mcp_available = True
        return list(tools)
    except Exception as error:  # noqa: BLE001 - MCP 不可用时降级
        if _mcp_available is not False:
            logger.warning(f"MCP 工具加载失败，仅使用本地工具: {error}")
            _mcp_available = False
        return []


async def get_available_tools(local_tools: List[Any]) -> List[Any]:
    """合并本地工具与 MCP 工具，MCP 不可用时只返回本地工具。"""
    mcp_tools = await get_mcp_tools_safely()
    if mcp_tools:
        logger.info(f"可用工具数量: 本地 {len(local_tools)} + MCP {len(mcp_tools)}")
    else:
        logger.info(f"可用工具数量: 本地 {len(local_tools)}（MCP 未接入）")
    merged = {tool.name: tool for tool in mcp_tools}
    merged.update({tool.name: tool for tool in local_tools})
    return list(merged.values())


def _create_mcp_client(
    servers: Dict[str, Dict[str, str]],
    tool_interceptors: Optional[List] = None
):
    """创建 MCP 客户端实例"""
    kwargs: Dict[str, Any] = {}

    if tool_interceptors:
        kwargs["tool_interceptors"] = tool_interceptors

    return MultiServerMCPClient(servers, **kwargs)  # type: ignore[arg-type]
