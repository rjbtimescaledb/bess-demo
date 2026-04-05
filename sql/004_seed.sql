-- ============================================================
-- BESS Demo: Seed Data
-- ============================================================

-- Organization
INSERT INTO organizations (org_id, name, slug, region) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Apex Energy Storage', 'apex-energy', 'US-WEST')
ON CONFLICT (org_id) DO NOTHING;

-- Sites
INSERT INTO sites (site_id, org_id, name, slug, latitude, longitude, capacity_mw, capacity_mwh, commissioned, status, timezone) VALUES
    ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'Mojave Solar+Storage',       'mojave',         35.2527,  -117.0135, 200, 800,  '2024-03-15', 'operational', 'America/Los_Angeles'),
    ('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000001', 'Texas Grid Reserve',          'texas-grid',      31.9973,  -102.0779, 300, 1200, '2024-06-01', 'operational', 'America/Chicago'),
    ('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000001', 'PJM East Gateway',            'pjm-east',        39.6837,  -75.7497,  150, 600,  '2024-09-20', 'operational', 'America/New_York'),
    ('00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000001', 'Desert Peak Storage',         'desert-peak',     38.0672,  -117.2302, 100, 400,  '2025-01-10', 'operational', 'America/Los_Angeles'),
    ('00000000-0000-0000-0001-000000000005', '00000000-0000-0000-0000-000000000001', 'Gulf Coast Resilience Hub',   'gulf-coast',      29.7604,  -95.3698,  250, 1000, '2025-04-01', 'operational', 'America/Chicago')
ON CONFLICT (site_id) DO NOTHING;

-- Battery Assets
-- Mojave (200MW/800MWh) = 4 x 50MW/200MWh
INSERT INTO battery_assets (asset_id, site_id, name, manufacturer, model, serial_number, capacity_mwh, max_power_mw, chemistry, install_date, status) VALUES
    ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0001-000000000001', 'BESS Unit A1', 'CATL',           'EnerOne',      'CATL-MOJ-A1-2024', 200, 50,  'LFP', '2024-02-01', 'online'),
    ('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0001-000000000001', 'BESS Unit A2', 'CATL',           'EnerOne',      'CATL-MOJ-A2-2024', 200, 50,  'LFP', '2024-02-15', 'online'),
    ('00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0001-000000000001', 'BESS Unit B1', 'BYD',            'BatteryBox',   'BYD-MOJ-B1-2024',  200, 50,  'LFP', '2024-03-01', 'online'),
    ('00000000-0000-0000-0002-000000000004', '00000000-0000-0000-0001-000000000001', 'BESS Unit B2', 'BYD',            'BatteryBox',   'BYD-MOJ-B2-2024',  200, 50,  'LFP', '2024-03-10', 'online')
ON CONFLICT (asset_id) DO NOTHING;

-- Texas (300MW/1200MWh) = 3 x 100MW/400MWh
INSERT INTO battery_assets (asset_id, site_id, name, manufacturer, model, serial_number, capacity_mwh, max_power_mw, chemistry, install_date, status) VALUES
    ('00000000-0000-0000-0002-000000000005', '00000000-0000-0000-0001-000000000002', 'BESS Unit T1', 'Tesla',          'Megapack 2XL', 'TSLA-TX-T1-2024',  400, 100, 'LFP', '2024-04-15', 'online'),
    ('00000000-0000-0000-0002-000000000006', '00000000-0000-0000-0001-000000000002', 'BESS Unit T2', 'Tesla',          'Megapack 2XL', 'TSLA-TX-T2-2024',  400, 100, 'LFP', '2024-05-01', 'online'),
    ('00000000-0000-0000-0002-000000000007', '00000000-0000-0000-0001-000000000002', 'BESS Unit T3', 'Tesla',          'Megapack 2XL', 'TSLA-TX-T3-2024',  400, 100, 'LFP', '2024-05-15', 'online')
ON CONFLICT (asset_id) DO NOTHING;

-- PJM East (150MW/600MWh) = 3 x 50MW/200MWh
INSERT INTO battery_assets (asset_id, site_id, name, manufacturer, model, serial_number, capacity_mwh, max_power_mw, chemistry, install_date, status) VALUES
    ('00000000-0000-0000-0002-000000000008', '00000000-0000-0000-0001-000000000003', 'BESS Unit E1', 'Fluence',        'Gridstack',    'FLU-PJM-E1-2024',  200, 50,  'LFP', '2024-08-01', 'online'),
    ('00000000-0000-0000-0002-000000000009', '00000000-0000-0000-0001-000000000003', 'BESS Unit E2', 'Fluence',        'Gridstack',    'FLU-PJM-E2-2024',  200, 50,  'LFP', '2024-08-20', 'online'),
    ('00000000-0000-0000-0002-000000000010', '00000000-0000-0000-0001-000000000003', 'BESS Unit E3', 'Samsung SDI',    'SBB 2.5',      'SAM-PJM-E3-2024',  200, 50,  'LFP', '2024-09-05', 'online')
ON CONFLICT (asset_id) DO NOTHING;

-- Desert Peak (100MW/400MWh) = 2 x 50MW/200MWh
INSERT INTO battery_assets (asset_id, site_id, name, manufacturer, model, serial_number, capacity_mwh, max_power_mw, chemistry, install_date, status) VALUES
    ('00000000-0000-0000-0002-000000000011', '00000000-0000-0000-0001-000000000004', 'BESS Unit D1', 'CATL',           'EnerOne Plus', 'CATL-DP-D1-2025',  200, 50,  'LFP', '2024-12-01', 'online'),
    ('00000000-0000-0000-0002-000000000012', '00000000-0000-0000-0001-000000000004', 'BESS Unit D2', 'BYD',            'MC Cube',      'BYD-DP-D2-2025',   200, 50,  'LFP', '2024-12-20', 'online')
ON CONFLICT (asset_id) DO NOTHING;

-- Gulf Coast (250MW/1000MWh) = 4 x 62.5MW/250MWh
INSERT INTO battery_assets (asset_id, site_id, name, manufacturer, model, serial_number, capacity_mwh, max_power_mw, chemistry, install_date, status) VALUES
    ('00000000-0000-0000-0002-000000000013', '00000000-0000-0000-0001-000000000005', 'BESS Unit G1', 'Tesla',          'Megapack 2XL', 'TSLA-GC-G1-2025',  250, 62.5, 'LFP', '2025-02-01', 'online'),
    ('00000000-0000-0000-0002-000000000014', '00000000-0000-0000-0001-000000000005', 'BESS Unit G2', 'Tesla',          'Megapack 2XL', 'TSLA-GC-G2-2025',  250, 62.5, 'LFP', '2025-02-15', 'online'),
    ('00000000-0000-0000-0002-000000000015', '00000000-0000-0000-0001-000000000005', 'BESS Unit G3', 'Fluence',        'Gridstack Pro','FLU-GC-G3-2025',   250, 62.5, 'LFP', '2025-03-01', 'online'),
    ('00000000-0000-0000-0002-000000000016', '00000000-0000-0000-0001-000000000005', 'BESS Unit G4', 'Fluence',        'Gridstack Pro','FLU-GC-G4-2025',   250, 62.5, 'LFP', '2025-03-15', 'online')
ON CONFLICT (asset_id) DO NOTHING;

-- PCS Inverters (2 per asset)
INSERT INTO pcs_inverters (inverter_id, asset_id, site_id, name, manufacturer, rated_power_mw, status)
SELECT
    ('00000000-0000-0000-0003-' || LPAD((row_number() OVER ())::TEXT, 12, '0'))::UUID,
    a.asset_id,
    a.site_id,
    'PCS-' || SUBSTRING(a.name FROM 'Unit (.+)') || '-' || s.n,
    CASE WHEN a.manufacturer IN ('Tesla','Fluence') THEN a.manufacturer ELSE 'SMA' END,
    a.max_power_mw / 2.0,
    'online'
FROM battery_assets a
CROSS JOIN generate_series(1, 2) AS s(n)
ON CONFLICT (inverter_id) DO NOTHING;

-- Battery Racks (6 per asset)
INSERT INTO battery_racks (rack_id, asset_id, name, module_count, cell_count, status)
SELECT
    ('00000000-0000-0000-0004-' || LPAD((row_number() OVER ())::TEXT, 12, '0'))::UUID,
    a.asset_id,
    'Rack-' || SUBSTRING(a.name FROM 'Unit (.+)') || '-' || LPAD(s.n::TEXT, 2, '0'),
    16,
    256,
    'online'
FROM battery_assets a
CROSS JOIN generate_series(1, 6) AS s(n)
ON CONFLICT (rack_id) DO NOTHING;
