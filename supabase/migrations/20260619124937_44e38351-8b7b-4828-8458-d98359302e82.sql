CREATE UNIQUE INDEX IF NOT EXISTS parsed_rows_source_file_row_unique
ON public.parsed_rows(source_file_id, row_index);