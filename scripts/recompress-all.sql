-- ============================================================
-- Recompress all chunks with new segmentby = site_id, asset_id
-- Run AFTER scaling up to 16 CPU
-- Uses parallel workers for decompression
-- ============================================================

-- Maximize parallel workers for this session
SET max_parallel_workers_per_gather = 8;
SET parallel_tuple_cost = 0.001;
SET parallel_setup_cost = 0.001;
SET work_mem = '512MB';
SET maintenance_work_mem = '2GB';

-- Verify new settings are active
SELECT attname, segmentby_column_index, orderby_column_index
FROM timescaledb_information.compression_settings
WHERE hypertable_name = 'telemetry_raw';

-- Count chunks to recompress
SELECT COUNT(*) AS chunks_to_recompress
FROM timescaledb_information.chunks
WHERE hypertable_name = 'telemetry_raw' AND is_compressed = true;

-- Recompress ALL compressed chunks in sequence
-- Each chunk: decompress → recompress with new segmentby
DO $$
DECLARE
  chunk RECORD;
  cnt INT := 0;
  total INT;
  start_ts TIMESTAMPTZ := clock_timestamp();
  chunk_start TIMESTAMPTZ;
  before_size BIGINT;
  after_size BIGINT;
  total_before BIGINT := 0;
  total_after BIGINT := 0;
BEGIN
  SELECT COUNT(*) INTO total
  FROM timescaledb_information.chunks
  WHERE hypertable_name = 'telemetry_raw' AND is_compressed = true;

  RAISE NOTICE '=== Starting recompression of % chunks ===', total;
  RAISE NOTICE 'New settings: segmentby = site_id, asset_id | orderby = ts DESC';
  RAISE NOTICE '';

  FOR chunk IN
    SELECT format('%I.%I', chunk_schema, chunk_name) AS full_name,
           chunk_name, range_start, range_end
    FROM timescaledb_information.chunks
    WHERE hypertable_name = 'telemetry_raw' AND is_compressed = true
    ORDER BY range_start ASC  -- oldest first
  LOOP
    cnt := cnt + 1;
    chunk_start := clock_timestamp();

    RAISE NOTICE '[%/%] % (% to %)',
      cnt, total, chunk.chunk_name,
      chunk.range_start::date, chunk.range_end::date;

    -- Decompress
    PERFORM decompress_chunk(chunk.full_name::regclass);

    -- Get uncompressed size
    EXECUTE format('SELECT pg_total_relation_size(%L)', chunk.full_name) INTO before_size;
    total_before := total_before + before_size;

    RAISE NOTICE '  Decompressed: % GB in %s',
      round(before_size::numeric / 1073741824, 2),
      round(EXTRACT(EPOCH FROM clock_timestamp() - chunk_start)::numeric, 1);

    -- Recompress with new settings
    PERFORM compress_chunk(chunk.full_name::regclass);

    -- Get new compressed size
    EXECUTE format('SELECT pg_total_relation_size(%L)', chunk.full_name) INTO after_size;
    total_after := total_after + after_size;

    RAISE NOTICE '  Recompressed: % MB (ratio: %x) in %s total',
      round(after_size::numeric / 1048576, 2),
      CASE WHEN after_size > 0 THEN round(before_size::numeric / after_size, 1) ELSE 0 END,
      round(EXTRACT(EPOCH FROM clock_timestamp() - chunk_start)::numeric, 1);

    -- Progress summary every 10 chunks
    IF cnt % 10 = 0 THEN
      RAISE NOTICE '';
      RAISE NOTICE '  === Progress: %/% chunks, elapsed: %s, before: % GB, after: % GB ===',
        cnt, total,
        round(EXTRACT(EPOCH FROM clock_timestamp() - start_ts)::numeric, 0),
        round(total_before::numeric / 1073741824, 2),
        round(total_after::numeric / 1073741824, 2);
      RAISE NOTICE '';
    END IF;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '=== RECOMPRESSION COMPLETE ===';
  RAISE NOTICE 'Chunks: %', total;
  RAISE NOTICE 'Total uncompressed: % GB', round(total_before::numeric / 1073741824, 2);
  RAISE NOTICE 'Total compressed: % GB', round(total_after::numeric / 1073741824, 2);
  RAISE NOTICE 'Compression ratio: %x',
    CASE WHEN total_after > 0 THEN round(total_before::numeric / total_after, 1) ELSE 0 END;
  RAISE NOTICE 'Space saved: % GB',
    round((total_before - total_after)::numeric / 1073741824, 2);
  RAISE NOTICE 'Elapsed: %s', round(EXTRACT(EPOCH FROM clock_timestamp() - start_ts)::numeric, 0);
END $$;
