-- ==============================================================================
-- SCRIPT DE INICIALIZACIÓN DE SUPABASE - COTIZADOR 3D (AMBAR & DAVO)
-- Copia y pega este contenido en el SQL Editor de tu consola Supabase y pulsa RUN.
-- ==============================================================================

-- 1. TABLA: Catálogo Compartido de Piezas
CREATE TABLE IF NOT EXISTS public.catalog_pieces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hours NUMERIC DEFAULT 0,
    minutes NUMERIC DEFAULT 0,
    grams NUMERIC DEFAULT 0,
    timestamp BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABLA: Configuración y Tarifas (Costos por gramo, hora, margen)
CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABLA: Historial de Proformas Guardadas
CREATE TABLE IF NOT EXISTS public.proformas_history (
    id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    total NUMERIC NOT NULL,
    date_str TEXT,
    timestamp BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TABLA: Registro de Ventas Concretadas
CREATE TABLE IF NOT EXISTS public.sales_log (
    id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    total NUMERIC NOT NULL,
    date_str TEXT,
    timestamp BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- SEGURIDAD: Habilitar Row Level Security (RLS) con acceso público anónimo
-- ==============================================================================

ALTER TABLE public.catalog_pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proformas_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_log ENABLE ROW LEVEL SECURITY;

-- Políticas de acceso para catalog_pieces
DROP POLICY IF EXISTS "Acceso total a catalog_pieces" ON public.catalog_pieces;
CREATE POLICY "Acceso total a catalog_pieces" ON public.catalog_pieces FOR ALL USING (true) WITH CHECK (true);

-- Políticas de acceso para app_settings
DROP POLICY IF EXISTS "Acceso total a app_settings" ON public.app_settings;
CREATE POLICY "Acceso total a app_settings" ON public.app_settings FOR ALL USING (true) WITH CHECK (true);

-- Políticas de acceso para proformas_history
DROP POLICY IF EXISTS "Acceso total a proformas_history" ON public.proformas_history;
CREATE POLICY "Acceso total a proformas_history" ON public.proformas_history FOR ALL USING (true) WITH CHECK (true);

-- Políticas de acceso para sales_log
DROP POLICY IF EXISTS "Acceso total a sales_log" ON public.sales_log;
CREATE POLICY "Acceso total a sales_log" ON public.sales_log FOR ALL USING (true) WITH CHECK (true);

-- ==============================================================================
-- TIEMPO REAL: Habilitar replicación en tiempo real para sincronización instantánea
-- ==============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.catalog_pieces;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.proformas_history;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_log;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
