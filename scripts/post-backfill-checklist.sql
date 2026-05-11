-- ============================================================
-- POST-BACKFILL CHECKLIST
-- Run these in the Tiger Cloud SQL Editor after backfill completes
-- ============================================================

-- STEP 1: Verify data
SELECT
  pg_size_pretty(pg_database_size(current_database())) AS db_size,
  (SELECT reltuples::bigint FROM pg_class WHERE relname = 'telemetry_raw') AS est_rows,
  (SELECT COUNT(*) FROM timescaledb_information.chunks WHERE hypertable_name = 'telemetry_raw') AS chunks,
  (SELECT MIN(range_start)::date FROM timescaledb_information.chunks WHERE hypertable_name = 'telemetry_raw') AS earliest,
  (SELECT MAX(range_end)::date FROM timescaledb_information.chunks WHERE hypertable_name = 'telemetry_raw') AS latest;

-- STEP 2: Re-enable compression policy
SELECT alter_job(1025, scheduled => true);

-- STEP 3: Compress ALL chunks at once (don't wait for hourly policy)
DO $$
DECLARE chunk RECORD; cnt INT := 0;
BEGIN
  FOR chunk IN
    SELECT format('%I.%I', chunk_schema, chunk_name) AS full_name
    FROM timescaledb_information.chunks
    WHERE hypertable_name = 'telemetry_raw'
      AND NOT is_compressed
      AND range_end < NOW() - INTERVAL '1 day'
    ORDER BY range_start
  LOOP
    PERFORM compress_chunk(chunk.full_name::regclass);
    cnt := cnt + 1;
    IF cnt % 50 = 0 THEN RAISE NOTICE 'Compressed % chunks...', cnt; END IF;
  END LOOP;
  RAISE NOTICE 'Done: compressed % chunks', cnt;
END $$;

-- STEP 4: Verify compression ratio
SELECT * FROM hypertable_compression_stats('telemetry_raw');

-- STEP 5: Re-enable S3 tiering policy
SELECT alter_job(1023, scheduled => true);

-- STEP 6: Remove any retention policies (we want data forever)
SELECT remove_retention_policy('telemetry_raw', if_exists => true);

-- STEP 7: Final verification
SELECT
  pg_size_pretty(pg_database_size(current_database())) AS db_size,
  (SELECT COUNT(*) FROM timescaledb_information.chunks WHERE hypertable_name = 'telemetry_raw') AS total_chunks,
  (SELECT COUNT(*) FROM timescaledb_information.chunks WHERE hypertable_name = 'telemetry_raw' AND is_compressed) AS compressed_chunks,
  (SELECT COUNT(*) FROM timescaledb_information.chunks WHERE hypertable_name = 'telemetry_raw' AND NOT is_compressed) AS uncompressed_chunks;

-- STEP 8: Check all policies are correct
SELECT job_id, proc_name, scheduled, config
FROM timescaledb_information.jobs
WHERE hypertable_name = 'telemetry_raw';
