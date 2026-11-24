-- SIGAM-INABVE · 012 · Almacenamiento privado para los PDF de pólizas (solo administradores)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('polizas', 'polizas', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "polizas: administradores leen" on storage.objects for select to authenticated
  using (bucket_id = 'polizas' and (select public.es_admin()));
create policy "polizas: administradores suben" on storage.objects for insert to authenticated
  with check (bucket_id = 'polizas' and (select public.es_admin()));
create policy "polizas: administradores eliminan" on storage.objects for delete to authenticated
  using (bucket_id = 'polizas' and (select public.es_admin()));
