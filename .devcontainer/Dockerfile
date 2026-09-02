# Reproducible HAventory dev container: Debian base + uv (Python) + Node (via a
# devcontainer feature). uv provisions the interpreter (the declared Python
# 3.14 HA runtime) from pyproject.toml / uv.lock.
FROM mcr.microsoft.com/devcontainers/base:bookworm

# What the Home Assistant that .devcontainer/develop.sh starts needs from the
# system. Inside Docker its `default_config` refuses to set up unless a go2rtc
# binary is on PATH; the camera stack wants ffmpeg and libturbojpeg, and dhcp
# discovery wants libpcap — each logs an error at every start without them. The
# go2rtc integration accepts any release at or above the one it recommends, and
# that recommendation moves with every Home Assistant release, so a pinned copy
# would fall behind it and raise a repair issue in the dev instance.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ffmpeg libpcap0.8 libturbojpeg0 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/alexxit/go2rtc:latest /usr/local/bin/go2rtc /usr/local/bin/go2rtc

# Install uv + uvx from the official image (recommended container install path).
COPY --from=ghcr.io/astral-sh/uv:0.11.31 /uv /uvx /usr/local/bin/

# Let uv manage/download interpreters; copy instead of hardlink across mounts.
ENV UV_LINK_MODE=copy \
    UV_PYTHON_PREFERENCE=managed
