#!/bin/bash
# Reconstruye la base local de pruebas: auth simulado + migraciones de estructura + datos de SIFAR
# + migraciones que ajustan datos (016 en adelante: se aplicaron en Supabase después de la carga)
service postgresql start >/dev/null 2>&1; sleep 1
cd /home/claude/sigam
su postgres -c "dropdb --if-exists sigam && createdb sigam"
estructura=$(ls supabase/migrations/*.sql | grep -v storage | awk -F/ '{n=substr($NF,1,14)+0; if (n < 20261124000016) print}')
datos=$(ls supabase/migrations/*.sql | grep -v storage | awk -F/ '{n=substr($NF,1,14)+0; if (n >= 20261124000016) print}')
for f in local/00_auth_stub.sql $estructura carga_supabase/parte_0*.sql $datos; do
  su postgres -c "psql -q -v ON_ERROR_STOP=1 -d sigam -f $f" >/dev/null 2>/tmp/e || { echo "FALLO $f"; grep -A3 ERROR /tmp/e; exit 1; }
done
echo "base lista"
