from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.routers import cart, chat, orders, products, recommendations

# Resolved once at import time: works in Docker (/app/dist) and is absent in local dev
_DIST_DIR = Path(__file__).parent.parent / "dist"


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

    # API routes must be registered before the static-files catch-all
    app.include_router(chat.router, prefix="/api")
    app.include_router(products.router, prefix="/api")
    app.include_router(recommendations.router, prefix="/api")
    app.include_router(cart.router, prefix="/api")
    app.include_router(orders.router, prefix="/api")

    # Serve the React build when the dist/ directory exists (i.e. inside Docker).
    # In local dev the Vite dev server handles the frontend, so this is intentionally skipped.
    if _DIST_DIR.is_dir():
        app.mount("/", StaticFiles(directory=str(_DIST_DIR), html=True), name="frontend")

    return app


app = create_app()
