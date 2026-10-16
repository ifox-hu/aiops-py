"""配置管理模块

使用 Pydantic Settings 实现类型安全的配置管理
"""

from typing import Dict, Any
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置"""

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # 应用配置
    app_name: str = "SuperBizAgent"
    app_version: str = "1.0.0"
    debug: bool = False
    host: str = "0.0.0.0"
    port: int = 9900

    # DashScope 配置
    dashscope_api_key: str = ""  # 默认空字符串，实际使用需从环境变量加载
    dashscope_api_base: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    dashscope_model: str = "qwen-max"
    dashscope_embedding_model: str = "text-embedding-v4"  # v4 支持多种维度（默认 1024）

    # 聊天中转配置；未设置时沿用 DashScope，向量化仍使用独立的 DashScope 配置。
    relay_api_key: str = ""
    relay_base_url: str = "https://api.apigoto.com/v1"

    # 向量化配置：与聊天模型相互独立，默认使用本地 Ollama，对齐 Java 版
    embedding_provider: str = "ollama"  # ollama 或 dashscope
    ollama_base_url: str = "http://127.0.0.1:11435"
    ollama_embedding_model: str = "bge-m3"

    # 向量维度（bge-m3 与 text-embedding-v4 均支持 1024）
    embedding_dimensions: int = 1024

    # Milvus 配置
    milvus_host: str = "localhost"
    milvus_port: int = 19530
    milvus_timeout: int = 10000  # 毫秒

    # 结构化输出方式：auto 会按 json_schema -> function_calling -> json_mode 依次尝试。
    # 部分推理型模型（如 deepseek-flash 思考模式）不接受强制 tool_choice。
    structured_output_method: str = "auto"

    # RAG 配置
    rag_top_k: int = 3
    rag_model: str = "qwen-max"  # 使用快速响应模型，不带扩展思考

    # 文档分块配置
    chunk_max_size: int = 800
    chunk_overlap: int = 100

    # 文件上传配置
    upload_path: str = "./uploads"

    # Prometheus 告警配置（对齐 Java 版 prometheus.* 配置）
    prometheus_base_url: str = "http://localhost:9090"
    prometheus_timeout: int = 10  # 秒
    prometheus_mock_enabled: bool = True  # 是否启用 Mock 模式

    # CLS 日志配置（对齐 Java 版 cls.* 配置）
    cls_mock_enabled: bool = True  # 是否启用 Mock 模式
    cls_default_region: str = "ap-guangzhou"

    # MCP 服务配置
    mcp_enabled: bool = False
    mcp_connect_timeout: int = 10
    mcp_cls_transport: str = "streamable-http"
    mcp_cls_url: str = "http://localhost:8003/mcp"
    mcp_monitor_transport: str = "streamable-http"
    mcp_monitor_url: str = "http://localhost:8004/mcp"

    @property
    def mcp_servers(self) -> Dict[str, Dict[str, Any]]:
        """获取完整的 MCP 服务器配置"""
        return {
            "cls": {
                "transport": self.mcp_cls_transport,
                "url": self.mcp_cls_url,
            },
            "monitor": {
                "transport": self.mcp_monitor_transport,
                "url": self.mcp_monitor_url,
            }
        }


# 全局配置实例
config = Settings()
