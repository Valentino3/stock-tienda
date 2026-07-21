-- Custom SQL migration file, put your code below! --
-- Índice trigram sobre set_name: usado por la búsqueda de Vender
-- (src/domain/catalog.ts) y por la paginación de Productos para que
-- un cashier/owner pueda encontrar cartas escribiendo el nombre del set.
CREATE INDEX "product_variants_set_name_trgm_idx" ON "product_variants" USING gin ("set_name" gin_trgm_ops);