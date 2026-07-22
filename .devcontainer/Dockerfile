# Reproducible HAventory dev container: Debian base + uv (Python) + Node (via a
# devcontainer feature). uv provisions the Python interpreter (the declared
# 3.14 HA runtime) from pyproject.toml / uv.lock.
FROM mcr.microsoft.com/devcontainers/base:bookworm

# Install uv + uvx from the official image (recommended container install path).
COPY --from=ghcr.io/astral-sh/uv:0.11.31 /uv /uvx /usr/local/bin/

# Let uv manage/download interpreters; copy instead of hardlink across mounts.
ENV UV_LINK_MODE=copy \
    UV_PYTHON_PREFERENCE=managed
