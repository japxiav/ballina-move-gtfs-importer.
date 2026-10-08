// Ballina Move v0.9.9 staging gate.
// This is NOT the v0.9.9 routing engine. It is a fail-closed landing zone for
// future CI-verified deployment. No data fetch, no Stadia calls, no secrets.
const SERVICE = "ballina-routing-v099-staging";
const common = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
Deno.serve((request: Request) => {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname.endsWith("/health")) {
    return new Response(JSON.stringify({
      service: SERVICE,
      candidate_version: "0.9.9",
      phase: "sealed_preflight_only",
      route_planning_enabled: false,
      paid_provider_calls_enabled: false,
      production_untouched: true,
      note: "Deploy the reviewed routing engine only after CI, credential and budget gates."
    }), {status: 200, headers: common});
  }
  return new Response(JSON.stringify({
    error: "staging_not_enabled",
    service: SERVICE,
    route_planning_enabled: false
  }), {status: 503, headers: common});
});
