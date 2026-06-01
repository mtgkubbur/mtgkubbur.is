FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# uv (pinned)
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

# Python deps — frozen lock, runtime only
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# App + data + tailwind config
COPY app/ app/
COPY data/ data/
COPY tailwind.config.js ./

# Build Tailwind CSS fresh (download linux binary, build minified, remove it + curl)
RUN curl -sL -o /usr/local/bin/tailwindcss \
      https://github.com/tailwindlabs/tailwindcss/releases/download/v3.4.17/tailwindcss-linux-x64 && \
    chmod +x /usr/local/bin/tailwindcss && \
    tailwindcss -i app/static/css/input.css -o app/static/css/tailwind.css --minify && \
    rm /usr/local/bin/tailwindcss && \
    apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
