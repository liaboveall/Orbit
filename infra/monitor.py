#!/usr/bin/env python3
"""Host checks for Orbit; orbit-monitor.timer runs this every five minutes.

A condition alerts after two failed runs in a row, repeats every six hours while it
lasts, and sends one recovery message. Event checks (mail failures, bursts of 5xx)
alert at once and at most once an hour.

Configuration: /opt/orbit/monitor.env holds ORBIT_ALERT_TO and ORBIT_PUBLIC_URL; the
SMTP login comes from app.env. Details in alerts are status text only, never user data.

Drill: ORBIT_MONITOR_DRILL=1 labels the mail, --simulate NAME forces a check to fail,
and ORBIT_MONITOR_STATE points at a throwaway state file.
"""
import argparse
import email.utils
import fcntl
import json
import os
import shutil
import smtplib
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(os.environ.get("ORBIT_ROOT", "/opt/orbit"))
STATE = Path(os.environ.get("ORBIT_MONITOR_STATE", str(ROOT / "monitor" / "state.json")))
NGINX_LOG = Path("/var/log/nginx/orbit-access.log")
WEB_CONTAINER = "orbit-showcase-web-1"
CONTAINERS = (WEB_CONTAINER, "orbit-showcase-postgres-1", "orbit-showcase-storage-1")
CERTIFICATES = ("smartorbit.tech", "www.smartorbit.tech")

HOUR = 3600
FAILURES_BEFORE_ALERT = 2
REMIND_AFTER = 6 * HOUR
EVENT_COOLDOWN = HOUR
BACKUP_MAX_AGE = 26 * HOUR
MAINTENANCE_MAX_AGE = 3 * HOUR
CERTIFICATE_MIN_DAYS = 14
DISK_MAX_PERCENT = 85
MEMORY_MIN_MIB = 768
EVENT_WINDOW = 6 * 60
SERVER_ERROR_THRESHOLD = 3


def read_env(path):
    values = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key] = value.strip().strip('"')
    return values


def run(command, timeout=30):
    return subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)


def age_text(seconds):
    return f"{seconds / HOUR:.1f} 小时前"


def check_site(config):
    url = config["ORBIT_PUBLIC_URL"].rstrip("/") + "/health/ready"
    try:
        with urllib.request.urlopen(url, timeout=15) as response:
            return response.status == 200, f"返回 {response.status}"
    except urllib.error.HTTPError as error:
        return False, f"返回 {error.code}"
    except OSError as error:
        return False, f"无法访问（{type(error).__name__}）"


def check_containers(_config):
    template = "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.State.OOMKilled}}"
    problems = []
    for name in CONTAINERS:
        result = run(["docker", "inspect", "-f", template, name])
        state = result.stdout.split()
        if result.returncode != 0 or len(state) != 3:
            problems.append(f"{name} 无法读取")
        elif state[0] != "running" or state[1] != "healthy" or state[2] == "true":
            problems.append(f"{name}: {' '.join(state)}")
    return not problems, "; ".join(problems) or "全部 healthy"


def check_age(path, limit, missing):
    if not path.exists():
        return False, missing
    age = time.time() - path.stat().st_mtime
    return age <= limit, f"最近一次成功在 {age_text(age)}"


def check_local_backup(_config):
    manifests = sorted((ROOT / "backups").glob("backup-*.sha256"), key=lambda path: path.stat().st_mtime)
    if not manifests:
        return False, "没有完整的本地备份"
    return check_age(manifests[-1], BACKUP_MAX_AGE, "没有完整的本地备份")


def check_offsite_backup(_config):
    return check_age(ROOT / "backups" / ".offsite-last-success", BACKUP_MAX_AGE, "还没有成功的异地备份")


def check_maintenance(_config):
    return check_age(ROOT / "monitor" / "maintenance-ok", MAINTENANCE_MAX_AGE, "还没有成功的维护记录")


def check_certificates(_config):
    problems = []
    for name in CERTIFICATES:
        path = f"/etc/letsencrypt/live/{name}/fullchain.pem"
        result = run(["openssl", "x509", "-checkend", str(CERTIFICATE_MIN_DAYS * 86400), "-noout", "-in", path])
        if result.returncode != 0:
            problems.append(name)
    return not problems, f"{CERTIFICATE_MIN_DAYS} 天内过期或无法读取: {', '.join(problems)}" if problems else "有效"


def check_disk(_config):
    usage = shutil.disk_usage("/")
    percent = usage.used * 100 / usage.total
    return percent <= DISK_MAX_PERCENT, f"已用 {percent:.0f}%"


def check_memory(_config):
    fields = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines())
    available = int(fields["MemAvailable"].split()[0]) // 1024
    return available >= MEMORY_MIN_MIB, f"可用 {available} MiB"


def check_auth_email(_config):
    result = run(["docker", "logs", "--since", f"{EVENT_WINDOW}s", WEB_CONTAINER], timeout=60)
    text = result.stdout + result.stderr
    count = text.count("auth_email_failed") + text.count("auth_email_dropped")
    return count == 0, f"最近 {EVENT_WINDOW // 60} 分钟有 {count} 封认证邮件发送失败"


def check_server_errors(_config):
    if not NGINX_LOG.exists():
        return True, "没有访问日志"
    with NGINX_LOG.open("rb") as handle:
        handle.seek(0, os.SEEK_END)
        handle.seek(max(0, handle.tell() - 4 * 1024 * 1024))
        lines = handle.read().decode("utf-8", errors="replace").splitlines()
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=EVENT_WINDOW)
    count = 0
    for line in lines:
        try:
            row = json.loads(line)
            if int(row["status"]) >= 500 and datetime.fromisoformat(row["time"]) >= cutoff:
                count += 1
        except (ValueError, KeyError, TypeError):
            continue
    return count <= SERVER_ERROR_THRESHOLD, f"最近 {EVENT_WINDOW // 60} 分钟有 {count} 个 5xx"


CHECKS = (
    ("site", "condition", "网站就绪检查", check_site),
    ("containers", "condition", "容器状态", check_containers),
    ("local_backup", "condition", "本地备份", check_local_backup),
    ("offsite_backup", "condition", "异地备份", check_offsite_backup),
    ("maintenance", "condition", "定时维护", check_maintenance),
    ("certificates", "condition", "HTTPS 证书", check_certificates),
    ("disk", "condition", "磁盘空间", check_disk),
    ("memory", "condition", "内存", check_memory),
    ("auth_email", "event", "认证邮件", check_auth_email),
    ("server_errors", "event", "服务端错误", check_server_errors),
)


def load_state():
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(state):
    STATE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = STATE.with_name(f"{STATE.name}.{uuid.uuid4()}")
    temporary.write_text(json.dumps(state, indent=1), encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(STATE)


def evaluate(kind, ok, entry, now):
    """Advance one check's state. Returns "alert", "recovered" or None."""
    if kind == "event":
        if not ok and now - entry.get("lastAlert", 0) >= EVENT_COOLDOWN:
            entry["pendingAlert"] = now
            return "alert"
        return None
    if ok:
        was_alerted = entry.get("alerted", False)
        entry["failures"] = 0
        if was_alerted:
            return "recovered"
        return None
    entry["failures"] = entry.get("failures", 0) + 1
    if entry["failures"] < FAILURES_BEFORE_ALERT:
        return None
    if not entry.get("alerted") or now - entry.get("lastAlert", 0) >= REMIND_AFTER:
        entry["pendingAlert"] = now
        return "alert"
    return None


def send(config, subject, body):
    env = read_env(ROOT / "app.env")
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = email.utils.formataddr(("Orbit Monitor", "alerts@smartorbit.tech"))
    message["To"] = config["ORBIT_ALERT_TO"]
    message["Date"] = email.utils.formatdate(usegmt=True)
    message["Message-ID"] = email.utils.make_msgid(domain="smartorbit.tech")
    message.set_content(body)
    with smtplib.SMTP_SSL(env["SMTP_HOST"], int(env["SMTP_PORT"]), context=ssl.create_default_context(), timeout=20) as client:
        client.login(env["SMTP_USER"], env["SMTP_PASSWORD"])
        client.send_message(message)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--simulate", action="append", default=[], help="force the named check to fail")
    arguments = parser.parse_args()
    config = read_env(ROOT / "monitor.env")
    drill = os.environ.get("ORBIT_MONITOR_DRILL") == "1"
    prefix = "[Orbit 演练]" if drill else "[Orbit]"
    state = load_state()
    now = int(time.time())
    alerts, recovered, failing = [], [], []

    for name, kind, label, check in CHECKS:
        try:
            ok, detail = check(config)
        except Exception as error:  # A broken check must alert, not silence the rest.
            ok, detail = False, f"检查程序出错（{type(error).__name__}）"
        if name in arguments.simulate:
            ok, detail = False, "演练：模拟故障"
        entry = state.setdefault(name, {})
        if not ok:
            failing.append(name)
        outcome = evaluate(kind, ok, entry, now)
        if outcome == "alert":
            alerts.append((name, label, detail))
        elif outcome == "recovered":
            recovered.append((name, label, detail))

    delivered = None
    if alerts or recovered:
        names = "、".join(label for _, label, _ in alerts or recovered)
        subject = f"{prefix} {'故障' if alerts else '已恢复'}：{names}"
        lines = []
        if alerts:
            lines.append("发现以下问题：")
            lines.extend(f"- {label}：{detail}" for _, label, detail in alerts)
        if recovered:
            lines.extend(["", "已恢复：" if alerts else "以下项目已恢复正常："])
            lines.extend(f"- {label}：{detail}" for _, label, detail in recovered)
        if drill:
            lines.extend(["", "这是一次告警演练，线上服务没有受到影响。"])
        lines.extend([
            "",
            f"检查时间：{datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC",
            "站点：" + config["ORBIT_PUBLIC_URL"],
            "排查入口：sudo journalctl -u orbit-monitor -n 20；sudo docker compose -f /opt/orbit/compose.yml ps",
        ])
        try:
            send(config, subject, "\n".join(lines) + "\n")
            delivered = True
        except Exception as error:  # Keep state unchanged so the next run retries.
            delivered = False
            print(json.dumps({"event": "monitor_delivery_failed", "error": type(error).__name__}), file=sys.stderr)

    if delivered is not False:
        for name, _, _ in alerts:
            state[name]["lastAlert"] = state[name].pop("pendingAlert", now)
            state[name]["alerted"] = True
        for name, _, _ in recovered:
            state[name]["alerted"] = False
    else:
        for name, _, _ in alerts:
            state[name].pop("pendingAlert", None)
    save_state(state)
    print(json.dumps({
        "event": "monitor_run",
        "failing": failing,
        "alerted": [name for name, _, _ in alerts],
        "recovered": [name for name, _, _ in recovered],
        "delivered": delivered,
    }))
    return 0


if __name__ == "__main__":
    STATE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(STATE.parent / ".lock", "w", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            sys.exit(0)
        sys.exit(main())
