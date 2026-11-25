#!/bin/bash
# Reconstruye la base local de pruebas: auth simulado + migraciones + datos
service postgresql start >/dev/null 2>&1; sleep 1
cd /home/claude/sigam
su postgres -c "dropdb --if-exists sigam && createdb sigam"
for f in local/00_auth_stub.sql $(ls supabase/migrations/*.sql | grep -v storage) carga_supabase/parte_0*.sql; do
  su postgres -c "psql -q -v ON_ERROR_STOP=1 -d sigam -f $f" >/dev/null 2>/tmp/e || { echo "FALLO $f"; grep -A3 ERROR /tmp/e; exit 1; }
done
echo "base lista"
