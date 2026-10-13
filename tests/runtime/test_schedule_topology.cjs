const test=require('node:test'),assert=require('node:assert/strict');
const {searchSchedules}=require('/tmp/ballina-ts-compiled/ballina_journeys.js');
test('destination-directed search preserves a dense direct journey and a two-change feeder without raising caps',()=>{
 const version='offline-topology-fixture',row=x=>({version,...x});
 const stops=['A','B','C','END',...Array.from({length:16},(_,i)=>'DEAD'+i)].map((id,i)=>row({stop_id:id,stop_name:id,stop_lat:54+i*.0001,stop_lon:-9,stop_code:id}));
 const trips=[],times=[];
 for(let i=0;i<240;i++){
  const id='dead-'+i;trips.push(row({trip_id:id,route_id:'R',service_id:'S'}));
  for(let k=0;k<20;k++)times.push(row({trip_id:id,stop_id:k===0?'A':'DEAD'+((k-1)%16),stop_sequence:k,arrival_seconds:28800+i*10+k*60,departure_seconds:28800+i*10+k*60,pickup_type:0,drop_off_type:0}));
 }
 for(const [id,from,to,board,alight] of [['feed1','A','B',28800,29000],['feed2','B','C',29120,29300],['feed3','C','END',29420,29600],['direct','A','END',30000,30600]]){
  trips.push(row({trip_id:id,route_id:'R',service_id:'S'}));times.push(row({trip_id:id,stop_id:from,stop_sequence:1,arrival_seconds:board,departure_seconds:board,pickup_type:0,drop_off_type:1}),row({trip_id:id,stop_id:to,stop_sequence:2,arrival_seconds:alight,departure_seconds:alight,pickup_type:1,drop_off_type:0}));
 }
 const s={version,start:'2026-10-07',end:'2027-10-07',loadedAt:'2026-10-13T12:00:00Z',tables:{stops,routes:[row({route_id:'R',route_short_name:'Fixture',route_type:3})],trips,times,calendars:[row({service_id:'S',start_date:'2026-10-13',end_date:'2026-10-13',tuesday:true})],exceptions:[]}};
 const q={from:'A',to:'END',date:'2026-10-13',time:'07:55',modes:'bus',changes:'2'};
 const results=searchSchedules(s,q);assert.equal(results.journeys[0].changes,2);assert.equal(results.journeys[0].arrivalAt,29600);assert.equal(results.journeys[1].changes,0);
 assert.equal(searchSchedules(s,{...q,changes:'0'}).journeys[0].arrivalAt,30600);
 s.tables.times.find(r=>r.trip_id==='feed2'&&r.stop_sequence===1).pickup_type=1;
 assert.equal(searchSchedules(s,q).journeys[0].changes,0);
});
