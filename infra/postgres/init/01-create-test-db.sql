-- Only runs on a new volume. Existing data is preserved.
SELECT 'CREATE DATABASE orbit_test OWNER orbit'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'orbit_test')\gexec
