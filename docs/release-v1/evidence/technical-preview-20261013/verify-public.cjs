'use strict';
const fs = require('node:fs'), assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {chromium} = require('/workspace/ballina-move-gtfs-importer./web/node_modules/playwright');
const {SmokeTileBudget} = require('./smoke-tile-budget.cjs');
const origin = 'https://ballina-move-live.onrender.com';
const out = '/workspace/.ballina-execution/product-mission/approved-preview';
const proof = {scope:'Actual published HTTPS frontend and actual public API responses; no fixtures or clock override. Map PNGs fetched with native verified TLS through bounded image dispatcher.',sourceCommit:'06b72b428fa623e7daf4d244b4851683506b78d0',observedAt:new Date().toISOString(),target:origin,browserVerified:false,tlsVerification:true,pageErrors:[],credentialHeaderCount:0,foreignRequestCount:0,caps:{journeys:4,live:8,uniqueTiles:32,tileConcurrency:2},calls:{journeys:0,live:0,stops:0},stage:'setup'};
const schedules=[], liveResponses=[];
let tileFailures=0, tileCancelled=0, apiCapExceeded=false, tileShutdown=false;
const activeChildren=new Set();
const budget=new SmokeTileBudget(url=>new Promise((resolve,reject)=>{
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','HOME','LANG','HTTPS_PROXY','HTTP_PROXY','NO_PROXY','SSL_CERT_FILE','SSL_CERT_DIR'].includes(k)));
 const code="import urllib.request,sys\nclass NoRedirect(urllib.request.HTTPRedirectHandler):\n def redirect_request(self,*args,**kwargs):return None\nwith urllib.request.build_opener(NoRedirect).open(urllib.request.Request(sys.argv[1],headers={'User-Agent':'BallinaMoveTechnicalPreview/0.1 bounded owner-approved viewport verification'}),timeout=8) as r:\n b=r.read(262145)\n if r.status!=200 or len(b)>262144 or not b.startswith(b'\\x89PNG\\r\\n\\x1a\\n'):raise ValueError('invalid_tile')\n sys.stdout.buffer.write(b)";
 const child=spawn('python3',['-c',code,url],{env}),chunks=[];let bytes=0,done=false;activeChildren.add(child);
 const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
 child.stdout.on('data',b=>{bytes+=b.length;if(bytes>262144)child.kill('SIGKILL');else chunks.push(b);});child.stderr.resume();
 const finish=ok=>{if(done)return;done=true;activeChildren.delete(child);clearTimeout(timer);if(ok)resolve(Buffer.concat(chunks));else{if(tileShutdown)tileCancelled++;else tileFailures++;reject(Error('verified_tile_unavailable'));}};
 child.on('error',()=>finish(false));child.on('close',c=>finish(c===0&&bytes<=262144));
}));
async function install(page) {
 await budget.install(page);
 await page.route(origin+'/api/**',async route=>{
  const r=route.request(),u=new URL(r.url()),name=u.pathname.slice(5);
  if(r.method()!=='GET'||!Object.hasOwn(proof.calls,name)){proof.foreignRequestCount++;await route.abort();return;}
  if(name!=='stops'&&proof.calls[name]>=proof.caps[name]){apiCapExceeded=true;await route.abort();return;}
  proof.calls[name]++;await route.continue();
 });
 page.on('pageerror',e=>proof.pageErrors.push(e.name));
 page.on('request',r=>{const h=r.headers(),u=new URL(r.url());if(h.apikey||h.authorization||h['x-ballina-gateway'])proof.credentialHeaderCount++;if(u.origin!==origin&&u.hostname!=='tile.openstreetmap.org')proof.foreignRequestCount++;});
 page.on('response',r=>{const u=new URL(r.url());if(u.origin!==origin)return;if(u.pathname==='/api/journeys')schedules.push(r.json().then(data=>({status:r.status(),data}),()=>({status:r.status()})));if(u.pathname==='/api/live')liveResponses.push(r.json().then(data=>({status:r.status(),data}),()=>({status:r.status()})));});
}
(async()=>{
 const p=new URL(process.env.HTTPS_PROXY||process.env.https_proxy),proxy={server:p.protocol+'//'+p.host};
 if(p.username)proxy.username=decodeURIComponent(p.username);if(p.password)proxy.password=decodeURIComponent(p.password);
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,proxy,env:{PATH:process.env.PATH,HOME:process.env.HOME}});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844}});await install(page);
  proof.stage='mobile-home';const navigation=await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:45000});assert.equal(navigation.status(),200);proof.httpStatus=200;
  await page.getByRole('combobox',{name:'To stop',exact:true}).waitFor({timeout:25000});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  proof.mobileHomeReady=true;await page.screenshot({path:out+'/public-home-mobile.png'});
  proof.stage='hospital';const today=await page.getByLabel('Schedule date').inputValue();const tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);proof.hospitalQueryDate=tomorrow;
  await page.getByLabel('Schedule date').fill(tomorrow);await page.getByLabel('Schedule time').fill('07:55');
  await page.getByRole('button',{name:'Find scheduled journeys'}).click();await page.locator('.scheduled-results').waitFor({timeout:25000});
  const results=await page.locator('.scheduled-results').textContent();assert(results.includes('scheduled options')&&!results.includes('Unable to'));
  proof.hospitalFirst=await page.locator('.journey-card').first().textContent();assert(proof.hospitalFirst.includes('08:00 → 08:52')&&proof.hospitalFirst.includes('stop 15109'));
  await page.screenshot({path:out+'/public-hospital-mobile.png'});
  await page.locator('.journey-card').first().getByRole('link',{name:'View itinerary'}).click();await page.locator('.scheduled-itinerary').waitFor();proof.itineraryVerified=true;
  await page.screenshot({path:out+'/public-itinerary-mobile.png'});await page.getByRole('link',{name:'Back to results'}).click();await page.locator('.scheduled-results').waitFor();proof.backVerified=true;
  proof.stage='mobile-map';await page.getByRole('navigation').getByRole('link',{name:'Live map',exact:true}).click();await page.getByRole('heading',{name:'Buses & trains.'}).waitFor();
  await page.locator('.live-status').first().filter({hasText:'Auto-refresh'}).waitFor({timeout:25000});
  const live=await Promise.all(liveResponses);assert(live.length&&live[0].status===200);const data=live[0].data;
  require('/workspace/ballina-move-gtfs-importer./web/scripts/check-live-host.cjs').verifyLiveData(data);
  proof.liveLocations=data.vehicles.length;proof.liveGeneratedAt=data.generatedAt;proof.sources=data.sources;proof.collectorHealthy=data.collectorHealthy;
  await page.waitForFunction(()=>[...document.querySelectorAll('img.leaflet-tile')].some(i=>i.complete&&i.naturalWidth>0),null,{timeout:25000});
  proof.realMapTilesLoaded=true;await page.screenshot({path:out+'/public-map-mobile.png'});
  if(data.vehicles.length){
   await page.getByRole('button',{name:'Ireland',exact:true}).click();
   const group=page.locator('.vehicle-cluster').first();
   if(await group.count()){await group.click();await page.getByRole('region',{name:'Vehicles in this group'}).waitFor();proof.groupVerified=true;await page.getByRole('region',{name:'Vehicles in this group'}).getByRole('button').filter({hasText:/GPS|reported/}).first().click();}
   else {const marker=page.locator('.vehicle-marker').first();await marker.waitFor();await marker.click();}
   await page.getByRole('region',{name:'Selected vehicle'}).waitFor();proof.vehicleCardVerified=true;proof.cardText=await page.getByRole('region',{name:'Selected vehicle'}).textContent();
   // Wait until at least two images from the current viewport have rendered.
   await page.waitForFunction(()=>[...document.querySelectorAll('img.leaflet-tile')].filter(i=>i.complete&&i.naturalWidth>0).length>=2,null,{timeout:20000});
   await page.screenshot({path:out+'/public-vehicle-mobile.png'});await page.keyboard.press('Escape');assert.equal(await page.getByRole('region',{name:'Selected vehicle'}).count(),0);
  }else proof.currentFeedEmptyState=true;
  proof.stage='responsive-home';await page.getByRole('navigation').getByRole('link',{name:'Home',exact:true}).click();await page.getByRole('combobox',{name:'To stop',exact:true}).waitFor();
  proof.layouts=[];for(const width of [320,360,390,430,768,1440]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));proof.layouts.push({width,overflow:false});}
  await page.screenshot({path:out+'/public-home-desktop.png'});proof.desktopHomeReady=true;
  proof.stage='final-contracts';const responses=await Promise.all(schedules);assert(responses.length===2&&responses.every(r=>r.status===200&&r.data.source==='nta_gtfs'&&r.data.walkingIncluded===false&&r.data.realTimeApplied===false));
  proof.scheduleResponses=responses.map(r=>({status:r.status,options:r.data.journeys.length,feed:r.data.feedVersion}));assert(responses.every(r=>r.data.feedVersion===responses[0].data.feedVersion));
  assert.equal(proof.credentialHeaderCount,0);assert.equal(proof.foreignRequestCount,0);assert.deepEqual(proof.pageErrors,[]);assert.equal(apiCapExceeded,false);
  assert.equal(budget.exceeded,false);assert(budget.maximumActive<=2&&budget.cache.size<=32);
  proof.browserVerified=true;
 } catch(e){proof.errorType=e.name;proof.browserNetworkError=(String(e.message).match(/net::ERR_[A-Z_]+/)||[])[0]||null;proof.error='published_browser_verification_failed';process.exitCode=1;}
 finally {tileShutdown=true;await budget.close(()=>{for(const child of activeChildren)child.kill('SIGKILL');});await browser.close();proof.uniqueTiles=budget.cache.size;proof.maximumTileConcurrency=budget.maximumActive;proof.tileFailures=tileFailures;proof.tileCancelledAtShutdown=tileCancelled;proof.tileJobsRemaining=budget.active+budget.queue.length;proof.tileBudgetExceeded=budget.exceeded;proof.apiBudgetExceeded=apiCapExceeded;if(proof.pageErrors.length||proof.credentialHeaderCount||proof.foreignRequestCount||apiCapExceeded||budget.exceeded||proof.tileJobsRemaining){proof.browserVerified=false;proof.error='late_error_or_budget_boundary_failed';process.exitCode=1;}fs.writeFileSync(out+'/public-browser-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));}
})().catch(()=>{console.error('Controlled public verification setup failed');process.exitCode=1;});
