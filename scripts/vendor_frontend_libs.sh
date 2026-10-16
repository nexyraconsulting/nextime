#!/usr/bin/env bash
# Downloads the three front-end libraries into assets/vendor/ and points the pages at them,
# so the browser no longer loads anything from unpkg.com. Run once from the package root:
#   bash scripts/vendor_frontend_libs.sh
# Then remove https://unpkg.com from the Content-Security-Policy (config/nginx.conf).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets/vendor

fetch() { echo "Downloading $2"; curl -fsSL "$1" -o "assets/vendor/$2"; }
fetch https://unpkg.com/react@18.3.1/umd/react.production.min.js react.production.min.js
fetch https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js react-dom.production.min.js
fetch https://unpkg.com/qrcode-generator@1.4.4/qrcode.js qrcode.js

# support.js keeps its Subresource Integrity hashes, so the local files must be byte-identical to the CDN ones.
sed -i.bak \
  -e 's#https://unpkg.com/react@18.3.1/umd/react.production.min.js#/assets/vendor/react.production.min.js#' \
  -e 's#https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js#/assets/vendor/react-dom.production.min.js#' \
  support.js
sed -i.bak -e "s#https://unpkg.com/qrcode-generator@1.4.4/qrcode.js#assets/vendor/qrcode.js#" assets/js/appConfig.js
rm -f support.js.bak assets/js/appConfig.js.bak

echo "Done. Check https://<your-domain>/ loads with no requests to unpkg.com, then tighten the CSP."
