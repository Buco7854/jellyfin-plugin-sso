#!/usr/bin/env bash

set -euo pipefail

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repository_root=$(cd -- "${script_directory}/.." && pwd)
plugin_version=$(sed -n 's/^version: "\([^"]*\)"/\1/p' "${repository_root}/build.yaml" | head -n 1)
package_timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
artifact_directory="${repository_root}/artifacts"
package_workspace=$(mktemp -d /tmp/jellyfin-sso-package.XXXXXX)
publish_directory="${package_workspace}/publish"
package_directory="${package_workspace}/package"
archive_path="${artifact_directory}/jellyfin-plugin-sso_${plugin_version}_jellyfin12.zip"

cleanup() {
  find "${package_workspace}" -depth -delete
}
trap cleanup EXIT

if [[ -z "${plugin_version}" ]]; then
  echo "Unable to read the plugin version from build.yaml." >&2
  exit 1
fi

command -v dotnet >/dev/null || {
  echo "The .NET 10 SDK is required." >&2
  exit 1
}

command -v zip >/dev/null || {
  echo "The zip command is required." >&2
  exit 1
}

dotnet publish "${repository_root}/SSO-Auth/SSO-Auth.csproj" \
  --configuration Release \
  --output "${publish_directory}" \
  --nologo

mkdir -p "${package_directory}" "${artifact_directory}"

for artifact in SSO-Auth.dll Duende.IdentityModel.OidcClient.dll Duende.IdentityModel.dll; do
  if [[ ! -f "${publish_directory}/${artifact}" ]]; then
    echo "Expected publish artifact is missing: ${artifact}" >&2
    exit 1
  fi

  cp "${publish_directory}/${artifact}" "${package_directory}/${artifact}"
done

printf '%s\n' \
  '{' \
  '  "category": "Authentication",' \
  '  "changelog": "Jellyfin 12 compatibility test build",' \
  '  "description": "Authenticate users against an SSO provider.",' \
  '  "guid": "505ce9d1-d916-42fa-86ca-673ef241d7df",' \
  '  "name": "SSO Authentication",' \
  '  "overview": "Authenticate users against an SSO provider.",' \
  '  "owner": "Buco7854",' \
  '  "targetAbi": "12.0.0.0",' \
  "  \"timestamp\": \"${package_timestamp}\"," \
  "  \"version\": \"${plugin_version}\"," \
  '  "status": "Active",' \
  '  "autoUpdate": false' \
  '}' >"${package_directory}/meta.json"

if [[ -f "${archive_path}" ]]; then
  unlink "${archive_path}"
fi

(
  cd "${package_directory}"
  zip -q "${archive_path}" ./*
)

echo "Created ${archive_path}"
