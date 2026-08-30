import fs from 'fs';
import path from 'path';
import pg from 'pg';

const BACKEND_URL = 'http://localhost:5001/api';
const WORKSPACE_DIR = '/Users/rayhanadjisantoso/Desktop/ATLAS/web2';
const DATABASE_URL = 'postgresql://rayhanadjisantoso@localhost:5432/atlas_FIN';

async function cleanupDatabase() {
  console.log('Cleaning up database test data...');
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  
  // Set search path and clean table data to ensure a pristine test run
  await client.query('SET search_path TO shopee, public');
  await client.query('TRUNCATE TABLE shopee.order_items CASCADE');
  await client.query('TRUNCATE TABLE shopee.orders CASCADE');
  await client.query('TRUNCATE TABLE shopee.daily_order_performance CASCADE');
  await client.query('TRUNCATE TABLE shopee.daily_channel_performance CASCADE');
  await client.query('TRUNCATE TABLE shopee.product_performance_summary CASCADE');
  await client.query('TRUNCATE TABLE shopee.products CASCADE');
  await client.query('TRUNCATE TABLE uploads CASCADE');
  await client.query('DELETE FROM brands WHERE brand_name IN ($1, $2)', ['Haenyeo', 'ShopeeShop']);
  
  await client.end();
  console.log('Database cleaned up successfully.');
}

async function runTests() {
  await cleanupDatabase();

  console.log('\n=== STARTING INTEGRATION TESTS ===');

  const getFileStream = (filename) => {
    const filePath = path.join(WORKSPACE_DIR, filename);
    const fileBuffer = fs.readFileSync(filePath);
    return new Blob([fileBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  };

  // 1. LOGIN ADMIN
  console.log('\n[1] Melakukan login sebagai Admin...');
  const loginAdminRes = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@atlas.local', password: 'admin12345' }),
  });
  if (!loginAdminRes.ok) {
    throw new Error(`Login admin gagal: ${await loginAdminRes.text()}`);
  }
  const adminData = await loginAdminRes.json();
  const adminToken = adminData.token;
  console.log(`-> Login Admin berhasil! Token didapat. User: ${adminData.user.fullName} (${adminData.user.role})`);

  // 2. UPLOAD FILE AS ADMIN
  const resolveBrandId = async (token, brandName) => {
    const createRes = await fetch(`${BACKEND_URL}/brands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ brandName }),
    });
    const data = await createRes.json();
    if (createRes.ok) return data.brand.brand_id;
    if (createRes.status === 409 && data.details?.brand) return data.details.brand.brand_id;
    throw new Error(`Gagal resolve brand "${brandName}": ${JSON.stringify(data)}`);
  };

  const uploadFile = async (token, filename, brandName, fileType) => {
    const brandId = await resolveBrandId(token, brandName);
    console.log(`\nMengunggah ${filename} (Brand: ${brandName} [#${brandId}], Type: ${fileType})...`);
    const formData = new FormData();
    const fileBlob = getFileStream(filename);
    formData.append('file', fileBlob, filename);
    formData.append('brandId', brandId);
    formData.append('fileType', fileType);

    const uploadRes = await fetch(`${BACKEND_URL}/uploads`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });

    const resData = await uploadRes.json();
    if (!uploadRes.ok) {
      throw new Error(`Upload gagal: ${JSON.stringify(resData)}`);
    }
    console.log(`-> Berhasil! Status: ${resData.status}, Baris diimpor: ${resData.rowsInserted}, Periode: ${resData.period?.start || '-'} s/d ${resData.period?.end || '-'}`);
    return resData;
  };

  await uploadFile(adminToken, 'Order 0626.xlsx', 'Haenyeo', 'order');
  await uploadFile(adminToken, 'Performance Overview 0626.xlsx', 'Haenyeo', 'performance_overview');
  await uploadFile(adminToken, 'Product Performance 0626.xlsx', 'Haenyeo', 'product_performance');

  // 3. GET UPLOAD HISTORY AS ADMIN
  console.log('\n[3] Mengambil riwayat upload sebagai Admin...');
  const historyAdminRes = await fetch(`${BACKEND_URL}/uploads`, {
    headers: { 'Authorization': `Bearer ${adminToken}` },
  });
  const historyAdminData = await historyAdminRes.json();
  console.log(`-> Admin melihat ${historyAdminData.uploads.length} riwayat upload.`);
  historyAdminData.uploads.forEach((u) => {
    console.log(`   - ID: ${u.upload_id.slice(0,8)}... | Brand: ${u.brand_name} | Jenis: ${u.file_type} | Periode: ${u.period_start?.slice(0,10)} - ${u.period_end?.slice(0,10)} | Status: ${u.status} | User: ${u.uploaded_by}`);
  });

  if (historyAdminData.uploads.length < 3) {
    throw new Error('Riwayat upload admin kurang dari 3 item!');
  }

  // 4. LOGIN USER
  console.log('\n[4] Melakukan login sebagai User...');
  const loginUserRes = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'user@atlas.local', password: 'user12345' }),
  });
  if (!loginUserRes.ok) {
    throw new Error(`Login user gagal: ${await loginUserRes.text()}`);
  }
  const userData = await loginUserRes.json();
  const userToken = userData.token;
  console.log(`-> Login User berhasil! Token didapat. User: ${userData.user.fullName} (${userData.user.role})`);

  // 5. GET UPLOAD HISTORY AS USER (Must not see Admin's uploads)
  console.log('\n[5] Mengambil riwayat upload sebagai User (Harus kosong karena user belum mengunggah)...');
  const historyUserRes = await fetch(`${BACKEND_URL}/uploads`, {
    headers: { 'Authorization': `Bearer ${userToken}` },
  });
  const historyUserData = await historyUserRes.json();
  console.log(`-> User melihat ${historyUserData.uploads.length} riwayat upload.`);
  if (historyUserData.uploads.length !== 0) {
    throw new Error(`KEBOCORAN DATA: User biasa melihat ${historyUserData.uploads.length} riwayat upload sebelum mengunggah apa pun!`);
  }
  console.log('-> Sukses: RBAC terverifikasi, user tidak melihat file admin.');

  // 6. UPLOAD FILE AS USER
  console.log('\n[6] Mengunggah file sebagai User...');
  await uploadFile(userToken, 'Order 0626.xlsx', 'ShopeeShop', 'order');

  // 7. GET UPLOAD HISTORY AS USER AGAIN (Must only see their own)
  console.log('\n[7] Mengambil riwayat upload sebagai User setelah upload...');
  const historyUserRes2 = await fetch(`${BACKEND_URL}/uploads`, {
    headers: { 'Authorization': `Bearer ${userToken}` },
  });
  const historyUserData2 = await historyUserRes2.json();
  console.log(`-> User sekarang melihat ${historyUserData2.uploads.length} riwayat upload.`);
  historyUserData2.uploads.forEach((u) => {
    console.log(`   - ID: ${u.upload_id.slice(0,8)}... | Brand: ${u.brand_name} | Jenis: ${u.file_type} | Status: ${u.status} | User: ${u.uploaded_by}`);
  });
  if (historyUserData2.uploads.length !== 1 || historyUserData2.uploads[0].brand_name !== 'ShopeeShop') {
    throw new Error('Riwayat upload user tidak valid (seharusnya hanya ada ShopeeShop)!');
  }

  // 8. GET UPLOAD HISTORY AS ADMIN AGAIN (Must see all 4 uploads)
  console.log('\n[8] Mengambil kembali riwayat upload sebagai Admin...');
  const historyAdminRes2 = await fetch(`${BACKEND_URL}/uploads`, {
    headers: { 'Authorization': `Bearer ${adminToken}` },
  });
  const historyAdminData2 = await historyAdminRes2.json();
  console.log(`-> Admin sekarang melihat ${historyAdminData2.uploads.length} riwayat upload.`);
  if (historyAdminData2.uploads.length < 4) {
    throw new Error('Admin tidak melihat file yang diunggah oleh user!');
  }
  console.log('-> Sukses: Admin dapat melihat seluruh data upload dari semua pengguna.');

  // 9. VERIFY DASHBOARD ENDPOINTS
  console.log('\n[9] Menguji Endpoint Dashboard API...');
  const brandId = historyAdminData2.uploads.find(u => u.brand_name === 'Haenyeo').brand_id;
  
  const testDashboardEndpoint = async (tabName, urlPath) => {
    console.log(` Menguji Tab "${tabName}"...`);
    const res = await fetch(`${BACKEND_URL}/dashboard/${urlPath}?brandId=${brandId}&startDate=2026-06-01&endDate=2026-06-30`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (!res.ok) {
      throw new Error(`Gagal fetch ${urlPath}: ${await res.text()}`);
    }
    const data = await res.json();
    console.log(` -> Respon ${tabName} OK!`);
    return data;
  };

  const execData = await testDashboardEndpoint('Executive Snapshot', 'executive-snapshot');
  console.log(`   * GMV: Rp ${execData.kpis?.gmv?.value}`);
  console.log(`   * Transactions: ${execData.kpis?.transactions?.value}`);
  console.log(`   * CVR: ${execData.kpis?.cvr?.value}`);

  const growthData = await testDashboardEndpoint('Business Growth', 'business-growth');
  console.log(`   * Trend Days Count: ${growthData.trends?.length}`);

  const trafficData = await testDashboardEndpoint('Traffic & Funnel', 'traffic-funnel');
  console.log(`   * Impressions: ${trafficData.kpis?.impressions}`);
  console.log(`   * Universal Clicks: ${trafficData.trafficSources?.universal?.length}`);
  console.log(`   * Funnel conversion steps: ${trafficData.funnel?.length}`);

  const rfmData = await testDashboardEndpoint('RFM', 'rfm');
  console.log(`   * Customer Segments Count: ${rfmData.segments?.length}`);
  console.log(`   * R x F Matrix Count: ${rfmData.matrices?.rf?.length}`);
  console.log(`   * R x M Matrix Count: ${rfmData.matrices?.rm?.length}`);
  console.log(`   * F x M Matrix Count: ${rfmData.matrices?.fm?.length}`);

  const behaviorData = await testDashboardEndpoint('Transaction Behavior', 'transaction-behavior');
  console.log(`   * Top Cities Count: ${behaviorData.cities?.length}`);
  console.log(`   * Top Provinces Count: ${behaviorData.provinces?.length}`);
  console.log(`   * Discounts: ${JSON.stringify(behaviorData.discounts)}`);
  console.log(`   * Order Durations Bucket Count: ${behaviorData.durations?.length}`);
  console.log(`   * Payment Methods Count: ${behaviorData.payments?.length}`);
  console.log(`   * Shipping Options Count: ${behaviorData.shippings?.length}`);
  console.log(`   * Cancellations Count: ${behaviorData.cancellations?.length}`);

  const basketData = await testDashboardEndpoint('Basket Analysis', 'basket-analysis');
  console.log(`   * Total Transactions: ${basketData.stats?.totalTransactions}`);
  console.log(`   * Basket Sizes Segments: ${basketData.sizes?.length}`);
  console.log(`   * Top Association Rules (Pairs): ${basketData.pairs?.length}`);

  console.log('\n=== SEMUA INTEGRASI BACKEND & DASHBOARD API BERHASIL TERVERIFIKASI ===');
}

runTests().catch((err) => {
  console.error('\n=== TEST FAILED ===');
  console.error(err);
  process.exit(1);
});
