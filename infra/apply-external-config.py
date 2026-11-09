#!/usr/bin/env python3
"""Install Orbit's external-service credentials from stdin without printing them.

Input is KEY=VALUE lines. A group left blank is not touched, so mail and off-site
backup can be configured separately. Run as root on the server, from the operator's
machine, so the values never appear in a shell history or a process list:

    ssh HOST 'sudo python3 apply-external-config.py' < filled-in-file

Messages name a field or a line number and never contain a value.
"""
import fcntl
import json
import os
import re
import secrets
import shutil
import sys
import uuid
from pathlib import Path

ROOT = Path("/opt/orbit")
APP_ENV = ROOT / "app.env"
BACKUP_ENV = ROOT / "backup.env"
RESTIC_PASSWORD = ROOT / "restic-password"
BUCKET = "orbit-backup-prod"
ACCEPTED = {"RESEND_API_KEY", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"}
R2_KEYS = ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")


class Reject(Exception):
    """A validation failure whose message is safe to print."""


def parse(raw):
    values = {}
    for number, line in enumerate(raw.splitlines(), start=1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        key = key.strip()
        if not separator or key not in ACCEPTED:
            raise Reject(f"line {number} is not one of the expected KEY=VALUE entries")
        if key in values:
            raise Reject(f"{key} appears twice")
        values[key] = value.strip()
    return values


def validate(values):
    key = values.get("RESEND_API_KEY", "")
    if key and not re.fullmatch(r"re_[A-Za-z0-9_-]{16,}", key):
        raise Reject("RESEND_API_KEY does not look like a Resend key")

    filled = [name for name in R2_KEYS if values.get(name)]
    if not filled:
        return key, None
    missing = [name for name in R2_KEYS if name not in filled]
    if missing:
        raise Reject("R2 group is incomplete, missing: " + ", ".join(missing))

    endpoint = values["R2_ENDPOINT"].rstrip("/").removesuffix("/" + BUCKET)
    if not re.fullmatch(r"https://[0-9a-f]{32}\.r2\.cloudflarestorage\.com", endpoint):
        raise Reject("R2_ENDPOINT is not https://<account id>.r2.cloudflarestorage.com")
    if not re.fullmatch(r"[0-9a-f]{32}", values["R2_ACCESS_KEY_ID"]):
        raise Reject("R2_ACCESS_KEY_ID does not look like an R2 access key id")
    if not re.fullmatch(r"[0-9a-f]{64}", values["R2_SECRET_ACCESS_KEY"]):
        raise Reject("R2_SECRET_ACCESS_KEY does not look like an R2 secret access key")
    return key, {
        "RESTIC_REPOSITORY": f"s3:{endpoint}/{BUCKET}",
        "AWS_ACCESS_KEY_ID": values["R2_ACCESS_KEY_ID"],
        "AWS_SECRET_ACCESS_KEY": values["R2_SECRET_ACCESS_KEY"],
        "AWS_DEFAULT_REGION": "auto",
    }


def write_private(path, text):
    temporary = path.with_name(f"{path.name}.{uuid.uuid4()}")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(text)
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)


def update_app_env(key):
    wanted = {
        "SMTP_HOST": "smtp.resend.com",
        "SMTP_PORT": "465",
        "SMTP_USER": "resend",
        "SMTP_PASSWORD": key,
        "SMTP_SECURE": "true",
    }
    seen = set()
    lines = []
    for line in APP_ENV.read_text(encoding="utf-8").splitlines():
        name = line.split("=", 1)[0]
        if name in wanted and not line.startswith("#"):
            lines.append(f"{name}={wanted[name]}")
            seen.add(name)
        else:
            lines.append(line)
    if seen != set(wanted):
        raise Reject("app.env is missing an expected SMTP entry")
    write_private(APP_ENV, "\n".join(lines) + "\n")


def main():
    if os.geteuid() != 0:
        raise Reject("must run as root")
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536:
        raise Reject("input is too large")
    key, backup = validate(parse(raw.decode("utf-8-sig", errors="replace")))
    if not key and not backup:
        raise Reject("nothing to apply: every group is blank")

    os.umask(0o077)
    history = ROOT / "config-history" / str(uuid.uuid4())
    history.mkdir(parents=True, mode=0o700)
    for path in (APP_ENV, BACKUP_ENV):
        if path.exists():
            shutil.copy2(path, history / path.name)
    if key:
        update_app_env(key)
    if backup:
        write_private(BACKUP_ENV, "".join(f"{k}={v}\n" for k, v in backup.items()))
        if not RESTIC_PASSWORD.exists():
            write_private(RESTIC_PASSWORD, secrets.token_urlsafe(48) + "\n")
    print(json.dumps({"status": "applied", "mail": bool(key), "backup": bool(backup), "secretValuesPrinted": False}))


if __name__ == "__main__":
    try:
        with open(ROOT / ".configuration.lock", "w", encoding="utf-8") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            main()
    except Reject as error:
        print(f"Not applied: {error}", file=sys.stderr)
        sys.exit(2)
    except Exception as error:  # Never echo a traceback: it could quote an input line.
        print(f"Not applied: unexpected {type(error).__name__}", file=sys.stderr)
        sys.exit(1)
