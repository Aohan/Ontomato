#!/bin/sh
set -eu

# The ontology manager talks to DataRAG directly, without the ontomato Node service:
# the browser calls ${ONTOLOGY_API_BASE}/data-query/*, this script strips that prefix
# and proxies to DATARAG_ORIGIN.
: "${DATARAG_ORIGIN:?DATARAG_ORIGIN must be the DataRAG origin, e.g. http://datarag:18087}"
: "${ONTOLOGY_API_BASE:=/api}"
: "${ONTOLOGY_INITIAL_ROUTE:=/discover}"

# Strip a trailing slash so the proxy target cannot produce a // path.
DATARAG_ORIGIN="${DATARAG_ORIGIN%/}"

export ONTOLOGY_API_BASE ONTOLOGY_INITIAL_ROUTE

envsubst '${ONTOLOGY_API_BASE} ${ONTOLOGY_INITIAL_ROUTE}' \
  < /usr/share/nginx/html/config.js.template \
  > /usr/share/nginx/html/config.js

# proxy_read_timeout stays unset on purpose: the Nginx default (60s) is kept.
API_LOCATION="location ${ONTOLOGY_API_BASE}/data-query/ {
  proxy_pass ${DATARAG_ORIGIN}/;
  proxy_http_version 1.1;
  proxy_set_header Host \$proxy_host;
  proxy_set_header X-Real-IP \$remote_addr;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto \$scheme;
}"

export API_LOCATION
envsubst '${API_LOCATION}' \
  < /etc/nginx/templates/ontology-manager.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
