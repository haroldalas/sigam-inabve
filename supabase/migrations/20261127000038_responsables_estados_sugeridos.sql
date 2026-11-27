-- Responsables (son también quienes validan) y estados sugeridos con color para auditivos, lentes y cirugías.
delete from solicitud_responsables where area = 'DSEC' and tipo in ('auditivo', 'lentes', 'cirugia_oftalmica');
insert into solicitud_responsables (tipo, area, email)
select x.tipo, 'DSIN', x.email from (values
  ('lentes', 'veronica.echeverria@inabve.gob.sv'), ('auditivo', 'veronica.echeverria@inabve.gob.sv'), ('cirugia_oftalmica', 'veronica.echeverria@inabve.gob.sv'),
  ('medicamento', 'jocelyn.flores@inabve.gob.sv'), ('insumo', 'jocelyn.flores@inabve.gob.sv'),
  ('medicamento', 'harold.alas@inabve.gob.sv'), ('medicamento', 'mayra.ascencio@inabve.gob.sv')) x(tipo, email)
 where exists (select 1 from perfiles p where p.email = x.email)
   and not exists (select 1 from solicitud_responsables r where r.tipo = x.tipo and r.area = 'DSIN' and r.email = x.email);

update solicitud_tipos set estados = '[
 {"k":"registrada","t":"Solicitado","c":"rojo"},
 {"k":"contactado","t":"Contactado: pendiente de audiometría","c":"amarillo"},
 {"k":"evaluado","t":"Audiometría realizada","c":"amarillo"},
 {"k":"aprobada","t":"Aprobado","c":"amarillo"},
 {"k":"espera_jd","t":"En espera de aprobación de JD","c":"morado"},
 {"k":"en_gestion","t":"En gestión con el proveedor (adaptación)","c":"azul"},
 {"k":"lista","t":"Disponible para entregar","c":"verde"},
 {"k":"avisado","t":"Disponible · beneficiario avisado","c":"verde"},
 {"k":"entregada","t":"Entregado","c":"gris","final":true},
 {"k":"no_procede","t":"No aplica","c":"gris","final":true},
 {"k":"no_disponible","t":"No disponible","c":"gris","final":true},
 {"k":"cancelada","t":"Cancelada","c":"gris","final":true}]'::jsonb where clave = 'auditivo';
update solicitud_tipos set estados = '[
 {"k":"registrada","t":"Solicitado","c":"rojo"},
 {"k":"contactado","t":"Contactado: pendiente de examen visual","c":"amarillo"},
 {"k":"evaluado","t":"Examen visual realizado","c":"amarillo"},
 {"k":"aprobada","t":"Aprobado","c":"amarillo"},
 {"k":"espera_jd","t":"En espera de aprobación de JD","c":"morado"},
 {"k":"en_gestion","t":"En elaboración (óptica)","c":"azul"},
 {"k":"lista","t":"Disponible para entregar","c":"verde"},
 {"k":"avisado","t":"Disponible · beneficiario avisado","c":"verde"},
 {"k":"entregada","t":"Entregados","c":"gris","final":true},
 {"k":"no_procede","t":"No aplica","c":"gris","final":true},
 {"k":"no_disponible","t":"No disponible","c":"gris","final":true},
 {"k":"cancelada","t":"Cancelada","c":"gris","final":true}]'::jsonb where clave = 'lentes';
update solicitud_tipos set estados = '[
 {"k":"registrada","t":"Solicitado","c":"rojo"},
 {"k":"contactado","t":"Contactado: pendiente de evaluación oftalmológica","c":"amarillo"},
 {"k":"evaluado","t":"Evaluado por oftalmología","c":"amarillo"},
 {"k":"espera_jd","t":"En espera de aprobación de JD","c":"morado"},
 {"k":"programada","t":"Cirugía programada","c":"azul"},
 {"k":"operado","t":"Operado","c":"gris","final":true},
 {"k":"no_procede","t":"No aplica","c":"gris","final":true},
 {"k":"no_disponible","t":"No disponible","c":"gris","final":true},
 {"k":"cancelada","t":"Cancelada","c":"gris","final":true}]'::jsonb where clave = 'cirugia_oftalmica';
