import sys,os,json,datetime,subprocess
from pathlib import Path
ROOT=Path('/workspace/ballina-move-gtfs-importer.')
OUT=Path('/workspace/.ballina-execution/audit-20261014/published-preview')
SOURCE='3619cc40929cea2fb540ff6b561876ed82c55969'
sys.path.insert(0,str(ROOT/'scripts'))
import deploy_live_gateway_render as render
import deploy_journey_api_supabase as edge
from publisher_admission_binding import configured_value
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==SOURCE
state=render.request('/services/srv-db6nhvrbc2fs739pb7mg/deploys/dep-db7j0p25b2lc7384pojg',os.environ['RENDER_API_KEY'])
assert state.get('status')=='live' and state.get('commit',{}).get('id')==SOURCE
binding=configured_value(os.environ['RENDER_API_KEY'])
os.environ['BALLINA_EXPECTED_SOURCE_COMMIT']=SOURCE
os.environ['BALLINA_SUPABASE_EXPECTED_VERSION']='4'
with (OUT/'edge-publish-intent.json').open('x') as f:
 json.dump({'source':SOURCE,'previousVersion':4,'authorizedByUser':True,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat()},f)
edge.main(binding=binding)
del binding
