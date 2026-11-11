"""BRIDGE API entrypoint."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text

from app.api import routes_rooms, routes_translations
from app.core.config import get_settings
from app.core.logging import configure_logging, log_event
from app.db.session import SessionLocal, engine
from app.providers.http import close_client
from app.realtime import ws
from app.services import pipeline
from app.services.capabilities import language_matrix, public_config
from app.services.rooms import sweeper_loop

settings = get_settings()
configure_logging(settings.log_level)
log = logging.getLogger("bridge")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log_event(log, "startup", env=settings.bridge_env, **{k: v for k, v in public_config()["providers"].items()})
    sweeper = asyncio.create_task(sweeper_loop(SessionLocal)) if settings.bridge_env != "test" else None
    yield
    if sweeper:
        sweeper.cancel()
    await pipeline.drain_tasks()
    await close_client()
    await engine.dispose()


app = FastAPI(
    title="BRIDGE API",
    version="1.0.0",
    description="Multilingual group conversation rooms. See docs/api.md.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "microphone=(self), camera=()")
    if request.url.path.startswith("/api"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    errors = [
        {"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"].replace("Value error, ", "")}
        for e in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={"detail": {"code": "validation_error", "message": "Please check the highlighted fields.", "errors": errors}},
    )


@app.get("/api/health", tags=["meta"])
async def health():
    db_ok = True
    try:
        async with SessionLocal() as db:
            await db.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "database": db_ok, "environment": settings.bridge_env}


@app.get("/api/config", tags=["meta"])
async def config():
    """Public, non-secret configuration: active providers, limits and the language matrix."""
    return public_config()


@app.get("/api/languages", tags=["meta"])
async def languages():
    return language_matrix()


app.include_router(routes_rooms.router)
app.include_router(routes_translations.router)
app.include_router(ws.router)


# Optional single-origin deployment: serve the exported web app.
if settings.static_dir and Path(settings.static_dir).is_dir():
    static_root = Path(settings.static_dir).resolve()

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        candidate = (static_root / path).resolve()
        if static_root not in candidate.parents and candidate != static_root:
            return JSONResponse({"detail": "not found"}, status_code=404)
        for option in (candidate, candidate.with_suffix(".html"), candidate / "index.html"):
            if option.is_file():
                return FileResponse(option)
        return FileResponse(static_root / "404.html", status_code=404)
