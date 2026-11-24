# Third-party software

RescueRoute vendors **Leaflet 1.9.4** for the interactive geographic map. The distribution JavaScript, CSS, and optional images come from the published `leaflet@1.9.4` npm package. The original BSD 2-Clause license is retained in [public/vendor/leaflet/LICENSE](public/vendor/leaflet/LICENSE).

- Project: https://leafletjs.com/
- Stable API reference: https://leafletjs.com/reference-1.9.4.html
- Source: https://github.com/Leaflet/Leaflet/tree/v1.9.4

The basemap uses OpenStreetMap's standard tile service and displays OpenStreetMap contributor attribution. Map tiles are not bundled or prefetched. Their availability is best effort, and usage must comply with https://operations.osmfoundation.org/policies/tiles/. Use an appropriate tile provider before public or high-volume deployment. The tile provider can see the requesting browser's IP address and viewed map area.

Leaflet code is served locally; the browser fetches only the visible map tiles from the external tile service. jsdom and its dependency licenses are installed with development packages; they are not required to start the application.
