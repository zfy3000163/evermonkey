Mermaid 10.9.1 browser UMD bundle, vendored for offline PNG rendering.

Source: https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js
License: MIT (see LICENSE in this directory).

The renderer uses no CDN at runtime. When updating the bundle, verify flowchart
and sequenceDiagram rasterization and the exact Markdown round trip. The bundle
bytes are included in the cache key, so an update invalidates previous PNGs.
