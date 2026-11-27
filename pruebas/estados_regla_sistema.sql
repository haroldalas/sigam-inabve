begin; set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select guardar_estados_tipo('auditivo','[{"k":"registrada","t":"Solicitado","c":"rojo"}]'); rollback;
