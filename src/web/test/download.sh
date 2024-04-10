#!/usr/bin/env bash

set -Eeuo pipefail

pushd "$(dirname "$0")" >/dev/null

url=${1/#https:\/\/}
dir="$(node -p "encodeURIComponent('${url//"'"/"\\'"}')")"
mkdir "$dir"
curl -fLSs --output "$dir/src.html" "https://$url"
