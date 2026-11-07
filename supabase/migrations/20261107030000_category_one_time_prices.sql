-- ChubutxTRES V5: ejecutar DESPUÉS de la migración V4. No elimina registros previos.
ALTER TABLE public.membership_categories
 ADD COLUMN IF NOT EXISTS one_time_price_ars integer NOT NULL DEFAULT 1;
ALTER TABLE public.membership_categories
 DROP CONSTRAINT IF EXISTS membership_categories_one_time_price_valid;
ALTER TABLE public.membership_categories
 ADD CONSTRAINT membership_categories_one_time_price_valid CHECK (one_time_price_ars BETWEEN 0 AND 100000000);
ALTER TABLE public.one_time_contributions
 ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.membership_categories(id);
CREATE INDEX IF NOT EXISTS one_time_contributions_category_idx ON public.one_time_contributions(category_id);
CREATE TABLE IF NOT EXISTS public.site_settings (
 key text PRIMARY KEY,
 value text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.site_settings(key,value) VALUES ('default_one_time_amount','1') ON CONFLICT (key) DO NOTHING;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settings_read ON public.site_settings;
CREATE POLICY settings_read ON public.site_settings FOR SELECT TO anon,authenticated USING (true);
DROP POLICY IF EXISTS settings_admin_insert ON public.site_settings;
CREATE POLICY settings_admin_insert ON public.site_settings FOR INSERT TO authenticated WITH CHECK (public.is_admin() AND key='default_one_time_amount' AND value ~ '^[0-9]{1,9}$');
DROP POLICY IF EXISTS settings_admin_update ON public.site_settings;
CREATE POLICY settings_admin_update ON public.site_settings FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin() AND key='default_one_time_amount' AND value ~ '^[0-9]{1,9}$');
-- Ampliar la vista administrativa sin cambiar su nombre ni contratos básicos.
DROP FUNCTION IF EXISTS public.admin_contributions();
CREATE FUNCTION public.admin_contributions() RETURNS TABLE (
 id uuid,user_id uuid,created_at timestamptz,amount_ars integer,status text,
 mp_payment_id text,mp_preference_id text,paid_at timestamptz,
 organization text,full_name text,email text,category_name text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Forbidden'; END IF;
 RETURN QUERY SELECT c.id,c.user_id,c.created_at,c.amount_ars,c.status,
 c.mp_payment_id,c.mp_preference_id,c.paid_at,p.organization,p.full_name,u.email::text,
 mc.name
 FROM public.one_time_contributions c
 JOIN public.profiles p ON p.id=c.user_id
 JOIN auth.users u ON u.id=c.user_id
 LEFT JOIN public.membership_categories mc ON mc.id=c.category_id
 ORDER BY c.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.admin_contributions() FROM public,anon;
GRANT EXECUTE ON FUNCTION public.admin_contributions() TO authenticated;
