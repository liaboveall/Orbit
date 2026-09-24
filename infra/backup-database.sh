#!/usr/bin/env bash
# Root-owned configuration: /etc/orbit-backup.env (mode 600).
set -euo pipefail
umask 077
source /etc/orbit-backup.env
: "${ORBIT_BACKUP_BUCKET:?Set the dedicated private backup bucket}"
: "${AWS_PROFILE:?Set a backup-only AWS CLI profile}"
export AWS_PROFILE
export AWS_PAGER=""
backup_dir=/opt/orbit/backups
install -d -m 700 "$backup_dir"
name="orbit-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
partial="$backup_dir/$name.partial"
trap 'rm -f -- "$partial"' EXIT
docker compose -f /opt/orbit/compose.yml exec -T postgres pg_dump -U postgres -Fc orbit_prod > "$partial"
test -s "$partial"
docker compose -f /opt/orbit/compose.yml exec -T postgres pg_restore --list < "$partial" > /dev/null
mv -- "$partial" "$backup_dir/$name"
digest=$(sha256sum "$backup_dir/$name" | cut -d ' ' -f 1)
bytes=$(stat -c %s "$backup_dir/$name")
aws s3 cp "$backup_dir/$name" "s3://$ORBIT_BACKUP_BUCKET/database/$name" --only-show-errors --sse AES256 --metadata "sha256=$digest"
remote_bytes=$(aws s3api head-object --bucket "$ORBIT_BACKUP_BUCKET" --key "database/$name" --query ContentLength --output text)
test "$bytes" = "$remote_bytes"
# F40②：仅比长度无法发现「同长度损坏」；下载远端对象复核 sha256（可信校验），
# 校验失败即以非零退出，本地的该份 dump 保留供排查。
remote_copy="$backup_dir/$name.remote"
trap 'rm -f -- "$partial" "$backup_dir/$name.remote"' EXIT
aws s3 cp "s3://$ORBIT_BACKUP_BUCKET/database/$name" "$remote_copy" --only-show-errors
remote_digest=$(sha256sum "$remote_copy" | cut -d ' ' -f 1)
test "$digest" = "$remote_digest"
rm -f -- "$remote_copy"
# Delete only this script's completed old dumps, after a verified offsite copy.
find "$backup_dir" -maxdepth 1 -type f -name 'orbit-????????T??????Z-*.dump' -mtime +7 -delete
printf '{"event":"database_backup_complete","bytes":%s}\n' "$bytes"
