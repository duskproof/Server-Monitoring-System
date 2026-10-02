# VPSGuard agent container image.
#
# The agent reports metrics about whatever it can see, so a container needs
# host namespaces and a few bind mounts for full visibility:
#
#   docker run -d --name vpsguard-agent \
#     --restart unless-stopped \
#     --pid host \
#     --network host \
#     -e VPSGUARD_URL=https://monitor.example.com \
#     -e VPSGUARD_API_KEY=YOUR_API_KEY \
#     -v /proc:/host/proc:ro \
#     -v /sys:/host/sys:ro \
#     -v /etc/os-release:/etc/os-release:ro \
#     -v /var/run/docker.sock:/var/run/docker.sock:ro \
#     -v /var/log:/var/log:ro \
#     -v vpsguard-state:/var/lib/vpsguard \
#     -e PSUTIL_PROCFS_PATH=/host/proc \
#     vpsguard/agent:1.0.0
#
# Mount reference:
#   /proc                  CPU, memory, network, process and uptime metrics
#   /sys                   temperatures (hwmon) and block device metadata
#   /etc/os-release        host distribution identification
#   /var/run/docker.sock   container statistics (read-only is enough)
#   /var/log               log scanning and SSH failure counting
#   /var/lib/vpsguard      persists server_id and the offline buffer
#
# Not available in a container: systemd services (needs the host D-Bus),
# SMART data (needs raw disk access, add --cap-add SYS_RAWIO --device /dev/sda)
# and firewall state. Those collectors log a warning and are omitted.

FROM python:3.11-slim

LABEL org.opencontainers.image.title="VPSGuard agent" \
      org.opencontainers.image.description="Monitoring agent for Linux VPS/VDS servers" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.licenses="MIT"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    VPSGUARD_CONFIG=/etc/vpsguard/agent.conf

WORKDIR /opt/vpsguard

# psutil ships manylinux wheels, so no build toolchain is required.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY pyproject.toml README.md ./
COPY vpsguard_agent ./vpsguard_agent
COPY packaging/agent.conf /etc/vpsguard/agent.conf.sample
RUN pip install --no-cache-dir --no-deps .

RUN groupadd --system vpsguard \
    && useradd --system --gid vpsguard --no-create-home --shell /usr/sbin/nologin vpsguard \
    && mkdir -p /etc/vpsguard /var/lib/vpsguard /var/log/vpsguard \
    && cp /etc/vpsguard/agent.conf.sample /etc/vpsguard/agent.conf \
    && chown -R vpsguard:vpsguard /var/lib/vpsguard /var/log/vpsguard /etc/vpsguard \
    && chmod 600 /etc/vpsguard/agent.conf

USER vpsguard

VOLUME ["/var/lib/vpsguard"]

# test-config validates the configuration and probes the ingest endpoint.
HEALTHCHECK --interval=60s --timeout=15s --start-period=20s --retries=3 \
    CMD ["python", "-m", "vpsguard_agent", "test-config"]

ENTRYPOINT ["python", "-m", "vpsguard_agent"]
CMD ["run"]
