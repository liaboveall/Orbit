-- 首次初始化 PostgreSQL 容器时执行（/docker-entrypoint-initdb.d）。
-- POSTGRES_DB=orbit_dev 由镜像自动创建；这里额外创建独立测试库 orbit_test，
-- 与开发库隔离（docs/08 §1：测试不复用 orbit_dev 数据）。
-- 使用 \gexec 守卫，保证重复执行安全（仅在数据目录为空时才会运行）。

-- Create test user if not exists (for integration tests)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'testpass') THEN
        CREATE USER testpass WITH PASSWORD 'testpass';
    END IF;
END
$$;\gexec

SELECT 'CREATE DATABASE orbit_test OWNER orbit'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'orbit_test')\gexec

-- Grant permissions for test user on orbit_test database
GRANT ALL PRIVILEGES ON DATABASE orbit_test TO testpass;\gexec
