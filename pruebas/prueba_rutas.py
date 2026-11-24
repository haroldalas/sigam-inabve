import sys; sys.path.insert(0, '.')
from smoke import *
RUTAS = ['inicio','existencias','despacho','recepcion','traslados','entradas','conteo','ajustes','devoluciones','kardex','pendientes','lotes','tablero','liquidacion','admin']
with sync_playwright() as p:
    br = p.chromium.launch()
    # login
    ctx = contexto(br, None); pg = ctx.new_page(); pg.goto('http://localhost:8080/'); pg.wait_for_timeout(1500); pg.screenshot(path='shots/login.png'); ctx.close()
    for quien in ['admin', 'dep', 'cons', 'nuevo']:
        ctx = contexto(br, quien); pg = ctx.new_page()
        errores = []
        pg.on('console', lambda m, e=errores: e.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda ex, e=errores: e.append('PAGEERROR ' + str(ex)))
        pg.goto('http://localhost:8080/'); pg.wait_for_timeout(2500)
        menu = pg.eval_on_selector_all('.menu-item', 'els => els.map(e => e.dataset.ruta)')
        print(f'== {quien}: menú = {menu}')
        if quien == 'nuevo':
            pg.screenshot(path='shots/nuevo.png'); print('   ', pg.inner_text('h1')); ctx.close(); continue
        for r in menu:
            pg.goto(f'http://localhost:8080/#{r}'); pg.wait_for_timeout(300)
            try: pg.wait_for_selector('.titulo-pagina, .aviso-error', timeout=20000)
            except Exception: pass
            pg.wait_for_timeout(700)
            err = pg.query_selector('.contenido > .aviso-error')
            titulo = pg.inner_text('.titulo-pagina') if pg.query_selector('.titulo-pagina') else '???'
            print(f'   {r:13} → {titulo}{"  ERROR: " + err.inner_text() if err else ""}')
            pg.screenshot(path=f'shots/{quien}_{r}.png', full_page=False)
        if errores: print('   errores de consola:', errores[:8])
        ctx.close()
    br.close()
