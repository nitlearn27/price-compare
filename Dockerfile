# Stage 1: Build the React frontend
FROM node:20-slim AS frontend-builder

WORKDIR /frontend

RUN npm install -g pnpm

COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ .
RUN pnpm build

# Stage 2: FastAPI backend + frontend dist
FROM python:3.11-slim

WORKDIR /app

COPY backend/ .
RUN pip install --no-cache-dir .

# Copy the React build output so FastAPI can serve it via StaticFiles
COPY --from=frontend-builder /frontend/dist ./dist

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
