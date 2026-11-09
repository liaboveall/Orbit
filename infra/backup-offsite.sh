#!/usr/bin/env bash
# Encrypted off-site copy of the newest complete local batch, plus the configuration
# needed to rebuild the host. Uses restic against the private bucket in backup.env, then
# reads the batch back from the remote and checks it against the local checksum manifest.
# The restic password in restic-password must also be kept off this host.
set -euo pipefail
umask 077
root="${ORBIT_ROOT:-/opt/orbit}"
backup_dir="$root/backups"
image=restic/restic:0.19.1@sha256:136600b6ff6843d61d355f7f71f460a166429f35de6fd11b568fece3c9a4d510
host=orbit-prod

restic() {
  docker run --rm --memory 1g --env-file "$root/backup.env" \
    -e RESTIC_PASSWORD_FILE=/run/restic-password \
    -v "$root/restic-password:/run/restic-password:ro" \
    -v "$root:/orbit:ro" \
    ${restore_mount:+-v "$restore_mount:/restore"} \
    "$image" --no-cache "$@" < /dev/null
}

exec 9>"$backup_dir/.offsite.lock"
flock -n 9 || { echo 'An off-site backup is already running' >&2; exit 1; }

batch=$("$root/select-backup.sh")
restore_mount=""
verify_dir=""
cleanup() { if [ -n "$verify_dir" ]; then rm -rf -- "$verify_dir"; fi; }
trap cleanup EXIT

# Exit code 10 means the repository does not exist yet. Any other failure must not
# be mistaken for that, or a network error would try to create a new repository.
code=0
restic cat config > /dev/null 2>&1 || code=$?
case "$code" in
  0) ;;
  10) restic init > /dev/null ;;
  *) echo "Cannot read the repository (restic exit $code)" >&2; exit 1 ;;
esac
restic unlock > /dev/null 2>&1 || true

snapshot=$(restic backup --json --host "$host" --tag "batch-$batch" \
  "/orbit/backups/orbit-$batch.dump" \
  "/orbit/backups/storage-$batch.tar.gz" \
  "/orbit/backups/backup-$batch.sha256" \
  /orbit/app.env /orbit/db.env /orbit/storage.env /orbit/.env /orbit/compose.yml \
  | tail -1 | sed -E 's/.*"snapshot_id":"([0-9a-f]+)".*/\1/')
[[ "$snapshot" =~ ^[0-9a-f]{64}$ ]] || { echo 'restic did not report a snapshot id' >&2; exit 1; }

# Prove the remote copy is readable and byte-identical before calling this a backup.
verify_dir=$(mktemp -d "$backup_dir/.offsite-verify-XXXXXX")
restore_mount="$verify_dir"
restic restore "$snapshot" --target /restore --include "/orbit/backups" > /dev/null
(cd "$verify_dir/orbit/backups" && sha256sum --status -c "backup-$batch.sha256")
restore_mount=""

# Batch file names change every run, so group by host or nothing would ever expire.
restic forget --host "$host" --group-by host --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune > /dev/null
restic check > /dev/null

date -u +%s > "$backup_dir/.offsite-last-success"
printf '{"event":"offsite_backup_complete","batch":"%s","snapshot":"%s","readBack":"sha256_match"}\n' "$batch" "${snapshot:0:12}"
