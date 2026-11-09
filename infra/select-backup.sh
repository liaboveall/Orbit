#!/usr/bin/env bash
# Print the newest verified complete batch ID, never independent latest files.
set -euo pipefail
backup_dir="${ORBIT_BACKUP_DIR:-/opt/orbit/backups}"
cd "$backup_dir"
shopt -s nullglob
manifests=(backup-????????T??????Z-*.sha256)
for ((i=${#manifests[@]}-1; i>=0; i--)); do
  manifest=${manifests[i]}
  batch=${manifest#backup-}; batch=${batch%.sha256}
  [[ "$batch" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9]+$ ]] || continue
  # Exactly two expected filenames: never accept arbitrary paths in a manifest.
  [ "$(wc -l < "$manifest")" = 2 ] || continue
  grep -Eq "^[a-f0-9]{64}  orbit-$batch.dump$" "$manifest" || continue
  grep -Eq "^[a-f0-9]{64}  storage-$batch.tar.gz$" "$manifest" || continue
  if sha256sum --status -c "$manifest"; then printf '%s\n' "$batch"; exit 0; fi
done
echo 'No verified complete backup batch' >&2
exit 1
