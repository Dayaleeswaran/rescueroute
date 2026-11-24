# Geographic map and live panel

## What is real, and what is a demo?

- **Basemap:** real OpenStreetMap geography, rendered with locally vendored Leaflet 1.9.4. Internet access is required for map tiles. The entity list and detail panel remain available if tiles fail.
- **Seeded organisations:** fictional. Their old kilometre-grid points are projected to illustrative placements near Colombo, Sri Lanka. Labels say “Demo placement”; these are not verified addresses or actual donors.
- **Entered coordinates:** profile owners or coordinators can choose “Use the coordinates below” and enter latitude, longitude, and a location label. These locations persist. Entered coordinates are labelled separately from shared GPS.
- **Planning links:** geographic straight lines linking the driver, donor, and recipient from the plan snapshot. They are not roads, traffic-aware routes, live ETAs, or turn-by-turn navigation.
- **Demo movement:** a coordinator-controlled, explicitly labelled moving marker. It follows an illustrative trip link, or a small loop when no trip is assigned. It never changes inventory, delivery status, or the planning clock.
- **Shared GPS:** a browser/device location fix sent only after the volunteer explicitly clicks Share my location and grants browser permission. Its accuracy and update time are displayed. It does not automatically move the profile's planning origin or change an existing schedule.

## Using the panel

Open **Live network** from any role's navigation. Coordinators also see the geographic map on Overview.

1. Click a map marker or select an entity in the searchable list.
2. Inspect contact information, quantities, collection/delivery windows, handling, declared allergens, or volunteer capacity and shift.
3. Filter donors, recipients, or volunteers, and use Fit network to frame the visible markers.
4. As a coordinator, choose an available volunteer and run the demo movement. Stop it when finished. A demo cannot overwrite an existing GPS fix.
5. As a volunteer, use Share my location. The browser permission prompt is separate from the app's permission check. Stop sharing clears the browser watch, waits for any in-flight update, and removes the server's latest fix.

Live network changes use an authenticated Server-Sent Events connection. Events carry only invalidation messages, not coordinates or other private records. Clients fetch their own server-filtered state after an event. Network mutations refresh panels; tracking updates move markers and refresh details without recreating the map or resetting its view.

Editing forms are not replaced by a live update. Updates are deferred until the form closes, and revision checks still protect stale writes. Tracking updates do not increment the operational revision or stale a delivery draft.

## GPS privacy and limits

- Only a volunteer can submit their own location. A coordinator cannot forge another volunteer's GPS fix through the GPS endpoint.
- Coordinates and accuracy are shown to coordinators, the volunteer, and donors/recipients with an **active assigned delivery** involving that volunteer. Unrelated users and completed-delivery participants do not receive that live fix.
- Only the latest fix is kept in server memory. It is not written to the operational data file, audit log, or report export. There is no location history.
- A fix is labelled stale after two minutes and is no longer exposed after ten minutes without another update. Browser-side expiry removes an old marker even if no new event arrives.
- Stop sharing removes the latest fix immediately after any already-issued update finishes. Logout clears that user's fix. Closing the page sends a best-effort stop request; loss of connectivity cannot guarantee delivery of that request, so expiry is the fallback.
- Device accuracy is reported as received and can be poor. No actual speed, trip completion, or arrival is inferred from GPS.
- Location updates are throttled in both client and server. Denial, unavailable hardware, and timeout have explicit feedback.
- Latitude is restricted to -85 through 85 for the Web Mercator basemap; longitude is -180 through 180.
- Browser geolocation needs a secure context. Localhost works for local evaluation. Phone or remote-device use requires an HTTPS deployment with suitable host, authentication, and privacy configuration. Visiting localhost on a phone does not connect to the computer's server.
- OpenStreetMap tile requests reveal the viewed region and browser IP to the tile provider. Explicit “Open these coordinates” links also send the chosen coordinates to OpenStreetMap when clicked.

## Geographic planning and migration

The application planner now receives a geographic scenario and uses great-circle (Haversine) kilometres. The pure planner still supports old grid scenarios for reproducible tests. Old stored plans are identified by their snapshot coordinate system; their committed trip endpoints are converted for display and future residual planning, without rewriting history.

Travel time remains an assumed 24 km/h plus four minutes per stop. Geographic distance is not road distance. Existing reservations and source locks remain intact. Tracking coordinates are intentionally separate from committed schedule coordinates.

## Endpoints

| Route                     | Access / effect                                                            |
| ------------------------- | -------------------------------------------------------------------------- |
| `GET /api/events`         | Authenticated SSE; revalidates access on events/heartbeats; max 32 streams |
| `POST /api/tracking/gps`  | Volunteer only; own latitude, longitude, and accuracy                      |
| `POST /api/tracking/demo` | Coordinator/admin; volunteer ID and 0–1 progress fraction                  |
| `POST /api/tracking/stop` | Own GPS sharing, or coordinator-controlled demo fix                        |
| `GET /api/state`          | Includes role-filtered `mapData`, markers, fixes, and planning links       |

Mutation endpoints require the normal session and CSRF token. GPS/demo updates do not modify stock or persisted plans.

## Verification

Automated checks cover geographic distance, permissions, participant visibility, GPS expiry, demo isolation, SSE payloads, click-through details, and the in-flight stop race. DOM tests run the map's accessible list and controls against the real HTTP API; they do not verify tile rendering or actual device geolocation hardware. Visual map rendering and device-permission flows still need a real browser review.
