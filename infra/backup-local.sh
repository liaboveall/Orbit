#!/usr/bin/env bash
# Nightly backup for the single-host deployment with the "local-storage" profile
# (docs/OCI-DEPLOYMENT.md): a verified database dump plus an archive of the SeaweedFS
# volume, kept for 7 days on the server. Copy them off the server as the guide describes;
# this script alone is not an offsite backup.
set -euo pipefail
umask 077
compose_file="${ORBIT_COMPOSE_FILE:-/opt/orbit/compose.yml}"
backup_dir="${ORBIT_BACKUP_DIR:-/opt/orbit/backups}"
database="${ORBIT_BACKUP_DATABASE:-orbit_prod}"
compose() { docker compose -f "$compose_file" "$@"; }

install -d -m 700 "$backup_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump="$backup_dir/orbit-$stamp-$$.dump"
archive="$backup_dir/storage-$stamp-$$.tar.gz"
storage_stopped=0
cleanup() {
  rm -f -- "$dump.partial" "$archive.partial"
  # Never leave attachments offline because a later step failed.
  if [ "$storage_stopped" = 1 ]; then compose start storage > /dev/null || true; fi
}
trap cleanup EXIT

# Database first: every attachment the dump marks ready was written to storage before
# that, so the archive taken next contains it. pg_dump reads a consistent snapshot.
compose exec -T postgres pg_dump -U postgres -Fc "$database" > "$dump.partial"
test -s "$dump.partial"
compose exec -T postgres pg_restore --list < "$dump.partial" > /dev/null
mv -- "$dump.partial" "$dump"

# Stop storage so its data files are consistent; web keeps running and attachment
# requests answer 503 for these seconds. Read the volume as its owner, not as root.
compose stop storage > /dev/null
storage_stopped=1
compose run --rm --no-deps -T --user seaweed --entrypoint tar storage -czf - -C /data . > "$archive.partial"
compose start storage > /dev/null
storage_stopped=0
test -s "$archive.partial"
tar -tzf "$archive.partial" > /dev/null
mv -- "$archive.partial" "$archive"

# Delete only this script's completed files older than 7 days.
find "$backup_dir" -maxdepth 1 -type f \( -name 'orbit-????????T??????Z-*.dump' -o -name 'storage-????????T??????Z-*.tar.gz' \) -mtime +7 -delete
printf '{"event":"local_backup_complete","databaseBytes":%s,"databaseSha256":"%s","storageBytes":%s,"storageSha256":"%s"}\n' \
  "$(stat -c %s "$dump")" "$(sha256sum "$dump" | cut -d ' ' -f 1)" \
  "$(stat -c %s "$archive")" "$(sha256sum "$archive" | cut -d ' ' -f 1)"
