"""LLM 工厂类

使用 LangChain ChatOpenAI 通过 OpenAI 兼容模式调用大模型。
支持的模型提供商（只需修改 base_url 和 api_key）：
- 阿里云 DashScope: https://dashscope.aliyuncs.com/compatible-mode/v1
- OpenAI: https://api.openai.com/v1
- Azure OpenAI: https://{resource}.openai.azure.com
- 其他兼容 OpenAI API 的服务
"""

from typing import Any, Sequence

from langchain_core.runnables import RunnableLambda
from langchain_openai import ChatOpenAI

from app.config import config


def require_model_key() -> None:
    if (config.relay_api_key or config.dashscope_api_key).strip() in ("", "your-api-key-here", "sk-xxx"):
        raise RuntimeError("请在 .env.local 中配置有效的 RELAY_API_KEY 或 DASHSCOPE_API_KEY 后重试。")


class LLMFactory:
    """LLM 工厂类 - 使用 OpenAI 兼容模式"""

    # 阿里云 DashScope OpenAI 兼容模式 URL（作为默认值）
    DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"

    @staticmethod
    def create_chat_model(
        model: str | None = None,
        temperature: float = 0.7,
        streaming: bool = True,
        base_url: str | None = None,
        api_key: str | None = None,
    ) -> ChatOpenAI:
        model = model or config.dashscope_model
        use_relay = bool(config.relay_api_key.strip())
        base_url = base_url or (config.relay_base_url if use_relay else config.dashscope_api_base) or LLMFactory.DASHSCOPE_BASE_URL
        api_key = api_key or (config.relay_api_key if use_relay else config.dashscope_api_key)

        if api_key.strip() in ("", "your-api-key-here", "sk-xxx"):
            raise RuntimeError("请在 .env.local 中配置有效的 RELAY_API_KEY 或 DASHSCOPE_API_KEY 后重试。")

        llm = ChatOpenAI(
            model=model,
            temperature=temperature,
            streaming=streaming,
            base_url=base_url,
            api_key=api_key,
            timeout=180,
            max_retries=2,
        )

        return llm


STRUCTURED_OUTPUT_METHODS: Sequence[str] = ("json_schema", "function_calling", "json_mode")


def _candidate_methods() -> Sequence[str]:
    """确定结构化输出的尝试顺序。

    auto 模式按 json_schema -> function_calling -> json_mode 依次降级；
    显式配置时只使用该方式。
    """
    configured = (config.structured_output_method or "auto").strip().lower()
    if configured in ("", "auto"):
        return STRUCTURED_OUTPUT_METHODS
    return (configured,)


def create_structured_runnable(llm: ChatOpenAI, schema: Any) -> RunnableLambda:
    """构建可自动降级的结构化输出 Runnable。

    部分推理型模型（例如 deepseek-flash 思考模式）会拒绝被强制的
    tool_choice，而 function_calling 方式正依赖它。这里在首次调用时逐个
    尝试候选方式，成功的方式会缓存并被后续调用复用，从而避免每次请求
    都重复失败。
    """
    preferred: dict[str, str | None] = {"method": None}

    async def _invoke(messages: Any) -> Any:
        candidates = list(_candidate_methods())
        if preferred["method"] in candidates:
            candidates.remove(preferred["method"])
            candidates.insert(0, preferred["method"])

        errors: list[str] = []
        for method in candidates:
            try:
                chain = llm.with_structured_output(schema, method=method)
                result = await chain.ainvoke(messages)
            except Exception as error:  # noqa: BLE001 - 逐个方式降级尝试
                errors.append(f"{method}: {error}")
                if preferred["method"] == method:
                    preferred["method"] = None
                continue
            preferred["method"] = method
            return result

        raise RuntimeError("结构化输出失败，已尝试 " + "; ".join(errors))

    return RunnableLambda(_invoke)


# 全局 LLM 工厂实例
llm_factory = LLMFactory()
