FROM nginx:1.29.8-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de
COPY response.txt /usr/share/nginx/html/index.html
COPY log-marker.sh /docker-entrypoint.d/40-e2e-marker.sh
RUN chmod +x /docker-entrypoint.d/40-e2e-marker.sh && echo E2E_SOURCE_BUILD_COMPLETE
