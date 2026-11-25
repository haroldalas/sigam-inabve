import json, time, base64, sys
from playwright.sync_api import sync_playwright
USERS = {'admin': ('00000000-0000-0000-0000-000000000001', 'harold.alas@inabve.gob.sv'),
         'dep': ('00000000-0000-0000-0000-000000000002', 'iris.ramirez@inabve.gob.sv'),
         'cons': ('00000000-0000-0000-0000-000000000003', 'jose.avila@inabve.gob.sv'),
         'nuevo': ('00000000-0000-0000-0000-000000000004', 'nuevo.usuario@inabve.gob.sv'),
         'jefe': ('00000000-0000-0000-0000-000000000005', 'jefa.prueba@inabve.gob.sv')}
def token(sub):
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')
    return f"{b({'alg':'none'})}.{b({'sub': sub, 'exp': int(time.time())+36000, 'role':'authenticated'})}.x"
def sesion(sub, email):
    t = token(sub)
    return json.dumps({'access_token': t, 'token_type': 'bearer', 'expires_in': 36000, 'expires_at': int(time.time())+36000,
        'refresh_token': 'r', 'user': {'id': sub, 'email': email, 'aud': 'authenticated', 'role': 'authenticated', 'user_metadata': {'full_name': email}, 'app_metadata': {}}})
def contexto(browser, quien, **kw):
    ctx = browser.new_context(viewport={'width': 1366, 'height': 860}, accept_downloads=True, **kw)
    if quien:
        sub, email = USERS[quien]
        ctx.add_init_script(f"localStorage.setItem('sb-localhost-auth-token', {json.dumps(sesion(sub, email))});")
    return ctx
