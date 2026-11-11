# BRIDGE single-service image: FastAPI serves the API, WebSockets and the
# exported web app from one origin (simplest HTTPS + WSS setup).

# ---- 1. Build the web app ---------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

# ---- 2. API runtime -----------------------------------------------------------
FROM python:3.12-slim AS api
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY services/api/requirements.txt ./
RUN pip install -r requirements.txt
COPY services/api/ ./
COPY --from=web /web/out ./static
ENV STATIC_DIR=/app/static BRIDGE_ENV=production PORT=8000
RUN useradd --create-home bridge && chown -R bridge /app
USER bridge
EXPOSE 8000
# Run migrations, then start. --proxy-headers so rate limits see real client IPs behind the host's proxy.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
