# shellcheck shell=sh
# NetHelper: shared pieces of the upgrade commands. Sourced (never run) by
#   deploy/install.sh --upgrade        (Docker Compose)
#   nethelper-admin upgrade            (bare metal)
#
# An upgrade is run by the release being replaced, so this file only fetches
# and checks the new release and swaps the trees; everything after the swap is
# done by the new release's own scripts.
#
# The caller defines die(). Where releases come from can be changed (a mirror
# for a host without internet access):
#   NETHELPER_RELEASE_API    URL answering GitHub's "latest release" JSON
#   NETHELPER_RELEASE_BASE   URL holding v<version>/nethelper-<version>.tar.gz(.sha256)

NETHELPER_RELEASE_API=${NETHELPER_RELEASE_API:-https://api.github.com/repos/bryanbuck/nethelper/releases/latest}
NETHELPER_RELEASE_BASE=${NETHELPER_RELEASE_BASE:-https://github.com/bryanbuck/nethelper/releases/download}

# up_download URL FILE
up_download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --max-time 600 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 60 -O "$2" "$1"
  else
    die "curl or wget is needed to download the release"
  fi
}

# up_http_ok URL: does a GET answer 2xx within a few seconds?
up_http_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 5 -o /dev/null "$1" 2>/dev/null
  else
    wget -q -T 5 -O /dev/null "$1" 2>/dev/null
  fi
}

# A version is used in file names and URLs: digits, letters, dots and dashes only.
up_check_version() {
  case "$1" in
    ''|.*|-*|*[!0-9A-Za-z.-]*) die "not a version: '$1' (expected something like 0.9.1)" ;;
  esac
}

# up_latest_version DIR: print the newest full release's version (no leading v).
up_latest_version() {
  up_download "$NETHELPER_RELEASE_API" "$1/latest.json" \
    || die "couldn't ask GitHub for the latest release. Name one with --version, or check this host's internet access."
  up_latest=$(sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' "$1/latest.json" | head -n 1)
  rm -f "$1/latest.json"
  [ -n "$up_latest" ] || die "couldn't read the latest release's version from GitHub's answer. Name one with --version."
  up_check_version "$up_latest"
  printf '%s\n' "$up_latest"
}

# up_fetch_release VERSION DIR: download, verify and unpack into DIR/nethelper-VERSION.
up_fetch_release() {
  up_name="nethelper-$1"
  up_url="$NETHELPER_RELEASE_BASE/v$1"
  command -v tar >/dev/null 2>&1 || die "tar is needed to unpack the release"
  printf 'Downloading %s.tar.gz\n' "$up_name"
  up_download "$up_url/$up_name.tar.gz" "$2/$up_name.tar.gz" \
    || die "couldn't download $up_url/$up_name.tar.gz (is $1 a published release?)"
  up_download "$up_url/$up_name.tar.gz.sha256" "$2/$up_name.tar.gz.sha256" \
    || die "couldn't download the checksum of $up_name.tar.gz"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$2" && sha256sum -c "$up_name.tar.gz.sha256" >/dev/null 2>&1) \
      || die "the download doesn't match its checksum; nothing was changed"
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$2" && shasum -a 256 -c "$up_name.tar.gz.sha256" >/dev/null 2>&1) \
      || die "the download doesn't match its checksum; nothing was changed"
  else
    die "sha256sum is needed to check the download"
  fi
  # Everything must unpack under nethelper-<version>/.
  if tar tzf "$2/$up_name.tar.gz" | grep -v "^$up_name/" | grep -q .; then
    die "$up_name.tar.gz holds files outside $up_name/; not unpacking it"
  fi
  tar xzf "$2/$up_name.tar.gz" -C "$2" --no-same-owner
  [ "$(cat "$2/$up_name/VERSION" 2>/dev/null)" = "$1" ] \
    || die "$up_name.tar.gz doesn't hold NetHelper $1"
  [ -f "$2/$up_name/deploy/install.sh" ] || die "$up_name.tar.gz isn't a NetHelper release"
  printf 'Checksum OK.\n'
}

# up_added_migrations FROM_TREE TO_TREE: print the database migrations TO has and FROM lacks.
up_added_migrations() {
  for up_dir in "$2"/backend/prisma/migrations/*/; do
    [ -d "$up_dir" ] || continue
    up_migration=$(basename "$up_dir")
    [ -d "$1/backend/prisma/migrations/$up_migration" ] || printf '%s\n' "$up_migration"
  done
}

# up_refuse_downgrade CURRENT_TREE NEW_TREE: migrations only go forward.
up_refuse_downgrade() {
  if [ -n "$(up_added_migrations "$2" "$1")" ]; then
    die "that release is older than the database of this install (it lacks migrations this one has). Downgrading isn't supported; restore a backup taken on that version instead."
  fi
}

# up_check_previous CURRENT: CURRENT.previous, if there is one, must be a tree an
# earlier upgrade left (it is about to be removed). Call before changing anything.
up_check_previous() {
  [ ! -e "$1.previous" ] && return 0
  { [ -f "$1.previous/VERSION" ] && [ -f "$1.previous/deploy/install.sh" ]; } \
    || die "$1.previous exists and isn't a NetHelper tree an earlier upgrade left; move it away first"
}

# up_swap_trees CURRENT NEW: CURRENT becomes CURRENT.previous, NEW becomes CURRENT.
# One previous tree is kept; an older one is removed first.
up_swap_trees() {
  up_previous="$1.previous"
  up_check_previous "$1"
  if [ -e "$up_previous" ]; then
    printf 'Removing the tree kept by the upgrade before this one (%s, %s)\n' \
      "$up_previous" "$(cat "$up_previous/VERSION")"
    rm -rf "$up_previous"
  fi
  mv "$1" "$up_previous"
  if ! mv "$2" "$1"; then
    mv "$up_previous" "$1"
    die "couldn't move the new release into place; the install is unchanged"
  fi
}

# up_rollback_help TREE OLD_VERSION NEW_VERSION ARCHIVE MIGRATIONS RESTART_COMMAND [STOP_COMMAND]
# What to do when the new version didn't come up.
up_rollback_help() {
  printf '\n'
  printf 'NetHelper %s did not come up healthy. Nothing was rolled back automatically.\n' "$3"
  printf '  The %s tree is kept at: %s.previous\n' "$2" "$1"
  if [ -n "$4" ]; then
    printf '  Backup taken before the upgrade: %s (in the App Backup folder)\n' "$4"
  else
    printf '  No backup was taken by this upgrade (--no-backup).\n'
  fi
  printf '\n'
  printf 'To go back to %s:\n' "$2"
  [ -z "${7:-}" ] || printf '  %s\n' "$7"
  printf '  mv %s %s.failed && mv %s.previous %s\n' "$1" "$1" "$1" "$1"
  if [ -n "$5" ]; then
    printf '  %s has database migrations that %s lacks, and they may have run:\n' "$3" "$2"
    printf '%s\n' "$5" | sed 's/^/    /'
    printf '  so restore the backup before starting %s (docs/OPERATIONS.md, "Backup and restore"),\n' "$2"
    printf '  then: %s\n' "$6"
  else
    printf '  %s changes nothing in the database, so that is all; then: %s\n' "$3" "$6"
  fi
}
