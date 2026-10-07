-- Normalize the Internal Dashboard's original industry labels to the four
-- categories edited in Brand Setting. Both pages keep using brands.industry
-- as their single source of truth; sub_industry remains unchanged.

SET search_path TO public;

INSERT INTO industry_hierarchy (kategori_besar, industry, sub_industry)
SELECT kategori_besar,
       CASE industry
         WHEN 'Retail-Fashion' THEN 'Retail Fashion'
         WHEN 'Retail-Non Fashion' THEN 'Retail Non-Fashion'
         WHEN 'Food & Beverages' THEN 'Food & Beverage'
         WHEN 'B2B + Services' THEN 'B2B Services'
       END,
       sub_industry
FROM industry_hierarchy
WHERE industry IN ('Retail-Fashion', 'Retail-Non Fashion', 'Food & Beverages', 'B2B + Services')
ON CONFLICT (industry, sub_industry) DO UPDATE
SET kategori_besar = EXCLUDED.kategori_besar;

UPDATE brands
SET industry = CASE industry
  WHEN 'Retail-Fashion' THEN 'Retail Fashion'
  WHEN 'Retail-Non Fashion' THEN 'Retail Non-Fashion'
  WHEN 'Food & Beverages' THEN 'Food & Beverage'
  WHEN 'B2B + Services' THEN 'B2B Services'
END
WHERE industry IN ('Retail-Fashion', 'Retail-Non Fashion', 'Food & Beverages', 'B2B + Services');

DELETE FROM industry_hierarchy
WHERE industry IN ('Retail-Fashion', 'Retail-Non Fashion', 'Food & Beverages', 'B2B + Services');
