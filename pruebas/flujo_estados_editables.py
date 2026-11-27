import sys, subprocess; sys.path.insert(0,'.')
from smoke import *
ok = lambda c, m: print(('  ✔ ' if c else '  ✘ ') + m)
def sql(s):
    r = subprocess.run(['su','postgres','-c',f'psql -d sigam -At -c "{s}"'],capture_output=True,text=True); return r.stdout.strip() or r.stderr.strip()
with sync_playwright() as p:
    br=p.chromium.launch(); errs=[]
    pg=contexto(br,'admin').new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8080/#solicitudes?ver=estados'); pg.wait_for_selector('.tabla-estados', timeout=60000)
    pg.locator('.pestanas button', has_text='Aparato auditivo').click()
    card = pg.locator('section.tarjeta', has=pg.locator('.tabla-estados')).first
    print('1. Cambiar nombre y color de un estado de SIGAM')
    fila = card.locator('tbody tr').first
    fila.locator('input.campo').fill('Recibida por DSIN'); fila.locator('select').select_option('celeste')
    ok(fila.locator('button', has_text='🗑').count() == 0 and fila.locator('input[type=checkbox]').first.is_disabled(), 'estado de SIGAM: no se elimina ni cambia "cierra el caso"')
    print('2. Agregar un estado propio')
    card.locator('button', has_text='Agregar estado').click()
    nueva = card.locator('tbody tr').last
    nueva.locator('input.campo').fill('En audiometría'); nueva.locator('select').select_option('rosa')
    card.locator('button', has_text='Guardar').click(); pg.wait_for_selector('.toast'); pg.wait_for_timeout(800)
    r = sql("select string_agg(e->>'k'||'|'||(e->>'t')||'|'||(e->>'c'), ';' order by o) from solicitud_tipos, jsonb_array_elements(estados) with ordinality x(e,o) where clave='auditivo'")
    ok('registrada|Recibida por DSIN|celeste' in r, 'renombrado y recoloreado')
    ok('x_en_audiometria|En audiometría|rosa' in r, 'estado nuevo guardado con clave propia')
    pg.screenshot(path='shots/e1_estados.png', full_page=True)
    print('3. Reglas del servidor')
    sql("update solicitudes set estado='x_en_audiometria' where id=(select id from solicitudes where tipo='auditivo' and cerrada_at is null order by id limit 1)")
    card.locator('tbody tr').last.locator('button', has_text='🗑').click()
    card.locator('button', has_text='Guardar').click(); pg.wait_for_timeout(1500)
    ok('Hay solicitudes' in pg.inner_text('body'), 'no deja eliminar un estado en uso')
    e = subprocess.run(['su','postgres','-c','psql -d sigam -q -f /home/claude/sigam/pruebas/estados_regla_sistema.sql'],capture_output=True,text=True).stderr
    ok('No se pueden eliminar estados que usa SIGAM' in e, 'no deja quitar estados de SIGAM')
    print('4. Se ve en la solicitud')
    sid = sql("select id from solicitudes where estado='x_en_audiometria' limit 1")
    pg.goto(f'http://localhost:8080/#solicitudes?id={sid}'); pg.wait_for_selector('.detalle-sol', timeout=30000)
    ok(pg.locator('.detalle-sol .estado.c-rosa', has_text='En audiometría').count() > 0, 'chip con el nombre y color nuevos')
    ok(not errs, f'sin errores JS {errs}')
