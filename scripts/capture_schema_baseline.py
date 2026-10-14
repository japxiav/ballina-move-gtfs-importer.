"""Fixed-project read-only public application DDL and migration provenance.

Never reads application rows, vault values, credentials or cron jobs. The
management token stays in native HTTPS headers. Output must be reviewed before
commit; this command does not apply SQL or alter production.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request

QUERY = r"""
select jsonb_build_object(
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forced',c.relforcerowsecurity,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'sequence',pg_get_serial_sequence('public.'||quote_ident(c.relname),a.attname)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'type',contype,'definition',pg_get_constraintdef(oid))) from pg_constraint where conrelid=c.oid),
 'indexes',(select jsonb_agg(indexdef) from pg_indexes where schemaname='public' and tablename=c.relname and indexname not in (select conname from pg_constraint where conrelid=c.oid)),
 'triggers',(select jsonb_agg(pg_get_triggerdef(oid)) from pg_trigger where tgrelid=c.oid and not tgisinternal),
 'policies',(select jsonb_agg(jsonb_build_object('name',policyname,'permissive',permissive,'roles',roles,'command',cmd,'using',qual,'check',with_check)) from pg_policies where schemaname='public' and tablename=c.relname),
 'grants',(select jsonb_agg(jsonb_build_object('role',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'privilege',x.privilege_type,'grantable',x.is_grantable)) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x)) order by c.relname)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),
 'sequences',(select jsonb_agg(jsonb_build_object('name',s.sequencename,'owner',s.sequenceowner,'type',s.data_type,'start',s.start_value::text,'min',s.min_value::text,'max',s.max_value::text,'increment',s.increment_by::text,'cycle',s.cycle,'cache',s.cache_size::text,'grants',(select jsonb_agg(jsonb_build_object('role',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'privilege',x.privilege_type,'grantable',x.is_grantable)) from aclexplode(coalesce(c.relacl,acldefault('S',c.relowner))) x))) from pg_sequences s join pg_class c on c.oid=('public.'||quote_ident(s.sequencename))::regclass where s.schemaname='public'),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),'signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'grants',(select jsonb_agg(jsonb_build_object('role',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'privilege',x.privilege_type,'grantable',x.is_grantable)) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')),
 'history',(select jsonb_agg(jsonb_build_object('version',version,'name',name,'statementsSha256',encode(pg_catalog.sha256(convert_to(coalesce(to_jsonb(statements)::text,'null'),'UTF8')),'hex')) order by version) from supabase_migrations.schema_migrations),
 'types',(select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('e','d'))
) as snapshot
"""
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args): raise ValueError('schema_redirect_forbidden')

def safe(value):
    # Known secret formats plus long credential literals. Never print a match.
    if re.search(r'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}|sb_(?:secret|publishable|pat)_[A-Za-z0-9_-]+|(?:Bearer|password|api[_-]?key)\s*[:=]\s*[\x27\x22]?[A-Za-z0-9_-]{24,}', value, re.I):
        raise ValueError('credential_literal_detected_export_refused')

def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', value): raise ValueError('unsupported_schema_identifier')
    return '"' + value + '"'

def baseline(data):
    if data['types'] != 0: raise ValueError('custom_types_require_explicit_export')
    lines = ['-- Read-only public application schema baseline. No data, vault values or cron jobs.', 'SET check_function_bodies = off;']
    sequences = {'public.'+s['name']: s for s in data['sequences'] or []}
    def sequence_options(s):
        for key in ['increment', 'min', 'max', 'start', 'cache']:
            if not isinstance(s[key], str) or not re.fullmatch(r'-?[0-9]{1,20}', s[key]): raise ValueError('invalid_sequence_numeric')
        return f"INCREMENT {s['increment']} MINVALUE {s['min']} MAXVALUE {s['max']} START {s['start']} CACHE {s['cache']} {'CYCLE' if s['cycle'] else 'NO CYCLE'}"
    identities = {c['sequence'] for t in data['tables'] for c in t['columns'] if c['identity']}
    for s in data['sequences'] or []:
        if 'public.'+s['name'] in identities: continue
        lines.append(f"CREATE SEQUENCE public.{identifier(s['name'])} AS {s['type']} INCREMENT {s['increment']} MINVALUE {s['min']} MAXVALUE {s['max']} START {s['start']} CACHE {s['cache']} {'CYCLE' if s['cycle'] else 'NO CYCLE'};")
    foreign = []
    for t in data['tables']:
        name = 'public.' + identifier(t['name'])
        columns = [f"{identifier(c['name'])} {c['type']}" + (f" GENERATED {'ALWAYS' if c['identity']=='a' else 'BY DEFAULT'} AS IDENTITY (SEQUENCE NAME {c['sequence']} {sequence_options(sequences[c['sequence']])})" if c['identity'] else f" DEFAULT {c['default']}" if c['default'] else '') + (' NOT NULL' if c['notNull'] else '') for c in t['columns']]
        lines.append(f"CREATE TABLE {name} (\n  " + ',\n  '.join(columns) + '\n);')
        for c in t['constraints'] or []:
            statement = f"ALTER TABLE {name} ADD CONSTRAINT {identifier(c['name'])} {c['definition']};"
            (foreign if c['type']=='f' else lines).append(statement)
        lines += [i+';' for i in t['indexes'] or []]
        if t['rls']: lines.append(f'ALTER TABLE {name} ENABLE ROW LEVEL SECURITY;')
        if t['forced']: lines.append(f'ALTER TABLE {name} FORCE ROW LEVEL SECURITY;')
    lines += foreign
    for f in data['functions'] or []: lines.append(f['definition'].rstrip().rstrip(';')+';')
    for t in data['tables']:
        name = 'public.'+identifier(t['name'])
        lines += [s+';' for s in t['triggers'] or []]
        for p in t['policies'] or []:
            roles = ', '.join('PUBLIC' if r=='public' else identifier(r) for r in p['roles'])
            lines.append(f"CREATE POLICY {identifier(p['name'])} ON {name} AS {p['permissive']} FOR {p['command']} TO {roles}" + (f" USING ({p['using']})" if p['using'] else '') + (f" WITH CHECK ({p['check']})" if p['check'] else '') + ';')
        lines.append(f"ALTER TABLE {name} OWNER TO {identifier(t['owner'])};")
        lines.append(f'REVOKE ALL ON {name} FROM PUBLIC, anon, authenticated, service_role;')
        for g in t['grants'] or []:
            role = 'PUBLIC' if g['role']=='PUBLIC' else identifier(g['role'])
            lines.append(f"GRANT {g['privilege']} ON {name} TO {role}" + (' WITH GRANT OPTION' if g['grantable'] else '') + ';')
    for f in data['functions'] or []:
        signature = f['signature']
        if not signature.startswith('public.'): signature = 'public.'+signature
        lines.append(f"ALTER FUNCTION {signature} OWNER TO {identifier(f['owner'])};")
        lines.append(f'REVOKE ALL ON FUNCTION {signature} FROM PUBLIC, anon, authenticated, service_role;')
        for g in f['grants'] or []:
            role = 'PUBLIC' if g['role']=='PUBLIC' else identifier(g['role'])
            lines.append(f"GRANT {g['privilege']} ON FUNCTION {signature} TO {role}" + (' WITH GRANT OPTION' if g['grantable'] else '') + ';')
    for s in data['sequences'] or []:
        name = 'public.'+identifier(s['name'])
        lines.append(f"ALTER SEQUENCE {name} OWNER TO {identifier(s['owner'])};")
        lines.append(f'REVOKE ALL ON SEQUENCE {name} FROM PUBLIC, anon, authenticated, service_role;')
        for g in s['grants'] or []:
            role = 'PUBLIC' if g['role']=='PUBLIC' else identifier(g['role'])
            lines.append(f"GRANT {g['privilege']} ON SEQUENCE {name} TO {role}" + (' WITH GRANT OPTION' if g['grantable'] else '') + ';')
    return '\n\n'.join(lines)+'\n'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    key=os.environ.get('SUPABASE_ACCESS_TOKEN','')
    if not key: raise ValueError('secure_management_binding_missing')
    req=urllib.request.Request('https://api.supabase.com/v1/projects/giwiqbnyozjbpmetrjhe/database/query',data=json.dumps({'query':QUERY,'read_only':True}).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},method='POST')
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=25) as response: body=response.read(4194305)
    except urllib.error.HTTPError as error: raise ValueError('schema_management_unavailable') from None
    if len(body)>4194304: raise ValueError('schema_response_oversize')
    data=json.loads(body)[0]['snapshot']
    # Historical statements may contain DML or secrets. Keep only hashes/names,
    # never export those statements or claim to recreate historical seed data.
    history=data.pop('history')
    encoded=json.dumps(data,ensure_ascii=False);safe(encoded)
    sql=baseline(data);safe(sql)
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/'schema.sql').write_text(sql)
    (args.output/'metadata.json').write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
    manifest={'project':'giwiqbnyozjbpmetrjhe','scope':'public application DDL only; platform extensions/roles must already exist','productionWrites':0,'applicationRowsExported':0,'migrationHistory':history,'statementHashEncoding':'PostgreSQL to_jsonb(statements)::text UTF8 SHA256','schemaSha256':hashlib.sha256(sql.encode()).hexdigest(),'tables':len(data['tables']),'functions':len(data['functions'] or []),'sequences':len(data['sequences'] or [])}
    (args.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({k:manifest[k] for k in ['productionWrites','applicationRowsExported','tables','functions','sequences']}))

if __name__=='__main__':main()
