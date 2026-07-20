from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.routers import agent, cart, identify, orders, products, recommendations


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_logging()
    get_logger(__name__).info("Price Compare API starting up")
    yield
    get_logger(__name__).info("Price Compare API shutting down")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Price Compare API",
        version="0.1.0",
        lifespan=lifespan,
    )

    settings = get_settings()
    origins = [o.strip() for o in settings.cors_allow_origins.split(",")]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(Exception)
    async def _global_handler(request: Request, exc: Exception) -> JSONResponse:
        get_logger(__name__).exception("Unhandled error on %s %s", request.method, request.url)
        return JSONResponse(
            status_code=500,
            content={"detail": "An unexpected error occurred. Please try again."},
        )

    app.include_router(agent.router, prefix="/api")
    app.include_router(identify.router, prefix="/api")
    app.include_router(products.router, prefix="/api")
    app.include_router(recommendations.router, prefix="/api")
    app.include_router(cart.router, prefix="/api")
    app.include_router(orders.router, prefix="/api")

    return app


app = create_app()
