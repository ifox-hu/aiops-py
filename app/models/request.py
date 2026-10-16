"""请求数据模型

定义 API 请求的 Pydantic 模型
"""

from pydantic import AliasChoices, BaseModel, Field


class ChatRequest(BaseModel):
    """对话请求"""

    id: str = Field(..., description="会话 ID", alias="Id")
    question: str = Field(..., min_length=1, max_length=16000, description="用户问题", alias="Question")

    class Config:
        populate_by_name = True
        json_schema_extra = {
            "example": {
                "Id": "session-123",
                "Question": "什么是向量数据库？"
            }
        }


class ClearRequest(BaseModel):
    """清空会话请求"""

    session_id: str = Field(..., description="会话 ID", alias="sessionId",
                            validation_alias=AliasChoices("sessionId", "session_id", "Id", "id"))

    class Config:
        populate_by_name = True
