-- =============================================================================
-- SIGAM-INABVE · 024 · Rol Jefatura (va solo: un valor nuevo de enum no puede
-- usarse en la misma transacción en que se crea)
-- =============================================================================
alter type rol_usuario add value if not exists 'jefatura';
