#!/bin/bash
# Run before every git push:
# sh build.sh
npx terser app.js --compress --mangle --comments false -o app.min.js
echo "app.min.js updated ($(wc -c < app.min.js) bytes)"
