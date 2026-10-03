# Reproducible HAventory dev container: Debian base + uv (Python) + Node (via a
# devcontainer feature). uv provisions the interpreter (the declared Python
# 3.14 HA runtime) from pyproject.toml / uv.lock.
#
# Every image is named on a `FROM` line, the only place Dependabot's docker
# updater reads a tag; tests/test_repo_hardening_offline.py refuses a
# `COPY --from=` that names an image instead of a stage.
FROM ghcr.io/astral-sh/uv:0.12.22 AS uv
FROM ghcr.io/alexxit/go2rtc:1.9.14 AS go2rtc

FROM mcr.microsoft.com/devcontainers/base:bookworm

# What the HA that .devcontainer/develop.sh starts needs: `default_config`
# refuses to set up in Docker without a go2rtc binary on PATH, and the camera
# stack and dhcp discovery log errors without ffmpeg, libturbojpeg and libpcap.
# The go2rtc tag should not lag the go2rtc integration's `RECOMMENDED_VERSION`.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ffmpeg libpcap0.8 libturbojpeg0 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY --from=go2rtc /usr/local/bin/go2rtc /usr/local/bin/go2rtc

COPY --from=uv /uv /uvx /usr/local/bin/

# Let uv manage/download interpreters; copy instead of hardlink across mounts.
ENV UV_LINK_MODE=copy \
    UV_PYTHON_PREFERENCE=managed
