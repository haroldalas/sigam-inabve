import sys; sys.path.insert(0,'.')
from smoke import *
ok = lambda c, m: print(('  ✔ ' if c else '  ✘ ') + m)
with sync_playwright() as p:
    br=p.chromium.launch(); errs=[]
    for quien in ['admin','jefe']:
        pg=contexto(br,quien).new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://localhost:8080/#tablero'); pg.wait_for_selector('.pestanas', timeout=60000)
        pg.click('.pestanas button:has-text("Llamadas")'); pg.wait_for_selector('text=Para hoy', timeout=30000)
        t = pg.inner_text('main') if pg.locator('main').count() else pg.inner_text('body')
        t=t.lower(); ok('llamadas en el período' in t and 'por persona que llama' in t and 'no tiene permiso' not in t, f'{quien}: tablero de llamadas')
        if quien=='admin': pg.screenshot(path='shots/t_llamadas.png', full_page=True)
        pg.click('.pestanas button:has-text("Solicitudes")'); pg.wait_for_selector('text=Solicitudes en el período', timeout=30000)
        ok(True, f'{quien}: tablero de solicitudes')
    ok(not errs, f'sin errores JS {errs}')
