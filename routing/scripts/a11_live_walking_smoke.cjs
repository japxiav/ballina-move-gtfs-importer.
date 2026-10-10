'use strict';
/*
 * A11 isolated, bounded real-Stadia smoke check. This is NOT an API endpoint or
 * a passenger routing service. The two points are public GTFS/example positions.
 * Zero paid calls unless explicitly invoked with --live and STADIA_API_KEY.
 */
const scenarios=Object.freeze([
  Object.freeze({id:'ballina-bus-station-access',
    from:Object.freeze({lat:54.1118,lon:-9.1613}),
    to:Object.freeze({lat:54.11101,lon:-9.1599}),
    roles:Object.freeze({fromRole:'user',toRole:'stop'})}),
  Object.freeze({id:'ballina-central-walk',
    from:Object.freeze({lat:54.110123,lon:-9.150123}),
    to:Object.freeze({lat:54.11101,lon:-9.1599}),
    roles:Object.freeze({fromRole:'user',toRole:'stop'})}),
]);
async function runChecks(walker){
  const checked=[];
  for(const s of scenarios){
    // No retries. At most two provider requests per CLI invocation.
    const result=await walker.walk(s.from,s.to,s.roles);
    if(!result)throw new Error('provider_route_missing:'+s.id);
    if(result.provider!=='stadia-valhalla-pedestrian' ||
       !Number.isFinite(result.distanceMeters) || result.distanceMeters<=0 ||
       !Number.isFinite(result.durationSeconds) || result.durationSeconds<=0 ||
       !Array.isArray(result.geometry) || result.geometry.length<2)
      throw new Error('invalid_provider_route:'+s.id);
    checked.push({id:s.id,distanceMeters:result.distanceMeters,
      durationSeconds:result.durationSeconds,shapePoints:result.geometry.length,
      snapped:result.endpointSnapMeters??null,
      requiresSnapConfirmation:Boolean(result.requiresSnapConfirmation),
      unverifiedConnectorMeters:result.unverifiedConnector?.meters??0,
      provider:result.provider});
  }
  return checked;
}
if(require.main===module){
  (async()=>{
    if(process.argv.length!==3 || process.argv[2]!=='--live'){
      console.error('No network by default. To explicitly run max 2 paid queries: STADIA_API_KEY=<secret> node scripts/a11_live_walking_smoke.cjs --live');
      process.exitCode=2;return;
    }
    const key=process.env.STADIA_API_KEY;
    if(!key){console.error('Missing STADIA_API_KEY. No provider request was made.');process.exitCode=2;return;}
    const {StadiaWalkingRouter}=require('../dist/index.js');
    try{
      const results=await runChecks(new StadiaWalkingRouter(key));
      console.log(JSON.stringify({mode:'private_smoke_only',maxProviderQueries:2,notForPassengers:true,
        warning:'Street snap gaps are unverified; a route from a provider does not verify pavement or accessibility.',results},null,2));
    }catch(err){
      // Avoid accidentally printing provider request internals or keys.
      console.error('A11 live smoke failed; see provider configuration, coverage and network status.');
      process.exitCode=1;
    }
  })();
}
module.exports={runChecks,scenarios};
