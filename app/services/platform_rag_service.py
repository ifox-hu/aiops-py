"""知识库优先 / 通用问答的流式服务

对齐 Java 版 RagService：
- knowledge 模式：先检索向量库，再带着召回片段调用聊天模型；资料不足时回退通用知识
- general 模式：跳过检索，直接调用聊天模型
- 以 SSE 事件流返回 sources / content / done，score 为 Milvus L2 距离
"""

from __future__ import annotations

import json
import asyncio
from typing import Any, AsyncGenerator, Dict, List, Sequence

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from loguru import logger

from app.config import config
from app.core.llm_factory import llm_factory, require_model_key
from app.services.vector_search_service import SearchResult, vector_search_service

_KNOWLEDGE_SYSTEM_PROMPT = """你是一个专业的AI助手。请优先依据以下参考资料回答用户的问题。

参考资料：
{context}

用户问题：{question}

回答要求：
1. 如果参考资料能够直接回答该问题，请以资料为准，给出准确、详细的回答，并说明依据来自参考资料。
2. 如果参考资料与该问题无关或不足以回答，请直接使用通用知识回答，并在开头注明“知识库中没有检索到直接相关资料，以下内容来自通用知识”。
3. 不要因为资料不足而拒绝回答；不要把参考资料中没有的信息说成来自资料。
"""

_FALLBACK_SYSTEM_PROMPT = """知识库中没有检索到与该问题相关的资料。请直接使用你的通用知识回答用户问题，并在回答开头用一句话说明“知识库未命中，以下内容来自通用知识”。如果问题涉及实时信息或你无法确认的事实，请明确说明不确定性，不要编造。

用户问题：{question}
"""

_GENERAL_SYSTEM_PROMPT = """你是一个通用 AI 助手。请直接回答用户问题；可以结合对话历史理解上下文。如果问题要求实时信息或你无法确认事实，请明确说明不确定性，不要编造。

用户问题：{question}
"""


class PlatformRagService:
    """为平台知识问答接口提供流式生成能力。"""

    @staticmethod
    def _build_context(results: Sequence[SearchResult]) -> str:
        parts: List[str] = []
        for index, result in enumerate(results, 1):
            parts.append(f"【参考资料 {index}】\n{result.content}\n")
        return "\n".join(parts)

    @staticmethod
    def _serialize_sources(results: Sequence[SearchResult]) -> List[Dict[str, Any]]:
        """把召回片段转换为前端期望的结构，score 为 L2 距离。"""
        payload: List[Dict[str, Any]] = []
        for result in results:
            metadata = result.metadata
            if not isinstance(metadata, str):
                metadata = json.dumps(metadata or {}, ensure_ascii=False)
            payload.append(
                {
                    "id": result.id,
                    "content": result.content,
                    "metadata": metadata,
                    "score": result.score,
                }
            )
        return payload

    @staticmethod
    def _history_messages(history: Sequence[Dict[str, str]]) -> List[BaseMessage]:
        messages: List[BaseMessage] = []
        for message in history:
            role = message.get("role")
            content = message.get("content") or ""
            if not content:
                continue
            if role == "user":
                messages.append(HumanMessage(content=content))
            elif role == "assistant":
                messages.append(AIMessage(content=content))
        return messages

    async def query_stream(
        self,
        question: str,
        history: Sequence[Dict[str, str]],
        mode: str = "knowledge",
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """按 mode 产出 sources / content / done 事件。"""
        try:
            require_model_key()
        except RuntimeError as error:
            yield {"type": "error", "data": str(error)}
            return
        if mode == "general":
            yield {"type": "sources", "data": []}
            prompt = _GENERAL_SYSTEM_PROMPT.format(question=question)
        else:
            try:
                results = await asyncio.to_thread(vector_search_service.search_similar_documents,
                    question, top_k=config.rag_top_k
                )
            except Exception as error:  # noqa: BLE001 - 检索失败时回退通用知识
                logger.warning(f"知识库检索失败: {error}")
                results = []

            yield {"type": "sources", "data": self._serialize_sources(results)}

            if results:
                prompt = _KNOWLEDGE_SYSTEM_PROMPT.format(
                    context=self._build_context(results), question=question
                )
            else:
                prompt = _FALLBACK_SYSTEM_PROMPT.format(question=question)

        messages = self._history_messages(history)
        messages.append(HumanMessage(content=prompt))

        answer_parts: List[str] = []
        try:
            model = llm_factory.create_chat_model(model=config.rag_model, streaming=True)
            async for chunk in model.astream(messages):
                text = self._chunk_text(chunk)
                if text:
                    answer_parts.append(text)
                    yield {"type": "content", "data": text}
        except Exception as error:  # noqa: BLE001 - 统一转为 error 事件
            logger.error(f"知识问答失败: {error}")
            yield {"type": "error", "data": "知识问答失败，请检查模型与向量服务后重试。"}
            return

        yield {"type": "done", "data": "".join(answer_parts)}

    @staticmethod
    def _chunk_text(chunk: Any) -> str:
        """兼容不同 LangChain 版本的内容块结构。"""
        content = getattr(chunk, "content", None)
        if content is None:
            return ""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: List[str] = []
            for block in content:
                if isinstance(block, dict):
                    parts.append(str(block.get("text", "")))
                else:
                    parts.append(str(block))
            return "".join(parts)
        return str(content)


# 全局单例
platform_rag_service = PlatformRagService()
