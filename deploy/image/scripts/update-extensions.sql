-- Upgrade installed extensions to the versions bundled in this image.
-- ALTER EXTENSION ... UPDATE errors when already at the latest version, so
-- only extensions with a newer available default are touched. First boot
-- installs nothing here: the backend creates the extensions at bootstrap.
DO $$
DECLARE ext record;
BEGIN
    FOR ext IN
        SELECT a.name
        FROM pg_available_extensions a
        JOIN pg_extension e ON e.extname = a.name
        WHERE a.name IN ('vector', 'pg_search')
          AND a.default_version IS DISTINCT FROM e.extversion
    LOOP
        EXECUTE format('ALTER EXTENSION %I UPDATE', ext.name);
        RAISE NOTICE 'updated extension %', ext.name;
    END LOOP;
END $$;
