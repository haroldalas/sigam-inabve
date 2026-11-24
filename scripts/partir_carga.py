"""Divide seed/*.sql en partes de ~600 KB para pegarlas en el SQL Editor de Supabase."""
import re, glob, os
os.makedirs('carga_supabase', exist_ok=True)
for f in glob.glob('carga_supabase/parte_0*.sql'): os.remove(f)
stmts = []
for f in sorted(glob.glob('seed/seed_0*.sql')):
    for p in re.split(r';\n', open(f).read()):
        p = p.strip()
        if p and not all(l.startswith('--') for l in p.splitlines()): stmts.append(p + ';\n')
out, cur = [], ''
for st in stmts:
    if len(cur) + len(st) > 600_000 and cur: out.append(cur); cur = ''
    cur += st
out.append(cur)
tabs = ['productos','proveedores','contratos','bodegas','sedes','familias','parametros','perfiles','stock_minimo','facturas']
pre = "-- Durante la carga inicial no se registra en la bitácora de cambios\n" + "".join(f"alter table {t} disable trigger auditoria;\n" for t in tabs)
post = "".join(f"alter table {t} enable trigger auditoria;\n" for t in tabs)
for i, c in enumerate(out, 1):
    c = (pre if i == 1 else '') + c + (post if i == len(out) else '')
    open(f'carga_supabase/parte_{i:02d}.sql', 'w').write(f"-- SIGAM-INABVE · carga de datos · parte {i} de {len(out)} · ejecutar en orden\n" + c)
print(len(out), 'partes')
