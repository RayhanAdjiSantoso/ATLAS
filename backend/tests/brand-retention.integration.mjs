// Integration regression: all writes are isolated to temporary tables and rolled back.
// Run from backend: node tests/brand-retention.integration.mjs
import assert from 'node:assert/strict';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { default: pool } = await import('../src/config/db.js');
const { getHistoricalRetention, getCustomerRetention } = await import('../src/repositories/dashboardRepository.js');
const brands = await import('../src/services/brandService.js');
const { default: app } = await import('../src/app.js');
const { signToken } = await import('../src/utils/jwt.js');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
await client.connect();
let server;
try {
  await client.query('BEGIN');
  await client.query(`CREATE TEMP TABLE brands (brand_id serial PRIMARY KEY, brand_name varchar(150) UNIQUE, status public.brand_status);
    CREATE TEMP TABLE orders (order_id text, customer_id integer, brand_id integer, order_status_id integer, order_completed_at timestamp);
    CREATE TEMP TABLE order_statuses (order_status_id integer, status_name text);
    INSERT INTO order_statuses VALUES (1,'Selesai'),(2,'Batal');
    INSERT INTO orders VALUES
      ('a',1,1,1,'2026-05-10'),('b',1,1,1,'2026-06-05'),
      ('c',2,1,1,'2026-04-01'),
      ('d',3,1,1,'2026-06-06'),('e',3,1,1,'2026-06-15'),
      ('f',3,1,1,'2026-07-10'),
      ('g',4,2,1,'2026-05-01'),('h',4,1,1,'2026-06-10'),
      ('i',NULL,1,1,'2026-06-11'),
      ('j',5,1,2,'2026-05-01'),('k',5,1,1,'2026-06-12'),
      ('l',6,1,1,'2026-07-01');`);
  const rewrite = sql => sql.replaceAll('public.brands', 'pg_temp.brands').replaceAll('shopee.orders', 'pg_temp.orders').replaceAll('shopee.order_statuses', 'pg_temp.order_statuses');
  pool.query = (sql, args) => client.query(rewrite(sql), args);
  pool.connect = async () => ({
    query: (sql, args) => client.query(sql === 'BEGIN' ? 'SAVEPOINT service_write' : sql === 'COMMIT' ? 'RELEASE SAVEPOINT service_write' : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT service_write' : rewrite(sql), args),
    release() {},
  });
  assert.deepEqual(await getHistoricalRetention(1,'2026-06-01','2026-06-30'), { cohort_count: 2, current_count: 4, retained_count: 1 });
  assert.deepEqual(await getHistoricalRetention(1,'2026-01-01','2026-01-31'), { cohort_count: 0, current_count: 0, retained_count: 0 });
  assert.deepEqual(await getCustomerRetention(1,'2026-06-01','2026-06-30'), { total_customers: 4, customers_single: 3, customers_retained: 1 });
  const added = await brands.createBrand('  Test Client  ');
  assert.equal(added.brand_name,'Test Client'); assert.equal(added.status,'active');
  await assert.rejects(brands.createBrand('test client'), e => e.code === '23505');
  assert.equal((await brands.updateBrandStatus(added.brand_id,'off')).status,'off');
  assert.equal((await brands.listBrands()).length,1);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/brands`;
  const headers = { 'Content-Type':'application/json', Authorization:`Bearer ${signToken({userId:1,role:'admin'})}` };
  for (const brandName of ['', 123, 'x'.repeat(151)]) {
    const res = await fetch(base, {method:'POST',headers,body:JSON.stringify({brandName})});
    assert.equal(res.status,400);
  }
  assert.equal((await fetch(base,{method:'POST',headers,body:JSON.stringify({brandName:'TEST CLIENT'})})).status,409);
  assert.equal((await fetch(`${base}/${added.brand_id}/status`,{method:'PATCH',headers,body:JSON.stringify({status:'invalid'})})).status,400);
  assert.equal((await fetch(`${base}/999/status`,{method:'PATCH',headers,body:JSON.stringify({status:'active'})})).status,404);
  assert.equal((await fetch(`${base}/${added.brand_id}/status`,{method:'PATCH',headers,body:JSON.stringify({status:'freeze'})})).status,200);
  console.log('PASS: retention history/cutoff/brand isolation/null buyers, repeat distinction, brand create/duplicate/status, API validation. No persistent data changed.');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await client.query('ROLLBACK'); await client.end(); await pool.end();
}
