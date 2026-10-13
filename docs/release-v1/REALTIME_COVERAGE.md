# Realtime scope and coverage

Live map and departures are separate from scheduled itineraries. Schedule DTO declares realTimeApplied=false: delays/cancellations are not joined to trips without complete feed/service-date/route/trip/stop-sequence identity.

Bus: NTA GPS observation, own timestamp, collector/source health; recent means at most180s old (small clock tolerance15s). Missing/stale/unavailable/empty remain explicit. Rail: reported position with unknown observation time and precision, not GPS proof or interpolation. Render observation2026-10-13T04:05:26Z: bus empty, rail/departures ready, collector healthy, recent bus GPS count0. Earlier counts are historical, not continuous coverage guarantees.

Candidate cancellation state uses cancellationObservedAt independently of prediction timestamps. Fresh own observations can confirm cancellation; missing/old/future legacy observations show Cancellation unconfirmed · check operator. They never silently become Scheduled. This candidate is unpublished; original APIv2/source behavior remains public.

Regional rail coverage includes Ballina, Foxford, Castlebar and Westport in official schedules. Source ready is not proof every regional vehicle is visible. Actual bus route/operator availability, complete train identity and cancellation reconciliation remain UNVERIFIED. Tests simulate negative contracts and do not fabricate live observations.
