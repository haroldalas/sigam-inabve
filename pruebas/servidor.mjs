// SOLO PARA PRUEBAS LOCALES: imita la parte de Supabase (PostgREST + Auth) que usa SIGAM,
// sobre la base Postgres local, con el rol "authenticated" y RLS activos como en producción.
import http from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import pg from 'pg';

const DIST = process.argv[2] || '/home/claude/sigam/web/dist';
const CSP = process.argv.includes('--csp');
const pool = new pg.Pool({ connectionString: 'postgresql://postgres:local@localhost/sigam', max: 8 });
pg.types.setTypeParser(1700, v => v === null ? null : Number(v));   // numeric → número, como PostgREST
pg.types.setTypeParser(1082, v => v);           // date como texto
const id = s => '"' + String(s).replace(/"/g, '""') + '"';

// ------------------------------------------------------------------ metadatos de llaves foráneas
let FK = null;
async function fks() {
  if (FK) return FK;
  const { rows } = await pool.query(`
    select c.conrelid::regclass::text as tabla, a.attname as col, c.confrelid::regclass::text as ref, af.attname as refcol
      from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
      join pg_attribute af on af.attrelid=c.confrelid and af.attnum=c.confkey[1]
     where c.contype='f' and c.connamespace='public'::regnamespace`);
  FK = rows; return FK;
}

// ------------------------------------------------------------------ select=... con recursos anidados
function parseSelect(s) {
  const items = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { items.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) items.push(cur);
  return items.map(x => x.trim()).filter(Boolean).map(it => {
    const m = it.match(/^([\w]+)(?::([\w]+))?\((.*)\)$/s);
    if (m) return { embed: true, alias: m[1], hint: m[2], tabla: m[2] && !m[2].endsWith('_id') ? m[2] : m[1], fkcol: m[2]?.endsWith('_id') ? m[2] : null, hijos: parseSelect(m[3]) };
    const [col, alias] = it.split(':').reverse();
    return { col: it.includes(':') ? it.split(':')[1] : it, alias: it.includes(':') ? it.split(':')[0] : it };
  });
}

let n = 0;
async function columnas(tabla, items, alias) {
  const fk = await fks();
  const partes = [];
  for (const it of items) {
    if (!it.embed) { partes.push(it.col === '*' ? `${alias}.*` : `${alias}.${id(it.col)} as ${id(it.alias)}`); continue; }
    const a = 't' + (++n);
    let destino = it.fkcol ? fk.find(f => f.tabla === tabla && f.col === it.fkcol)?.ref : it.tabla;
    const aUno = fk.find(f => f.tabla === tabla && f.ref === destino && (!it.fkcol || f.col === it.fkcol));
    const aMuchos = fk.find(f => f.tabla === destino && f.ref === tabla);
    const sub = await columnas(destino, it.hijos, a);
    if (aUno) partes.push(`(select row_to_json(x) from (select ${sub} from ${id(destino)} ${a} where ${a}.${id(aUno.refcol)} = ${alias}.${id(aUno.col)}) x) as ${id(it.alias)}`);
    else if (aMuchos) partes.push(`(select coalesce(json_agg(x), '[]') from (select ${sub} from ${id(destino)} ${a} where ${a}.${id(aMuchos.col)} = ${alias}.${id(aMuchos.refcol)}) x) as ${id(it.alias)}`);
    else throw new Error(`sin relación ${tabla} → ${it.alias}`);
  }
  return partes.join(', ');
}

// ------------------------------------------------------------------ filtros PostgREST
function filtro(col, expr, params) {
  const p = v => { params.push(v); return '$' + params.length; };
  const [op, ...resto] = expr.split('.'); let val = resto.join('.');
  const c = 't0.' + id(col);
  switch (op) {
    case 'eq': return `${c}::text = ${p(val)}`;
    case 'neq': return `${c}::text <> ${p(val)}`;
    case 'gt': return `${c} > ${p(val)}`; case 'gte': return `${c} >= ${p(val)}`;
    case 'lt': return `${c} < ${p(val)}`; case 'lte': return `${c} <= ${p(val)}`;
    case 'like': return `${c}::text like ${p(val.replace(/\*/g, '%'))}`;
    case 'ilike': return `${c}::text ilike ${p(val.replace(/\*/g, '%'))}`;
    case 'is': return `${c} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`;
    case 'in': { const vs = val.replace(/^\(|\)$/g, '').split(',').map(v => v.replace(/^"|"$/g, '')); return `${c}::text = any(${p(vs)})`; }
    case 'not': { const [op2, ...r2] = resto; return `not (${filtro(col, op2 + '.' + r2.join('.'), params)})`; }
    default: throw new Error('operador no soportado: ' + op);
  }
}
function orExpr(s, params) {
  const partes = []; let depth = 0, cur = '';
  for (const ch of s.replace(/^\(|\)$/g, '')) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { partes.push(cur); cur = ''; } else cur += ch; }
  partes.push(cur);
  return '(' + partes.map(x => { const i = x.indexOf('.'); return filtro(x.slice(0, i), x.slice(i + 1), params); }).join(' or ') + ')';
}

// ------------------------------------------------------------------ ejecución con el usuario
async function comoUsuario(token, fn) {
  const cli = await pool.connect();
  try {
    await cli.query('begin');
    let sub = '';
    if (token) { try { sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub || ''; } catch {} }
    await cli.query(`set local role ${sub ? 'authenticated' : 'anon'}`);
    await cli.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub]);
    const r = await fn(cli);
    await cli.query('commit');
    return r;
  } catch (e) { await cli.query('rollback').catch(() => {}); throw e; } finally { cli.release(); }
}

async function rest(req, res, ruta, url, cuerpo) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const prefer = req.headers.prefer || '';
  const [, tabla, fn] = ruta.match(/^\/rest\/v1\/(?:rpc\/(\w+)|(\w+))/) || [];
  const q = url.searchParams;
  if (ruta.startsWith('/rest/v1/rpc/')) {
    const nombre = ruta.split('/').pop();
    const args = cuerpo ? JSON.parse(cuerpo) : {};
    const { rows: [def] } = await pool.query(`select array_to_json(proargnames) n, array_to_json(array(select format_type(t, null) from unnest(proargtypes) t)) t, proretset
      from pg_proc where proname=$1 and pronamespace='public'::regnamespace limit 1`, [nombre]);
    const params = [], lista = [];
    (def?.n || []).forEach((a, i) => { if (a in args) { params.push(typeof args[a] === 'object' && args[a] !== null && !Array.isArray(args[a]) || def.t[i] === 'jsonb' ? JSON.stringify(args[a]) : args[a]); lista.push(`${id(a)} => $${params.length}::${def.t[i]}`); } });
    if (def?.proretset) {   // funciones que devuelven tabla: arreglo de filas, como PostgREST
      const r = await comoUsuario(token, c => c.query(`select * from public.${id(nombre)}(${lista.join(', ')})`, params));
      return json(res, 200, r.rows);
    }
    const r = await comoUsuario(token, c => c.query(`select public.${id(nombre)}(${lista.join(', ')}) as r`, params));
    return json(res, 200, r.rows[0].r ?? null);
  }
  const t = ruta.split('/')[3];
  const params = [];
  const where = [];
  for (const [k, v] of q.entries()) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'or') where.push(orExpr(v, params)); else where.push(filtro(k, v, params));
  }
  const w = where.length ? ' where ' + where.join(' and ') : '';
  if (req.method === 'GET' || req.method === 'HEAD') {
    n = 0;
    const cols = await columnas(t, parseSelect(q.get('select') || '*'), 't0');
    const orden = (q.get('order') || '').split(',').filter(Boolean).map(o => { const [c, dir, nulls] = o.split('.'); return `t0.${id(c)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls ? ' nulls ' + nulls.replace('nulls', '') : ''}`; });
    const lim = q.get('limit') ? ` limit ${Number(q.get('limit'))}` : '', off = q.get('offset') ? ` offset ${Number(q.get('offset'))}` : '';
    const wt = w;
    const r = await comoUsuario(token, async c => {
      const datos = req.method === 'HEAD' ? { rows: [] } : await c.query(`select ${cols} from ${id(t)} t0${wt}${orden.length ? ' order by ' + orden.join(', ') : ''}${lim}${off}`, params);
      const cnt = /count=exact/.test(prefer) ? (await c.query(`select count(*)::int n from ${id(t)} t0${wt}`, params)).rows[0].n : null;
      return { datos: datos.rows, cnt };
    });
    const h = { 'content-range': `0-${Math.max(0, r.datos.length - 1)}/${r.cnt ?? '*'}` };
    return json(res, 200, req.method === 'HEAD' ? null : r.datos, h);
  }
  if (req.method === 'POST' || req.method === 'PATCH') {
    const filas = [].concat(JSON.parse(cuerpo || '[]'));
    const r = await comoUsuario(token, async c => {
      const out = [];
      for (const f of filas) {
        const ks = Object.keys(f); const ps = [...params]; const vals = ks.map(k => { ps.push(f[k] === null ? null : typeof f[k] === 'object' ? JSON.stringify(f[k]) : f[k]); return '$' + ps.length; });
        if (req.method === 'POST') {
          const upsert = /resolution=merge-duplicates/.test(prefer);
          const conflicto = q.get('on_conflict') || (await c.query(`select string_agg(a.attname, ',') k from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey) where i.indrelid=$1::regclass and i.indisprimary`, [t])).rows[0].k;
          out.push(...(await c.query(`insert into ${id(t)} (${ks.map(id).join(',')}) values (${vals.join(',')})${upsert ? ` on conflict (${conflicto.split(',').map(id).join(',')}) do update set ${ks.map(k => `${id(k)}=excluded.${id(k)}`).join(',')}` : ''} returning *`, ps)).rows);
        } else out.push(...(await c.query(`update ${id(t)} t0 set ${ks.map((k, i) => `${id(k)}=${vals[i]}`).join(',')}${w} returning *`, ps)).rows);
      }
      return out;
    });
    return json(res, req.method === 'POST' ? 201 : 200, /return=representation/.test(prefer) ? r : null);
  }
  if (req.method === 'DELETE') {
    await comoUsuario(token, c => c.query(`delete from ${id(t)} t0${w}`, params));
    return json(res, 204, null);
  }
}

function json(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...extra });
  res.end(body === null || status === 204 ? '' : JSON.stringify(body));
}

// Almacenamiento mínimo (imita Supabase Storage) en /tmp/sigam_storage
const ALM = '/tmp/sigam_storage';
function almacenamiento(req, res, url, binario, cuerpo) {
  const p = decodeURIComponent(url.pathname.replace('/storage/v1/object/', ''));
  if (p.startsWith('sign/')) {
    const ruta = p.slice(5);
    if (req.method === 'POST') return json(res, 200, { signedURL: `/object/sign/${ruta}?token=prueba` });
    const f = join(ALM, ruta); if (!existsSync(f)) return json(res, 404, { message: 'Object not found' });
    res.writeHead(200, { 'content-type': f.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' }); return res.end(readFileSync(f));
  }
  if (req.method === 'POST' || req.method === 'PUT') {
    const f = join(ALM, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, binario);
    return json(res, 200, { Key: p, Id: p });
  }
  if (req.method === 'DELETE') {
    const { prefixes = [] } = JSON.parse(cuerpo || '{}'); const b = p.replace(/\/$/, '');
    prefixes.forEach(x => { const f = join(ALM, b, x); if (existsSync(f)) rmSync(f); });
    return json(res, 200, prefixes.map(name => ({ name })));
  }
  return json(res, 400, { message: 'no soportado' });
}

const TIPOS = { '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.gz': 'application/gzip', '.pdf': 'application/pdf', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const trozos = []; req.on('data', d => trozos.push(d)); await new Promise(r => req.on('end', r));
  const binario = Buffer.concat(trozos); const cuerpo = binario.toString('utf8');
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); return res.end(); }
    if (url.pathname.startsWith('/rest/v1/')) return await rest(req, res, url.pathname, url, cuerpo);
    if (url.pathname.startsWith('/storage/v1/')) return almacenamiento(req, res, url, binario, cuerpo);
    // correo + contraseña (imita GoTrue con "Confirm email" desactivado)
    const sesionDe = u => {
      const b = d => Buffer.from(JSON.stringify(d)).toString('base64url');
      const t = `${b({ alg: 'none' })}.${b({ sub: u.id, exp: Math.floor(Date.now() / 1000) + 36000, role: 'authenticated' })}.x`;
      return { access_token: t, token_type: 'bearer', expires_in: 36000, expires_at: Math.floor(Date.now() / 1000) + 36000, refresh_token: 'r',
        user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', user_metadata: u.raw_user_meta_data || {}, app_metadata: u.raw_app_meta_data || {} } };
    };
    if (url.pathname === '/auth/v1/signup' && req.method === 'POST') {
      const b = JSON.parse(cuerpo);
      const { rows: [ya] } = await pool.query('select 1 from auth.users where lower(email)=lower($1)', [b.email]);
      if (ya) return json(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
      try {
        const { rows: [u] } = await pool.query(`insert into auth.users (email, encrypted_password, raw_user_meta_data, raw_app_meta_data)
          values (lower($1), extensions.crypt($2, extensions.gen_salt('bf')), $3, '{"provider":"email","providers":["email"]}') returning *`, [b.email, b.password, b.data || {}]);
        return json(res, 200, sesionDe(u));
      } catch (e) { return json(res, 500, { code: 500, error_code: 'unexpected_failure', msg: 'Database error saving new user' }); }
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const b = JSON.parse(cuerpo);
      const { rows: [u] } = await pool.query('select * from auth.users where lower(email)=lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)', [b.email, b.password]);
      if (!u) return json(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return json(res, 200, sesionDe(u));
    }
    if (url.pathname.startsWith('/auth/v1/user') && req.method === 'PUT') {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub;
      const b = JSON.parse(cuerpo);
      const { rows: [u] } = await pool.query(`update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')) where id=$1 returning *`, [sub, b.password]);
      return json(res, 200, sesionDe(u).user);
    }
    if (url.pathname.startsWith('/auth/v1/user')) {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub;
      const { rows: [u] } = await pool.query('select id, email from auth.users where id=$1', [sub]);
      return json(res, 200, { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {} });
    }
    if (url.pathname.startsWith('/auth/v1/logout')) return json(res, 204, null);
    let f = join(DIST, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!existsSync(f) || statSync(f).isDirectory()) f = join(DIST, 'index.html');
    const h = { 'content-type': TIPOS[extname(f)] || 'application/octet-stream' };
    if (CSP && extname(f) === '.html') h['content-security-policy'] = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'";
    res.writeHead(200, h); res.end(readFileSync(f));
  } catch (e) {
    json(res, 400, { message: e.message, code: e.code, details: e.detail, hint: e.hint });
  }
}).listen(8080, () => console.log('servidor de prueba en http://localhost:8080'));
