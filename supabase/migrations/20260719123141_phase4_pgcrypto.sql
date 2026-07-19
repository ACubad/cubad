-- Phase 4: ensure pgcrypto is available for sha256 code hashing.
-- On Supabase, extensions live in the dedicated `extensions` schema.
create extension if not exists pgcrypto with schema extensions;
