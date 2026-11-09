#!/usr/bin/env bash
# Capacity measurement on the deployment host, with synthetic data only.
#
#   sudo bash capacity-test.sh <image-sha> <path-to-capacity-load.mjs>
#
# Starts a separate Compose project with production's images and memory limits, runs
# scripts/capacity-load.mjs, overlaps a real backup and maintenance run with the mixed
# workload, and samples host resources. Requests go straight to the web container, so
# Nginx and TLS are not part of the figures. The project and its volumes are removed on exit.
set -euo pipefail
umask 077
sha="$1"
load_script="$2"
work=/opt/orbit-capacity
project=orbit-capacity
seconds=90
[ ! -e "$work" ] || { echo "$work already exists" >&2; exit 1; }
install -d -m 700 "$work"
install -d -m 777 "$work/out"
compose() { docker compose -f "$work/compose.yml" "$@" < /dev/null; }

sampler_pids=()
cleanup() {
  for pid in "${sampler_pids[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
  docker compose -f "$work/compose.yml" -p "$project" down -v --remove-orphans > /dev/null 2>&1 < /dev/null || true
  rm -rf -- "$work"
}
trap cleanup EXIT

db_password=$(openssl rand -hex 24)
app_password=$(openssl rand -hex 24)
storage_secret=$(openssl rand -hex 24)
auth_secret=$(openssl rand -hex 32)
cat > "$work/db.env" <<EOF
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$db_password
POSTGRES_DB=postgres
EOF
cat > "$work/storage.env" <<EOF
AWS_ACCESS_KEY_ID=orbit_storage
AWS_SECRET_ACCESS_KEY=$storage_secret
EOF
cat > "$work/app.env" <<EOF
APP_ENV=production
APP_URL=https://capacity.invalid
BETTER_AUTH_URL=https://capacity.invalid
AUTH_TRUSTED_ORIGINS=https://capacity.invalid
BETTER_AUTH_SECRET=$auth_secret
DATABASE_URL=postgresql://orbit_app:$app_password@postgres:5432/orbit_capacity
TEST_DATABASE_URL=postgresql://unused:unused@127.0.0.1:5432/orbit_test
SMTP_HOST=smtp.invalid
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_SECURE=false
MAIL_FROM=Orbit <no-reply@capacity.invalid>
STORAGE_ENDPOINT=http://storage:8333
STORAGE_REGION=us-east-1
STORAGE_BUCKET=orbit-attachments
STORAGE_ACCESS_KEY_ID=orbit_storage
STORAGE_SECRET_ACCESS_KEY=$storage_secret
STORAGE_FORCE_PATH_STYLE=true
TRUSTED_PROXY_COUNT=1
LOG_LEVEL=warn
AI_ENABLED=false
ORBIT_MAINTENANCE_TARGET=
CAPACITY_SECONDS=$seconds
EOF
chmod 644 "$work/app.env"
install -m 644 "$load_script" "$work/capacity-load.mjs"
cat > "$work/compose.yml" <<EOF
name: $project
services:
  postgres:
    image: postgres:17
    mem_limit: 1g
    env_file: [$work/db.env]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d postgres"]
      interval: 2s
      timeout: 5s
      retries: 30
  web:
    image: orbit-web:$sha
    mem_limit: 1g
    init: true
    env_file: [$work/app.env]
    depends_on:
      postgres:
        condition: service_healthy
    security_opt: [no-new-privileges:true]
    cap_drop: [ALL]
  operations:
    image: orbit-operations:$sha
    profiles: [tools]
    mem_limit: 1g
    init: true
    env_file: [$work/app.env]
    volumes:
      - $work/capacity-load.mjs:/app/scripts/capacity-load.mjs:ro
      - $work/out:/capacity
    depends_on:
      postgres:
        condition: service_healthy
    security_opt: [no-new-privileges:true]
    cap_drop: [ALL]
  storage:
    image: chrislusf/seaweedfs:4.47@sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882
    mem_limit: 512m
    command: ["mini", "-dir=/data", "-bucket=orbit-attachments", "-s3.autoCreateBucket=false", "-master.telemetry=false"]
    env_file: [$work/storage.env]
    volumes: [storagedata:/data]
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8333/healthz"]
      interval: 2s
      timeout: 5s
      retries: 30
    security_opt: [no-new-privileges:true]
    cap_drop: [ALL]
    cap_add: [CHOWN, SETUID, SETGID]
volumes:
  pgdata:
  storagedata:
EOF

echo '--- starting the disposable stack'
compose up -d --wait postgres storage 2>&1 | tail -1
compose exec -T postgres psql -q -U postgres -c "CREATE ROLE orbit_app LOGIN PASSWORD '$app_password'" -c 'CREATE DATABASE orbit_capacity OWNER orbit_app'
compose run --rm operations node node_modules/prisma/build/index.js migrate deploy 2>&1 | tail -1
compose up -d web 2>&1 | tail -1
for attempt in $(seq 1 60); do
  if compose exec -T web node -e 'fetch("http://127.0.0.1:3000/health/ready").then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))' 2>/dev/null; then break; fi
  sleep 2
done

# Host sampling, and a probe of production to see what the load does to the live site.
(
  while :; do
    now=$(date +%s)
    docker stats --no-stream --format "$now {{.Name}} {{.CPUPerc}} {{.MemUsage}}" 2>/dev/null >> "$work/out/stats.log"
    free -m | awk -v now="$now" '/^Mem:/{available=$7} /^Swap:/{print now, available, $3}' >> "$work/out/free.log"
    sleep 2
  done
) &
sampler_pids+=("$!")
vmstat -n 5 >> "$work/out/vmstat.log" &
sampler_pids+=("$!")
(
  while :; do
    curl -s -o /dev/null -m 10 -w '%{http_code} %{time_total}\n' https://smartorbit.tech/health/ready >> "$work/out/production.log" || echo '000 10' >> "$work/out/production.log"
    sleep 5
  done
) &
sampler_pids+=("$!")

echo '--- running the load'
docker compose -f "$work/compose.yml" run --rm --no-deps operations node /app/scripts/capacity-load.mjs < /dev/null > "$work/out/load.log" 2>&1 &
load=$!

# Overlap a backup and a maintenance run with the middle of the mixed workload.
for attempt in $(seq 1 120); do [ -f "$work/out/mixed-start" ] && break; sleep 1; done
sleep 25
date +%s%3N > "$work/out/overlap-start"
ORBIT_COMPOSE_FILE="$work/compose.yml" ORBIT_BACKUP_DIR="$work/backups" ORBIT_BACKUP_DATABASE=orbit_capacity \
  bash /opt/orbit/backup-local.sh < /dev/null 2>/dev/null | tail -1 | cut -c1-90
date +%s%3N > "$work/out/overlap-end"
target=$(compose run --rm operations 2>/dev/null | grep maintenance_preview | tail -1 | sed -E 's/.*"target":"([0-9a-f]{64})".*/\1/')
compose run --rm operations node --conditions=react-server --import tsx scripts/maintenance-cleanup.ts --execute "--target=$target" 2>&1 | tail -1 | cut -c1-140
date +%s%3N > "$work/out/maintenance-end"

load_status=0
wait "$load" || load_status=$?
tail -2 "$work/out/load.log" | cut -c1-200
echo "load exit: $load_status"
for pid in "${sampler_pids[@]}"; do kill "$pid" 2>/dev/null || true; done
sampler_pids=()

echo '--- capacity containers after the run'
for service in web postgres storage; do
  docker inspect -f "$service restarts={{.RestartCount}} oom={{.State.OOMKilled}} status={{.State.Status}}" "$project-$service-1"
done

python3 - "$work/out" <<'PY'
import collections, json, math, pathlib, sys
out = pathlib.Path(sys.argv[1])
def num(name):
    path = out / name
    return int(path.read_text().strip()) if path.exists() else None
overlap = (num('overlap-start'), num('overlap-end'))
mixed_start, mixed_end = num('mixed-start'), num('mixed-end')
def stats(values):
    ordered = sorted(values)
    pick = lambda q: ordered[min(len(ordered) - 1, math.ceil(len(ordered) * q) - 1)]
    return {'n': len(ordered), 'p50': round(pick(.5), 1), 'p95': round(pick(.95), 1), 'p99': round(pick(.99), 1), 'max': round(ordered[-1], 1)}
groups = collections.defaultdict(list)
codes = collections.defaultdict(collections.Counter)
for line in (out / 'samples.jsonl').read_text().splitlines():
    row = json.loads(line)
    period = 'budget' if row['kind'].startswith('budget') else ('backup_window' if overlap[0] and overlap[0] <= row['t'] <= overlap[1] else 'normal')
    key = f"{period}/{row['kind']}"
    groups[key].append(row['ms'])
    codes[key][row['status']] += 1
print('--- latency ms and status codes')
for key in sorted(groups):
    print(f'{key:30} {json.dumps(stats(groups[key]))} {dict(codes[key])}')
print('board:', (out / 'board.json').read_text())
print('mixed seconds:', round((mixed_end - mixed_start) / 1000, 1) if mixed_end else 'incomplete', 'backup window seconds:', round((overlap[1] - overlap[0]) / 1000, 1))
total = sum(sum(c.values()) for k, c in codes.items() if not k.startswith('budget'))
print('mixed request rate per second:', round(total / ((mixed_end - mixed_start) / 1000), 1) if mixed_end else 'n/a')
units = {'B': 1 / 1048576, 'KiB': 1 / 1024, 'MiB': 1, 'GiB': 1024}
peak_memory, peak_cpu = collections.Counter(), collections.Counter()
for line in (out / 'stats.log').read_text().splitlines():
    parts = line.split()
    if len(parts) < 4:
        continue
    name = parts[1]
    usage = parts[3]
    for unit in ('GiB', 'MiB', 'KiB', 'B'):
        if usage.endswith(unit):
            peak_memory[name] = max(peak_memory[name], float(usage[:-len(unit)]) * units[unit])
            break
    peak_cpu[name] = max(peak_cpu[name], float(parts[2].rstrip('%')))
print('--- peak per container (memory MiB, cpu %)')
for name in sorted(peak_memory, key=lambda value: -peak_memory[value]):
    print(f'{name:32} {peak_memory[name]:8.0f} {peak_cpu[name]:7.1f}')
free_rows = [line.split() for line in (out / 'free.log').read_text().splitlines()]
print('host minimum available MiB:', min(int(row[1]) for row in free_rows), 'max swap used MiB:', max(int(row[2]) for row in free_rows))
vm = [line.split() for line in (out / 'vmstat.log').read_text().splitlines()[2:] if line.split() and line.split()[0].isdigit()]
if vm:
    print('vmstat peak: cpu busy %', max(100 - int(row[14]) for row in vm), 'swap in', max(int(row[6]) for row in vm), 'swap out', max(int(row[7]) for row in vm), 'run queue', max(int(row[0]) for row in vm))
production = [line.split() for line in (out / 'production.log').read_text().splitlines()]
times = [float(row[1]) * 1000 for row in production]
print('live site during the test:', collections.Counter(row[0] for row in production), stats(times))
PY
echo '--- other stacks after the run'
docker ps --format '{{.Names}} {{.Status}}' | grep -E 'orbit-showcase|chatapp|deepseek' | awk '{print $1, $2, $3, $4, $5}'
