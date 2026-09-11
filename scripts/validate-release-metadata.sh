#!/usr/bin/env bash

set -euo pipefail

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repository_root=$(cd -- "${script_directory}/.." && pwd)
build_file="${repository_root}/build.yaml"
project_file="${repository_root}/SSO-Auth/SSO-Auth.csproj"
plugin_file="${repository_root}/SSO-Auth/SSOPlugin.cs"
api_client_file="${repository_root}/SSO-Auth/Views/apiClient.js"
# Jellyfin uses these values to associate and clean up installed versions.
# Changing either one requires an explicit migration strategy.
stable_plugin_name="SSO-Auth"
stable_plugin_guid="505ce9d1-d916-42fa-86ca-673ef241d7df"

package_name=$(sed -n 's/^name: "\([^"]*\)"$/\1/p' "${build_file}" | head -n 1)
package_guid=$(sed -n 's/^guid: "\([^"]*\)"$/\1/p' "${build_file}" | head -n 1)
package_version=$(sed -n 's/^version: "\([^"]*\)"$/\1/p' "${build_file}" | head -n 1)
runtime_name=$(sed -n 's/.*public override string Name => "\([^"]*\)";.*/\1/p' "${plugin_file}" | head -n 1)
runtime_guid=$(sed -n 's/.*public override Guid Id => Guid.Parse("\([^"]*\)");.*/\1/p' "${plugin_file}" | head -n 1)
assembly_version=$(sed -n 's/.*<AssemblyVersion>\([^<]*\)<\/AssemblyVersion>.*/\1/p' "${project_file}" | head -n 1)
file_version=$(sed -n 's/.*<FileVersion>\([^<]*\)<\/FileVersion>.*/\1/p' "${project_file}" | head -n 1)
client_name=$(sed -n 's/^const APP_NAME = "\([^"]*\)";$/\1/p' "${api_client_file}" | head -n 1)
client_version=$(sed -n 's/^const APP_VERSION = "\([^"]*\)";$/\1/p' "${api_client_file}" | head -n 1)
validation_errors=0

require_value() {
  local label=$1
  local value=$2

  if [[ -z "${value}" ]]; then
    echo "Unable to read ${label}." >&2
    validation_errors=$((validation_errors + 1))
  fi
}

require_equal() {
  local label=$1
  local expected=$2
  local actual=$3

  if [[ "${expected}" != "${actual}" ]]; then
    echo "${label} mismatch: expected '${expected}', found '${actual}'." >&2
    validation_errors=$((validation_errors + 1))
  fi
}

require_value "package name from build.yaml" "${package_name}"
require_value "package GUID from build.yaml" "${package_guid}"
require_value "package version from build.yaml" "${package_version}"
require_value "runtime plugin name from SSOPlugin.cs" "${runtime_name}"
require_value "runtime plugin GUID from SSOPlugin.cs" "${runtime_guid}"
require_value "assembly version from SSO-Auth.csproj" "${assembly_version}"
require_value "file version from SSO-Auth.csproj" "${file_version}"
require_value "client name from apiClient.js" "${client_name}"
require_value "client version from apiClient.js" "${client_version}"

require_equal "Stable package name" "${stable_plugin_name}" "${package_name}"
require_equal "Stable plugin GUID" "${stable_plugin_guid}" "${package_guid}"
require_equal "Package/runtime plugin name" "${package_name}" "${runtime_name}"
require_equal "Package/runtime plugin GUID" "${package_guid}" "${runtime_guid}"
require_equal "Package/assembly version" "${package_version}" "${assembly_version}"
require_equal "Package/file version" "${package_version}" "${file_version}"
require_equal "Runtime/client name" "${runtime_name}" "${client_name}"
require_equal "Package/client version" "${package_version}" "${client_version}"

if ((validation_errors > 0)); then
  exit 1
fi

echo "Release metadata is consistent for ${package_name} ${package_version}."
