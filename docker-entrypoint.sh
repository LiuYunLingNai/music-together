#!/bin/sh
set -eu

# Existing deployments may mount a data directory created by an older image as
# root. Repair only the application data directory before dropping privileges.
mkdir -p /app/data
chown -R node:node /app/data

exec su-exec node "$@"
