#!/usr/bin/env bash
# Run only in a disposable, network-disabled Linux container as root.
set -euo pipefail
test -f /.dockerenv
work=$(mktemp -d)
mkdir -p "$work/bin"
printf 'ORBIT_BACKUP_BUCKET=synthetic\nAWS_PROFILE=synthetic\n' > /etc/orbit-backup.env
cat > "$work/bin/docker" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *pg_dump*) printf 'synthetic-dump-only' ;;
  *pg_restore*) cat >/dev/null ;;
  *) exit 99 ;;
esac
STUB
cat > "$work/bin/aws" <<'STUB'
#!/usr/bin/env bash
set -eu
if [ "$1" = s3api ]; then stat -c %s "$BACKUP_TEST_REMOTE"; exit; fi
if [[ "$3" = s3://* ]]; then
  cp "$BACKUP_TEST_REMOTE" "$4"
  if [ "${BACKUP_TEST_CORRUPT:-0}" = 1 ]; then printf X | dd of="$4" bs=1 count=1 conv=notrunc status=none; fi
else cp "$3" "$BACKUP_TEST_REMOTE"; fi
STUB
chmod +x "$work/bin/docker" "$work/bin/aws"
export PATH="$work/bin:$PATH" BACKUP_TEST_REMOTE="$work/remote.dump"
bash /source/infra/backup-database.sh
before=$(find /opt/orbit/backups -name '*.dump' | wc -l)
if BACKUP_TEST_CORRUPT=1 bash /source/infra/backup-database.sh; then
  printf 'Corrupt backup incorrectly accepted\n' >&2; exit 1
fi
after=$(find /opt/orbit/backups -name '*.dump' | wc -l)
test "$after" -gt "$before"
test -z "$(find /opt/orbit/backups -name '*.partial' -o -name '*.remote')"
printf '{"normalCopyAccepted":true,"sameLengthCorruptionRejected":true,"failedLocalDumpPreserved":true,"temporaryFilesRemoved":true}\n'
