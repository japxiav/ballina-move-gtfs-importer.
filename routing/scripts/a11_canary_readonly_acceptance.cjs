'use strict';
/* Private A11 post-deploy acceptance. Six GETs only. No paid walking requests. */
const assert = require('node:assert/strict');

const BASE = 'https://giwiqbnyozjbpmetrjhe.supabase.co/functions/v1/ballina-a11-realwalking-canary';
const TIMEOUT_MS = 15000;

async function checkCanary({anonJwt,previewToken,fetcher=fetch}={}) {
  if (typeof anonJwt !== 'string' || anonJwt.length < 30 ||
      typeof previewToken !== 'string' || previewToken.length < 32)
    throw new Error('required_GitHub_secrets_missing_or_invalid');
  if (!anonJwt.includes('.') || anonJwt.split('.').length !== 3)
    throw new Error('anon_key_must_be_legacy_JWT_not_sb_publishable_key');
  const auth={'apikey':anonJwt,'authorization':`Bearer ${anonJwt}`};
  let count=0;
  async function get(path,headers={}) {
    count++;
    if (count>6) throw new Error('read_only_request_cap_exceeded');
    const r=await fetcher(BASE+path,{
      method:'GET',headers:{accept:'application/json',...headers},
      signal:AbortSignal.timeout(TIMEOUT_MS),redirect:'error',
    });
    return r;
  }
  function requireDenied(response,label) {
    assert.ok([401,403].includes(response.status), `${label}_must_deny_http_${response.status}`);
  }
  requireDenied(await get('/health',{'x-ballina-preview-token':previewToken}), 'without_jwt');
  requireDenied(await get('/health',{...auth,'x-ballina-preview-token':'intentionally-invalid'}), 'wrong_preview_token');
  requireDenied(await get('/health',auth), 'without_preview_token');
  requireDenied(await get('/health',{...auth,'x-ballina-preview-token':previewToken,origin:'https://forbidden.example'}),'browser_origin');
  const good={...auth,'x-ballina-preview-token':previewToken};
  const hr=await get('/health',good);
  assert.equal(hr.status,200,`authenticated_health_http_${hr.status}`);
  const health=await hr.json();
  assert.equal(health.service,'ballina-a11-realwalking-canary');
  assert.equal(health.private,true);
  assert.equal(health.notForPassengers,true);
  assert.equal(health.syntheticWalking,false);
  assert.equal(health.ready,true,'canary_configuration_not_ready');
  assert.equal(health.stadiaConfigured,true,'stadia_not_configured');
  const gr=await get('/v1/gtfs-summary',good);
  assert.equal(gr.status,200,`authenticated_gtfs_http_${gr.status}`);
  const gtfs=await gr.json();
  assert.equal(gtfs.service,'ballina-a11-realwalking-canary');
  assert.equal(gtfs.notForPassengers,true);
  assert.equal(gtfs.paidWalkingCalls,0);
  assert.equal(typeof gtfs.feedVersion,'string');
  assert.ok(gtfs.feedVersion.length>10,'missing_feed_version');
  for (const k of ['stops','routes','trips','stopTimes']) {
    assert.ok(Number.isInteger(gtfs.counts?.[k]) && gtfs.counts[k]>0,`invalid_gtfs_${k}`);
  }
  return {status:'private_read_only_acceptance_success',requests:count,paidWalkingRequests:0,
    authenticationChecksPassed:4,canaryReady:true,
    feedVersionPrefix:gtfs.feedVersion.slice(0,10),
    counts:gtfs.counts};
}
if (require.main===module) {
  checkCanary({anonJwt:process.env.BALLINA_SUPABASE_ANON_JWT,
    previewToken:process.env.BALLINA_ROUTING_PREVIEW_TOKEN})
    .then(result=>console.log(JSON.stringify(result,null,2)))
    .catch(err=>{ // never print tokens, response bodies or URLs containing credentials
      const known=/^(required_GitHub_secrets_missing_or_invalid|anon_key_must_be_legacy_JWT_not_sb_publishable_key|read_only_request_cap_exceeded|canary_configuration_not_ready|stadia_not_configured|invalid_gtfs_\w+|missing_feed_version|authenticated_\w+_http_\d+|\w+_must_deny_http_\d+)$/;
      const message=String(err?.message||'');
      console.error(known.test(message)?message:'a11_read_only_acceptance_failed_check_secret_and_gateway_configuration');
      process.exitCode=1;
    });
}
module.exports={checkCanary,BASE};
