-- Curación de sort_order de la góndola final (72 SKU).
-- Generado por scripts/generar-curacion-sort-order.mjs. No editar a mano.
-- SÓLO escribe products.sort_order. Nada más: ni stock, ni precio, ni available.
-- Se aplica DESPUÉS del lote de 12 altas (espera 72 filas) y con gate humano.
begin;
do $curacion$
begin
  if (select count(*) from public.products where business_id = '00000000-0000-4000-8000-000000000001') <> 72 then
    raise exception 'la curación espera 72 productos (60 + 12 altas aplicadas). Abortado.';
  end if;
end
$curacion$;
update public.products set sort_order = 10, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'coca-cola-original-2250ml';
update public.products set sort_order = 20, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'coca-cola-zero-2250ml';
update public.products set sort_order = 30, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'fanta-naranja-2250ml';
update public.products set sort_order = 40, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'sprite-original-2250ml';
update public.products set sort_order = 50, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'sprite-zero-2250ml';
update public.products set sort_order = 60, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'seven-up-original-2000ml';
update public.products set sort_order = 70, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'pepsi-original-2000ml';
update public.products set sort_order = 80, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'coca-cola-original-pet-1500ml';
update public.products set sort_order = 90, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'coca-cola-zero-pet-1500ml';
update public.products set sort_order = 100, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'fanta-naranja-pet-1500ml';
update public.products set sort_order = 110, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'pepsi-black-1500ml';
update public.products set sort_order = 120, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'sprite-original-pet-1500ml';
update public.products set sort_order = 130, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'sprite-zero-pet-1500ml';
update public.products set sort_order = 140, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'fanta-naranja-botella-pet-1500-ml-pack-x6';
update public.products set sort_order = 150, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'coca-cola-original-botella-pet-500-ml-pack-x12';
update public.products set sort_order = 160, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'coca-cola-zero-botella-pet-500-ml-pack-x12';
update public.products set sort_order = 170, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'sprite-botella-pet-500-ml-pack-x12';
update public.products set sort_order = 180, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'coca-cola-original-pet-500ml';
update public.products set sort_order = 190, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'coca-cola-zero-pet-500ml';
update public.products set sort_order = 200, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'sprite-pet-500ml';
update public.products set sort_order = 210, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'coca-cola-original-lata-354ml';
update public.products set sort_order = 220, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'coca-cola-zero-lata-354ml';
update public.products set sort_order = 230, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'sprite-original-lata-354ml';
update public.products set sort_order = 240, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'soda-manaos-sifon-2000ml';
update public.products set sort_order = 250, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'paso-de-los-toros-pomelo-1500ml';
update public.products set sort_order = 260, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'paso-de-los-toros-tonica-1500ml';
update public.products set sort_order = 270, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'benedictino-sin-gas-2250ml';
update public.products set sort_order = 280, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'villa-del-sur-sin-gas-pet-2250ml';
update public.products set sort_order = 290, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'villavicencio-sin-gas-1500ml';
update public.products set sort_order = 300, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'villavicencio-con-gas-pet-1500ml';
update public.products set sort_order = 310, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'villa-del-sur-sin-gas-600ml';
update public.products set sort_order = 320, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'villavicencio-con-gas-500ml';
update public.products set sort_order = 330, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'cepita-durazno-pet-1500ml';
update public.products set sort_order = 340, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'cepita-naranja-pet-1500ml';
update public.products set sort_order = 350, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'aquarius-pomelo-2250ml';
update public.products set sort_order = 360, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'aquarius-manzana-1500ml';
update public.products set sort_order = 370, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'aquarius-pera-1500ml';
update public.products set sort_order = 380, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'monster-green-zero-473ml';
update public.products set sort_order = 390, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'speed-original-473ml';
update public.products set sort_order = 400, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'speed-zero-473ml';
update public.products set sort_order = 410, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'red-bull-original-250ml';
update public.products set sort_order = 420, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'red-bull-sin-azucar-250ml';
update public.products set sort_order = 430, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'gatorade-manzana-1250ml';
update public.products set sort_order = 440, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'gatorade-cool-blue-500ml';
update public.products set sort_order = 450, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'powerade-mountain-blast-500ml';
update public.products set sort_order = 460, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'andes-origen-rubia-lata-473ml-pack-6';
update public.products set sort_order = 470, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'brahma-chopp-lata-473ml-pack-6';
update public.products set sort_order = 480, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'budweiser-lata-473ml-pack-6';
update public.products set sort_order = 490, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'quilmes-clasica-lata-473ml-pack-6';
update public.products set sort_order = 500, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'stella-artois-lata-473ml-pack-6';
update public.products set sort_order = 510, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'patagonia-amber-lager-botella-730ml';
update public.products set sort_order = 520, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'brahma-chopp-lata-710ml';
update public.products set sort_order = 530, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'quilmes-clasica-botella-710ml';
update public.products set sort_order = 540, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'andes-origen-roja-lata-473ml';
update public.products set sort_order = 550, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'andes-origen-rubia-lata-473ml';
update public.products set sort_order = 560, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'budweiser-lata-473ml';
update public.products set sort_order = 570, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'quilmes-clasica-lata-473ml';
update public.products set sort_order = 580, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'quilmes-stout-lata-473ml';
update public.products set sort_order = 590, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'stella-artois-lata-473ml';
update public.products set sort_order = 600, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'corona-extra-botella-330ml';
update public.products set sort_order = 610, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'fernet-branca-1000ml';
update public.products set sort_order = 620, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'fernet-1882-750ml';
update public.products set sort_order = 630, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'dr-lemon-vodka-pomelo-lata-473ml';
update public.products set sort_order = 640, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'gancia-lima-limon-lata-473ml';
update public.products set sort_order = 650, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'gancia-americano-450ml';
update public.products set sort_order = 660, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'toro-viejo-clasico-tinto-750ml';
update public.products set sort_order = 670, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'trapiche-origen-malbec-750ml';
update public.products set sort_order = 680, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'toro-tinto-1000ml';
update public.products set sort_order = 690, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'cafayate-torrontes-750ml';
update public.products set sort_order = 700, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'dada-caramel-750ml';
update public.products set sort_order = 710, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'gin-gordons-700ml';
update public.products set sort_order = 720, updated_at = now() where business_id = '00000000-0000-4000-8000-000000000001' and external_id = 'vodka-skyy-700ml';
commit;

-- Relectura: la secuencia final por categoría.
select category, sort_order, external_id, name from public.products where business_id = '00000000-0000-4000-8000-000000000001' order by sort_order;
