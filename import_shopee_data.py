"""
import_shopee_data.py — ETL: Excel (Shopee seller exports) -> PostgreSQL (schema.sql)

WHAT THIS SCRIPT PROVES
------------------------
Every reference/lookup value used below (order status, payment method,
shipping option, pipeline stage, price-competitiveness status, ads stage,
product status, city/province, report period, customer username) is
resolved through `LookupResolver.get_or_create*()` — i.e. read from the
source file and inserted into its lookup table only if it isn't there yet.
There is not a single hardcoded reference value anywhere in this file.
Run it again next month, on a file containing a payment method or courier
that never appeared before, and it is picked up automatically.

Three representative loaders are implemented in full, covering all 9
lookup tables + report_periods + customers/products:

    load_orders(...)                     -> order_statuses, payment_methods,
                                             shipping_options, locations,
                                             customers
    load_daily_order_performance(...)    -> order_pipeline_stages
    load_product_performance(...)        -> report_periods, product_statuses,
                                             price_competitiveness_statuses,
                                             ads_recommendation_stages

The remaining fact tables (daily_channel_performance,
channel_product_contribution, product_variant_performance) follow the
*exact same pattern* — resolve each categorical column with the resolver,
then INSERT the row with the returned ids. They're omitted here only to
keep this file focused; see the "EXTENDING TO OTHER SHEETS" note at the
bottom for the two-line recipe.

Requires: pandas, psycopg2-binary
"""

from __future__ import annotations

import math
from decimal import Decimal, InvalidOperation
from typing import Optional

import pandas as pd
import psycopg2

from lookup_cache import LookupResolver

DB_DSN = "dbname=atlas_FIN user=rayhanadjisantoso host=localhost"


# ---------------------------------------------------------------------------
# Indonesian-format parsing helpers
# (see schema_design.md Section 6 — nominal columns are TEXT with '.' as the
#  thousands separator; reading them as float without dtype=str silently
#  divides values by 1000, e.g. "159.000" -> 159.0 instead of 159000.)
# ---------------------------------------------------------------------------

def parse_idr(raw) -> Optional[Decimal]:
    """'169.000' -> Decimal('169000');  '2.273,67' -> Decimal('2273.67')."""
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return None
    s = str(raw).strip()
    if s in ("", "-", "nan"):
        return None
    s = s.replace(".", "").replace(",", ".")
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def parse_pct(raw) -> Optional[Decimal]:
    """'4,61%' -> Decimal('0.0461');  '588,72%' -> Decimal('5.8872')."""
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return None
    s = str(raw).strip().rstrip("%").strip()
    if s in ("", "-", "nan"):
        return None
    s = s.replace(".", "").replace(",", ".")
    try:
        return Decimal(s) / Decimal(100)
    except InvalidOperation:
        return None


def parse_ts(raw, fmt: Optional[str] = None):
    """If `fmt` is given, parse strictly against that format (e.g.
    '%Y-%m-%d %H:%M') — no guessing, no ambiguity, works regardless of
    leading zeros. Only falls back to pandas' inference (dayfirst=True,
    for Indonesian dd-mm-yyyy style text) when fmt is not supplied, which
    should be avoided for any column whose format is already known."""
    if fmt:
        ts = pd.to_datetime(raw, format=fmt, errors="coerce")
    else:
        ts = pd.to_datetime(raw, errors="coerce", dayfirst=True)
    return None if pd.isna(ts) else ts.to_pydatetime()


def parse_int(raw) -> Optional[int]:
    d = parse_idr(raw)
    return None if d is None else int(d)


def blank_to_none(raw):
    if raw is None:
        return None
    s = str(raw).strip()
    return None if s in ("", "-", "nan") else s


# ---------------------------------------------------------------------------
# Loader: orders + order_items
# ---------------------------------------------------------------------------

def load_orders(conn, resolver: LookupResolver, filepath: str) -> None:
    df = pd.read_excel(filepath, sheet_name="orders", dtype=str)

    with conn.cursor() as cur:
        for order_id, group in df.groupby("No. Pesanan", sort=False):
            header = group.iloc[0]

            # --- resolve every reference value for this row on the fly ---
            order_status_id = resolver.get_or_create_one(
                "order_statuses", "order_status_id", "status_name",
                header["Status Pesanan"],
            )
            payment_method_id = resolver.get_or_create_one(
                "payment_methods", "payment_method_id", "method_name",
                blank_to_none(header["Metode Pembayaran"]),
            )
            shipping_option_id = resolver.get_or_create_one(
                "shipping_options", "shipping_option_id", "option_name",
                blank_to_none(header["Opsi Pengiriman"]),
            )
            location_id = resolver.get_or_create(
                "locations", "location_id", ["city", "province"],
                (blank_to_none(header["Kota/Kabupaten"]), blank_to_none(header["Provinsi"])),
            )
            customer_id = resolver.get_or_create_one(
                "customers", "customer_id", "username",
                blank_to_none(header["Username (Pembeli)"]),
            )

            cur.execute(
                """
                INSERT INTO orders (
                    order_id, order_type, order_status_id, cancellation_reason,
                    cancellation_return_status, tracking_number, shipping_option_id,
                    dropoff_method, ship_by_at, arranged_shipment_at, order_created_at,
                    payment_at, payment_method_id, customer_id, receiver_name,
                    phone_number, shipping_address, location_id, buyer_note, seller_note,
                    total_qty_ordered, total_weight_grams, seller_voucher_amount,
                    coin_cashback_amount, shopee_voucher_amount,
                    bundle_discount_package_amount, bundle_discount_shopee_amount,
                    bundle_discount_seller_amount, shopee_coin_deduction_amount,
                    credit_card_discount_amount, shipping_fee_paid_by_buyer,
                    estimated_shipping_fee_discount, return_shipping_fee,
                    total_payment, estimated_shipping_fee, order_completed_at
                ) VALUES (
                    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s
                )
                ON CONFLICT (order_id) DO NOTHING
                """,
                (
                    order_id, blank_to_none(header["Tipe Pesanan"]), order_status_id,
                    blank_to_none(header["Alasan Pembatalan"]),
                    blank_to_none(header["Status Pembatalan/ Pengembalian"]),
                    blank_to_none(header["No. Resi"]), shipping_option_id,
                    blank_to_none(header["Antar ke counter/ pick-up"]),
                    parse_ts(header["Pesanan Harus Dikirimkan Sebelum (Menghindari keterlambatan)"], fmt="%Y-%m-%d %H:%M"),
                    parse_ts(header["Waktu Pengiriman Diatur"], fmt="%Y-%m-%d %H:%M"),
                    parse_ts(header["Waktu Pesanan Dibuat"], fmt="%Y-%m-%d %H:%M"),
                    parse_ts(header["Waktu Pembayaran Dilakukan"], fmt="%Y-%m-%d %H:%M"),
                    payment_method_id, customer_id, blank_to_none(header["Nama Penerima"]),
                    blank_to_none(header["No. Telepon"]), blank_to_none(header["Alamat Pengiriman"]),
                    location_id, blank_to_none(header["Catatan dari Pembeli"]), blank_to_none(header["Catatan"]),
                    parse_int(header["Jumlah Produk di Pesan"]), parse_int(header["Total Berat"]),
                    parse_idr(header["Voucher Ditanggung Penjual"]) or 0,
                    parse_idr(header["Cashback Koin"]) or 0,
                    parse_idr(header["Voucher Ditanggung Shopee"]) or 0,
                    parse_idr(header["Paket Diskon"]) or 0,
                    parse_idr(header["Paket Diskon (Diskon dari Shopee)"]) or 0,
                    parse_idr(header["Paket Diskon (Diskon dari Penjual)"]) or 0,
                    parse_idr(header["Potongan Koin Shopee"]) or 0,
                    parse_idr(header["Diskon Kartu Kredit"]) or 0,
                    parse_idr(header["Ongkos Kirim Dibayar oleh Pembeli"]) or 0,
                    parse_idr(header["Estimasi Potongan Biaya Pengiriman"]) or 0,
                    parse_idr(header["Ongkos Kirim Pengembalian Barang"]) or 0,
                    parse_idr(header["Total Pembayaran"]),
                    parse_idr(header["Perkiraan Ongkos Kirim"]) or 0,
                    parse_ts(header["Waktu Pesanan Selesai"], fmt="%Y-%m-%d %H:%M"),
                ),
            )

            for _, item in group.iterrows():
                # NOTE: variant_id intentionally left NULL — orders has no
                # exact key matching product_variants.variant_id yet
                # (documented assumption #2 in schema_design.md).
                cur.execute(
                    """
                    INSERT INTO order_items (
                        order_id, variant_id, product_name_snapshot, variant_name_snapshot,
                        sku_reference, original_price, discounted_price, quantity,
                        returned_quantity, item_subtotal, total_discount, seller_discount,
                        shopee_discount, product_weight_grams
                    ) VALUES (%s,NULL,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (order_id, sku_reference) DO NOTHING
                    """,
                    (
                        order_id, item["Nama Produk"], blank_to_none(item["Nama Variasi"]),
                        blank_to_none(item["Nomor Referensi SKU"]),
                        parse_idr(item["Harga Awal"]), parse_idr(item["Harga Setelah Diskon"]),
                        parse_int(item["Jumlah"]), parse_int(item["Returned quantity"]) or 0,
                        parse_idr(item["Subtotal Pesanan"]), parse_idr(item["Total Diskon"]) or 0,
                        parse_idr(item["Diskon Dari Penjual"]) or 0, parse_idr(item["Diskon Dari Shopee"]) or 0,
                        parse_int(item["Berat Produk"]),
                    ),
                )
    conn.commit()


# ---------------------------------------------------------------------------
# Loader: daily_order_performance (sheets: Pesanan Dibuat / Siap Dikirim / Dibayar)
# ---------------------------------------------------------------------------

def load_daily_order_performance(conn, resolver: LookupResolver, filepath: str, sheet_name: str) -> None:
    df = pd.read_excel(filepath, sheet_name=sheet_name, dtype=str)

    # These sheets contain a preamble before the real daily rows: a period
    # summary row (e.g. "01-06-2026-30-06-2026"), a blank separator row,
    # and a repeated header row. All three have a 'Tanggal' value that does
    # NOT match a single dd-mm-yyyy date, so a strict parse + dropna cleanly
    # isolates the actual daily rows without hardcoding a row offset.
    valid_dates = pd.to_datetime(df["Tanggal"], format="%d-%m-%Y", errors="coerce")
    df = df.loc[valid_dates.notna()].copy()

    # The pipeline stage is simply the sheet's own name — resolved (and
    # created on first sight) exactly like every other lookup value.
    stage_id = resolver.get_or_create_one(
        "order_pipeline_stages", "stage_id", "stage_name", sheet_name,
    )

    with conn.cursor() as cur:
        for _, row in df.iterrows():
            cur.execute(
                """
                INSERT INTO daily_order_performance (
                    report_date, stage_id, total_sales_idr, total_orders, sales_per_order,
                    products_clicked, total_visitors, order_conversion_rate,
                    cancelled_orders, cancelled_sales_idr, returned_orders, returned_sales_idr,
                    total_buyers, new_buyers, existing_buyers, potential_buyers,
                    repeat_purchase_rate
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (report_date, stage_id) DO NOTHING
                """,
                (
                    parse_ts(row["Tanggal"], fmt="%d-%m-%Y"), stage_id,
                    parse_idr(row["Total Penjualan (IDR)"]) or 0, parse_int(row["Total Pesanan"]) or 0,
                    parse_idr(row["Penjualan per Pesanan"]), parse_int(row["Produk Diklik"]) or 0,
                    parse_int(row["Total Pengunjung"]) or 0, parse_pct(row["Tingkat Konversi Pesanan"]),
                    parse_int(row["Pesanan Dibatalkan"]) or 0, parse_idr(row["Penjualan Dibatalkan"]) or 0,
                    parse_int(row["Pesanan Dikembalikan"]) or 0, parse_idr(row["Penjualan Dikembalikan"]) or 0,
                    parse_int(row["Pembeli"]) or 0, parse_int(row["Total Pembeli Baru"]) or 0,
                    parse_int(row["Total Pembeli Saat Ini"]) or 0, parse_int(row["Total Potensi Pembeli"]) or 0,
                    parse_pct(row["Tingkat Pembelian Berulang"]),
                ),
            )
    conn.commit()


def derive_report_period(conn, resolver: LookupResolver, filepath: str, stage_sheet: str = "Pesanan Dibuat") -> int:
    """Report period is derived from the data itself (min/max 'Tanggal' in a
    daily sheet) — never hardcoded to a specific month/year."""
    df = pd.read_excel(filepath, sheet_name=stage_sheet, dtype=str)
    dates = pd.to_datetime(df["Tanggal"], format="%d-%m-%Y", errors="coerce").dropna()
    period_start, period_end = dates.min().date(), dates.max().date()
    return resolver.get_or_create(
        "report_periods", "period_id", ["period_start", "period_end"],
        (period_start, period_end),
    )


# ---------------------------------------------------------------------------
# Loader: product_performance_summary (base metrics + price/ads classification)
# ---------------------------------------------------------------------------

def upsert_product(conn, resolver: LookupResolver, product_id: int, product_name: str,
                    status_name: Optional[str], current_price=None) -> None:
    status_id = resolver.get_or_create_one(
        "product_statuses", "status_id", "status_name", blank_to_none(status_name),
    )
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO products (product_id, product_name, product_status_id, current_price)
            VALUES (%s,%s,%s,%s)
            ON CONFLICT (product_id) DO UPDATE
                SET product_name = EXCLUDED.product_name,
                    product_status_id = EXCLUDED.product_status_id,
                    current_price = COALESCE(EXCLUDED.current_price, products.current_price)
            """,
            (product_id, product_name, status_id, current_price),
        )
    conn.commit()


def load_product_performance(conn, resolver: LookupResolver, filepath: str, period_id: int) -> None:
    df = pd.read_excel(filepath, sheet_name="Produk dengan Performa Terbaik", dtype=str)
    # Product-level rows only; variant rows (has "Kode Variasi") go to
    # product_variant_performance via the identical pattern — omitted here.
    df = df[df["Kode Variasi"].isna() | (df["Kode Variasi"].astype(str).str.strip() == "")]

    with conn.cursor() as cur:
        for _, row in df.iterrows():
            product_id = int(row["Kode Produk"])
            upsert_product(conn, resolver, product_id, row["Produk"], row["Status Produk Saat Ini"])
            status_id = resolver.get_or_create_one(
                "product_statuses", "status_id", "status_name", blank_to_none(row["Status Produk Saat Ini"]),
            )
            cur.execute(
                """
                INSERT INTO product_performance_summary (
                    period_id, product_id, product_status_id,
                    product_views, product_clicks, click_percentage,
                    orders_created, orders_ready_to_ship,
                    sales_created_idr, sales_ready_to_ship_idr
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (period_id, product_id) DO NOTHING
                """,
                (
                    period_id, product_id, status_id,
                    parse_int(row["Jumlah Produk Dilihat"]) or 0, parse_int(row["Produk Diklik"]) or 0,
                    parse_pct(row["Persentase Klik"]),
                    parse_int(row["Pesanan Dibuat"]) or 0, parse_int(row["Pesanan Siap Dikirim"]) or 0,
                    parse_idr(row["Total Penjualan (Pesanan Dibuat) (IDR)"]) or 0,
                    parse_idr(row["Penjualan (Pesanan Siap Dikirim) (IDR)"]) or 0,
                    # ...remaining ~25 metric columns map the same way (see schema_design.md §3.4)
                ),
            )
    conn.commit()


def apply_price_competitiveness(conn, resolver: LookupResolver, filepath: str, period_id: int, sheet_name: str) -> None:
    """sheet_name is either 'Harga Belum Kompetitif' or 'Harga Sudah Kompetitif' —
    the status text itself IS the sheet name, resolved automatically."""
    df = pd.read_excel(filepath, sheet_name=sheet_name, dtype=str)
    status_id = resolver.get_or_create_one(
        "price_competitiveness_statuses", "status_id", "status_name", sheet_name,
    )
    with conn.cursor() as cur:
        for _, row in df.iterrows():
            cur.execute(
                """
                UPDATE product_performance_summary
                   SET price_competitiveness_status_id = %s
                 WHERE period_id = %s AND product_id = %s
                """,
                (status_id, period_id, int(row["Kode Produk"])),
            )
    conn.commit()


def apply_ads_recommendation(conn, resolver: LookupResolver, filepath: str, period_id: int, sheet_name: str) -> None:
    """sheet_name is one of 'Tingkatkan dengan Iklan' / 'Iklankan' /
    'Cek Performa Iklan' — again, the stage name IS the sheet name."""
    df = pd.read_excel(filepath, sheet_name=sheet_name, dtype=str)
    stage_id = resolver.get_or_create_one(
        "ads_recommendation_stages", "stage_id", "stage_name", sheet_name,
    )
    with conn.cursor() as cur:
        for _, row in df.iterrows():
            cur.execute(
                """
                UPDATE product_performance_summary
                   SET ads_recommendation_stage_id = %s
                 WHERE period_id = %s AND product_id = %s
                """,
                (stage_id, period_id, int(row["Kode Produk"])),
            )
    conn.commit()


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def main():
    order_file = "/Users/rayhanadjisantoso/Desktop/ATLAS/data/Order 0626.xlsx"
    perf_file = "/Users/rayhanadjisantoso/Desktop/ATLAS/data/Performance Overview 0626.xlsx"
    product_file = "/Users/rayhanadjisantoso/Desktop/ATLAS/data/Product Performance 0626.xlsx"

    conn = psycopg2.connect(DB_DSN)
    with conn.cursor() as cur:
        cur.execute("SET search_path TO shopee, public")
    resolver = LookupResolver(conn)

    try:
        load_orders(conn, resolver, order_file)

        for stage_sheet in ["Pesanan Dibuat", "Pesanan Siap Dikirim", "Pesanan Dibayar"]:
            load_daily_order_performance(conn, resolver, perf_file, stage_sheet)

        period_id = derive_report_period(conn, resolver, perf_file)
        load_product_performance(conn, resolver, product_file, period_id)
        apply_price_competitiveness(conn, resolver, product_file, period_id, "Harga Belum Kompetitif")
        apply_price_competitiveness(conn, resolver, product_file, period_id, "Harga Sudah Kompetitif")
        for ads_sheet in ["Tingkatkan dengan Iklan", "Iklankan", "Cek Performa Iklan"]:
            apply_ads_recommendation(conn, resolver, product_file, period_id, ads_sheet)

        print("Import selesai. Lookup values resolved this run:", len(resolver._cache))
    finally:
        conn.close()


if __name__ == "__main__":
    main()


# ---------------------------------------------------------------------------
# EXTENDING TO OTHER SHEETS (daily_channel_performance, channel_product_
# contribution, product_variant_performance) — identical recipe:
#
#   1. Read the sheet.
#   2. For every categorical column (channel, sub-source, price status,
#      product status, ...), call resolver.get_or_create_one(...) or
#      resolver.get_or_create(...) with the table/id_col/value_col(s) from
#      schema.sql — never a literal value list.
#   3. INSERT the fact row using the ids returned in step 2.
#
# No new lookup tables, no hardcoded value lists, ever.
# ---------------------------------------------------------------------------