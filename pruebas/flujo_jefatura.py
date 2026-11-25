# Prueba: rol Jefatura (tableros, kardex, existencias) y Entradas solo para administradores
import sys, subprocess, json; sys.path.insert(0, '.')
from smoke import *

def sql(s):
    return subprocess.run(['su', 'postgres', '-c', f'psql -d sigam -At -c "{s}"'], capture_output=True, text=True).stdout.strip()
ok = lambda c, m: print(('  ✔ ' if c else '  ✘ ') + m)

with sync_playwright() as p:
    br = p.chromium.launch(); errs = []
    print('1. Jefatura')
    ctx = contexto(br, 'jefe', viewport={'width': 1440, 'height': 1000}) if False else contexto(br, 'jefe')
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8080/'); pg.wait_for_selector('.kpi', timeout=60000)
    menu = pg.inner_text('nav')
    ok(pg.inner_text('.titulo-pagina') == 'Tableros', 'entra directo a Tableros')
    ok(all(x in menu for x in ['Existencias', 'Kardex', 'Tableros']) and not any(x in menu for x in ['Despacho', 'Entradas', 'Notificaciones', 'Traslados', 'Administración']),
       'menú: solo Existencias, Kardex y Tableros')
    pg.locator('.filtros select').first.select_option(label='Año 2026'); pg.wait_for_timeout(2500)
    ok('$' in pg.inner_text('.kpi >> nth=0'), 'KPIs del año: ' + pg.inner_text('.kpi >> nth=0').replace('\n', ' '))
    pg.screenshot(path='shots/j1_quincenal.png', full_page=True)
    for i, nombre in enumerate(['medicamentos', 'presupuesto', 'insumos'], start=1):
        pg.locator('.pestanas button').nth(i).click(); pg.wait_for_timeout(2500)
        ok(pg.locator('.grafico svg').count() >= 1 and pg.locator('.barra').count() >= 5, f'pestaña {pg.locator(".pestanas button").nth(i).inner_text()}: gráficos y barras')
        pg.screenshot(path=f'shots/j{i + 1}_{nombre}.png', full_page=True)
    pg.goto('http://localhost:8080/#kardex'); pg.wait_for_timeout(3000)
    ok(pg.inner_text('.titulo-pagina') == 'Kardex', 'abre el Kardex')
    pg.goto('http://localhost:8080/#existencias'); pg.wait_for_selector('table', timeout=30000)
    ok('Juan Pablo II' in pg.inner_text('table thead') and 'Chalatenango' in pg.inner_text('table thead'), 'Existencias de todas las sedes')
    pg.goto('http://localhost:8080/#despacho'); pg.wait_for_timeout(2000)
    ok(pg.inner_text('.titulo-pagina') == 'Tableros', 'no puede abrir Despacho (vuelve a Tableros)')
    ctx.close()

    print('2. Entradas solo administradores')
    ctx = contexto(br, 'dep'); pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8080/'); pg.wait_for_selector('nav', timeout=60000)
    ok('Entradas' not in pg.inner_text('nav'), 'el dependiente ya no ve Entradas (facturas)')
    r = pg.evaluate("""async () => { const { error } = await window.__sb.rpc('registrar_entrada', { p: { bodega_id: 1, proveedor_id: 1, lineas: [{}] } }); return error && error.message; }""")
    ok(r and 'administrador' in r, f'el servidor también lo rechaza: {r}')
    r = pg.evaluate("""async () => { const { error } = await window.__sb.rpc('tablero_consumo', { p_desde: '2026-01-01', p_hasta: '2026-12-31' }); return error && error.message; }""")
    ok(r and 'jefatura' in r, f'el dependiente no puede pedir los tableros: {r}')
    ctx.close()
    ok(not errs, f'sin errores JS {errs[:3]}')
    br.close()
