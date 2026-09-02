# Reproducible HAventory dev container: Debian base + uv (Python) + Node (via a
# devcontainer feature). uv provisions the interpreter (the declared Python
# 3.14 HA runtime) from pyproject.toml / uv.lock.
#
# Every image is named on a `FROM` line, the one place Dependabot's docker
# updater reads a tag from: a registry image in a `COPY --from=` is a pin it
# never sees. The two binaries are therefore staged first and copied out of
# their stages below; the `docker` block in .github/dependabot.yml moves the
# tags, and tests/test_repo_hardening_offline.py refuses a `COPY --from=` that
# names an image instead of a stage.
FROM ghcr.io/astral-sh/uv:0.11.31 AS uv
FROM ghcr.io/alexxit/go2rtc:1.9.14 AS go2rtc

FROM mcr.microsoft.com/devcontainers/base:bookworm

# What the Home Assistant that .devcontainer/develop.sh starts needs from the
# system. Inside Docker its `default_config` refuses to set up unless a go2rtc
# binary is on PATH; the camera stack wants ffmpeg and libturbojpeg, and dhcp
# discovery wants libpcap — each logs an error at every start without them.
# Home Assistant accepts any go2rtc at or above the release its go2rtc
# integration recommends and raises a repair issue below it, so the go2rtc tag
# above should not lag that `RECOMMENDED_VERSION`.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ffmpeg libpcap0.8 libturbojpeg0 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY --from=go2rtc /usr/local/bin/go2rtc /usr/local/bin/go2rtc

# Install uv + uvx from the official image (recommended container install path).
COPY --from=uv /uv /uvx /usr/local/bin/

# Let uv manage/download interpreters; copy instead of hardlink across mounts.
ENV UV_LINK_MODE=copy \
    UV_PYTHON_PREFERENCE=managed
