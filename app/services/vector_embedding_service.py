"""向量嵌入服务模块 - 基于 LangChain Embeddings 标准接口

对齐 Java 版 VectorEmbeddingService：向量服务与聊天模型相互独立，
可通过 EMBEDDING_PROVIDER 选择本地 Ollama（默认，bge-m3 输出 1024 维）
或阿里云 DashScope text-embedding-v4。
"""

from typing import List

from langchain_core.embeddings import Embeddings
from openai import OpenAI
from loguru import logger

from app.config import config

PLACEHOLDER_API_KEYS = {"", "your-api-key-here", "sk-xxx"}


class _OpenAICompatibleEmbeddings(Embeddings):
    """OpenAI 兼容嵌入实现的公共部分。

    客户端延迟初始化，应用启动阶段缺少凭据也能正常导入；只有真正需要
    向量化时才创建连接。返回维度与配置不一致时直接报错，避免把错误维度
    的向量写入 Milvus 之后才发现问题。
    """

    provider_name = "openai-compatible"

    def __init__(
        self,
        api_key: str,
        model: str,
        dimensions: int,
        base_url: str,
    ):
        self.api_key = api_key or ""
        self.model = model
        self.dimensions = dimensions
        self.base_url = base_url
        self._client: OpenAI | None = None

    def is_configured(self) -> bool:
        """判断当前提供方是否具备调用条件。"""
        return True

    @property
    def client(self) -> OpenAI:
        """按需创建 OpenAI 兼容客户端。"""
        if not self.is_configured():
            raise RuntimeError("向量化服务未正确配置，无法生成向量")
        if self._client is None:
            self._client = OpenAI(
                api_key=self.api_key or "not-required", base_url=self.base_url
            )
        return self._client

    def _create_embeddings(self, inputs):
        response = self.client.embeddings.create(
            model=self.model,
            input=inputs,
            dimensions=self.dimensions,
            encoding_format="float",
        )
        embeddings = [list(item.embedding) for item in response.data]
        if len(embeddings) != len(inputs):
            raise RuntimeError(
                f"{self.provider_name} 嵌入返回条数与请求不一致: "
                f"请求 {len(inputs)} 条, 返回 {len(embeddings)} 条"
            )
        actual_dim = len(embeddings[0]) if embeddings else 0
        if actual_dim != self.dimensions:
            raise RuntimeError(
                f"{self.provider_name} 嵌入维度不匹配: 模型 {self.model} 返回 "
                f"{actual_dim} 维, 配置要求 {self.dimensions} 维。"
                f"请调整 EMBEDDING_DIMENSIONS 或更换模型。"
            )
        return embeddings

    def embed_documents(self, texts):
        """批量嵌入文档列表 (LangChain 标准接口)"""
        if not texts:
            return []

        try:
            logger.info(f"批量嵌入 {len(texts)} 个文档")
            embeddings = self._create_embeddings(list(texts))
            logger.debug(f"批量嵌入完成, 维度: {len(embeddings[0])}")
            return embeddings

        except Exception as e:
            logger.error(f"批量嵌入失败: {e}")
            raise RuntimeError(f"批量嵌入失败: {e}") from e

    def embed_query(self, text):
        """嵌入单个查询文本 (LangChain 标准接口)"""
        if not text or not text.strip():
            raise ValueError("查询文本不能为空")

        try:
            logger.debug(f"嵌入查询, 长度: {len(text)} 字符")
            embedding = self._create_embeddings([text])[0]
            logger.debug(f"查询嵌入完成, 维度: {len(embedding)}")
            return embedding

        except Exception as e:
            logger.error(f"查询嵌入失败: {e}")
            raise RuntimeError(f"查询嵌入失败: {e}") from e


class OllamaEmbeddings(_OpenAICompatibleEmbeddings):
    """本地 Ollama 向量服务（OpenAI 兼容模式），对齐 Java 版默认配置。

    Java 版通过 embedding.provider=ollama 使用 bge-m3，输出 1024 维，
    与现有 Milvus 集合结构一致。
    """

    provider_name = "Ollama"

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:11435",
        model: str = "bge-m3",
        dimensions: int = 1024,
    ):
        normalized = base_url.rstrip("/")
        if not normalized.endswith("/v1"):
            normalized = f"{normalized}/v1"
        super().__init__(
            api_key="ollama",
            model=model,
            dimensions=dimensions,
            base_url=normalized,
        )
        logger.info(
            f"本地向量模型已配置: 模型 {model}, 地址 {normalized}, 目标维度 {dimensions}"
        )


def create_vector_embedding_service():
    """按 EMBEDDING_PROVIDER 创建向量化服务，默认使用本地 Ollama。"""
    provider = (config.embedding_provider or "ollama").strip().lower()
    if provider == "ollama":
        return OllamaEmbeddings(
            base_url=config.ollama_base_url,
            model=config.ollama_embedding_model,
            dimensions=config.embedding_dimensions,
        )
    if provider == "dashscope":
        return DashScopeEmbeddings(
            api_key=config.dashscope_api_key,
            model=config.dashscope_embedding_model,
            dimensions=config.embedding_dimensions,
        )
    raise RuntimeError(f"不支持的 EMBEDDING_PROVIDER: {config.embedding_provider}")


class DashScopeEmbeddings(_OpenAICompatibleEmbeddings):
    """阿里云 DashScope Text Embedding (OpenAI 兼容模式)。"""

    provider_name = "DashScope"

    def __init__(
        self,
        api_key: str,
        model: str = "text-embedding-v4",
        dimensions: int = 1024,
        base_url: str | None = None,
    ):
        super().__init__(
            api_key=api_key,
            model=model,
            dimensions=dimensions,
            base_url=base_url or config.dashscope_api_base,
        )
        if self.is_configured():
            logger.info(
                f"DashScope Embeddings 初始化完成 - 模型: {model}, 维度: {dimensions}"
            )
        else:
            logger.warning(
                "DashScope Embeddings 未配置 API Key，向量化调用将失败；"
                "如需知识库检索请设置 DASHSCOPE_API_KEY"
            )

    def is_configured(self) -> bool:
        """判断是否已配置可用的 API Key。"""
        return self.api_key.strip() not in PLACEHOLDER_API_KEYS


# 全局单例
vector_embedding_service = create_vector_embedding_service()
