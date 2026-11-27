import sys, subprocess; sys.path.insert(0,'.')
from smoke import *
ok = lambda c, m: print(('  ✔ ' if c else '  ✘ ') + m)
def sql(s):
    r = subprocess.run(['su','postgres','-c',f'psql -d sigam -At -c "{s}"'],capture_output=True,text=True); return r.stdout.strip() or r.stderr.strip()
sql("delete from solicitud_responsables where email='andrea.sanchez@inabve.gob.sv'")
with sync_playwright() as p:
    br=p.chromium.launch(); errs=[]
    pg=contexto(br,'admin').new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8080/#admin'); pg.wait_for_selector('tbody tr', timeout=60000)
    pg.click('td:has-text("andrea.sanchez")'); pg.wait_for_selector('.tabla-permisos')
    pg.screenshot(path='shots/p1_permisos.png')
    fila = pg.locator('.tabla-permisos tr', has_text='Lentes'); fila.locator('input').first.check()
    fila = pg.locator('.tabla-permisos tr', has_text='Medicamento'); fila.locator('input').nth(1).check()
    pg.click('.modal >> text=Guardar'); pg.wait_for_selector('.toast'); pg.wait_for_timeout(800)
    ok(sql("select string_agg(area||':'||tipo, ',' order by tipo) from solicitud_responsables where email='andrea.sanchez@inabve.gob.sv'") == 'DSIN:lentes,DSEC:medicamento', 'se guardan los permisos: ' + sql("select string_agg(area||':'||tipo, ',') from solicitud_responsables where email='andrea.sanchez@inabve.gob.sv'"))
    pg.click('td:has-text("andrea.sanchez")'); pg.wait_for_selector('.tabla-permisos')
    pg.locator('.tabla-permisos tr', has_text='Lentes').locator('input').first.uncheck()
    pg.click('.modal >> text=Guardar'); pg.wait_for_selector('.toast'); pg.wait_for_timeout(800)
    ok(sql("select string_agg(area||':'||tipo, ',') from solicitud_responsables where email='andrea.sanchez@inabve.gob.sv'") == 'DSEC:medicamento', 'y se pueden quitar')
    ok(not errs, f'sin errores JS {errs[:3]}')
    sql("delete from solicitud_responsables where email='andrea.sanchez@inabve.gob.sv'")
