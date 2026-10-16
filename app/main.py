"""FastAPI 应用入口

主应用程序，配置路由、中间件、静态文件等
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from contextlib import asynccontextmanager
import os

from app.config import config
from loguru import logger
from app.api import chat, health, file, aiops, platform
from app.core.milvus_client import milvus_manager
from app.agent.mcp_client import mcp_available


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    logger.info("=" * 60)
    logger.info(f"{config.app_name} v{config.app_version} 启动中...")
    logger.info(f"环境: {'开发' if config.debug else '生产'}")
    logger.info(f"监听地址: http://{config.host}:{config.port}")
    logger.info(f"API 文档: http://{config.host}:{config.port}/docs")

    # 连接 Milvus；连接失败不阻断启动，便于仅使用 Mock 数据浏览工作台
    logger.info("正在连接 Milvus...")
    try:
        milvus_manager.connect()
        logger.info("Milvus 连接成功")
    except Exception as error:  # noqa: BLE001 - 降级启动
        logger.error(f"Milvus 连接失败，知识库检索与索引将不可用: {error}")

    if not mcp_available():
        logger.warning("MCP 适配层不可用，Agent 将仅使用本地工具")
    logger.info("工作台: http://{}:{}/designs/workbench-v2.html", config.host, config.port)
    logger.info("=" * 60)

    yield

    logger.info("正在关闭 Milvus 连接...")
    try:
        milvus_manager.close()
    except Exception as error:  # noqa: BLE001 - 关闭阶段不再抛出
        logger.warning(f"关闭 Milvus 连接失败: {error}")
    logger.info(f"{config.app_name} 关闭")


# 创建 FastAPI 应用
app = FastAPI(
    title=config.app_name,
    version=config.app_version,
    description="基于 LangChain 的智能oncall运维系统",
    lifespan=lifespan
)

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应该限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(health.router, tags=["健康检查"])
app.include_router(chat.router, prefix="/api", tags=["对话"])
app.include_router(file.router, prefix="/api", tags=["文件管理"])
app.include_router(aiops.router, prefix="/api", tags=["AIOps智能运维"])
app.include_router(platform.router, prefix="/api/platform", tags=["平台视图"])

# 挂载静态文件
static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
designs_dir = os.path.join(static_dir, "designs")
app.mount("/static", StaticFiles(directory=static_dir), name="static")

if os.path.isdir(designs_dir):
    # 与 Java 版保持一致的 /designs/*.html 访问路径
    app.mount("/designs", StaticFiles(directory=designs_dir, html=True), name="designs")


@app.get("/", include_in_schema=False)
async def root():
    """首页跳转到值班工作台（对齐 Java 版行为）。"""
    workbench = os.path.join(designs_dir, "workbench-v2.html")
    if os.path.exists(workbench):
        return RedirectResponse(url="/designs/workbench-v2.html")
    return {
        "message": f"Welcome to {config.app_name} API",
        "version": config.app_version,
        "docs": "/docs"
    }


@app.get("/legacy", include_in_schema=False)
async def legacy():
    """保留原有的单页对话界面。"""
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return RedirectResponse(url="/docs")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=config.host,
        port=config.port,
        reload=config.debug,
        log_level="info"
    )
