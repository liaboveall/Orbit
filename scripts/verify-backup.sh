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

# infra/backup-local.sh (local-storage profile): storage must always be restarted and
# unverified files must never be kept.
mkdir -p "$work/volume" && printf 'synthetic-object' > "$work/volume/object"
cat > "$work/bin/docker" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *pg_dump*) printf 'synthetic-dump-only' ;;
  *pg_restore*) cat >/dev/null; [ "${LOCAL_TEST_BAD_DUMP:-0}" = 0 ] ;;
  *" stop storage") echo stop >> "$LOCAL_TEST_CALLS" ;;
  *" start storage") echo start >> "$LOCAL_TEST_CALLS" ;;
  *"--user seaweed --entrypoint tar storage -czf - -C /data ."*)
    [ "${LOCAL_TEST_TAR_FAIL:-0}" = 0 ] || { printf 'partial'; exit 1; }
    tar -czf - -C "$LOCAL_TEST_VOLUME" . ;;
  *) exit 99 ;;
esac
STUB
export ORBIT_BACKUP_DIR="$work/local" LOCAL_TEST_CALLS="$work/calls" LOCAL_TEST_VOLUME="$work/volume"
bash /source/infra/backup-local.sh > /dev/null
test "$(find "$work/local" -name 'orbit-*.dump' | wc -l)" = 1
tar -tzf "$(find "$work/local" -name 'storage-*.tar.gz')" | grep -q object
test "$(tr '\n' ' ' < "$work/calls")" = "stop start "
: > "$work/calls"
if LOCAL_TEST_TAR_FAIL=1 bash /source/infra/backup-local.sh; then
  printf 'Failed storage archive incorrectly accepted\n' >&2; exit 1
fi
test "$(tr '\n' ' ' < "$work/calls")" = "stop start "
test "$(find "$work/local" -name 'storage-*.tar.gz' | wc -l)" = 1
: > "$work/calls"
if LOCAL_TEST_BAD_DUMP=1 bash /source/infra/backup-local.sh; then
  printf 'Unreadable dump incorrectly accepted\n' >&2; exit 1
fi
test ! -s "$work/calls"
test "$(find "$work/local" -name 'orbit-*.dump' | wc -l)" = 2
test -z "$(find "$work/local" -name '*.partial')"
printf '{"localBackupAccepted":true,"storageRestartedAfterFailure":true,"unreadableDumpRejectedBeforeStop":true,"temporaryFilesRemoved":true}\n'
