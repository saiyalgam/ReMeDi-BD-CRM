-- Update 6: TPIN unlock. Run after update-5.sql. Safe to run more than once; it never deletes data.
-- Stores one PIN hash per user (scrypt, per-user salt). The PIN itself is never stored.
-- Row-level security is ON with NO policies: browsers (anon / authenticated keys) cannot read or write this table.
-- Only server code with the service-role key (lib/pin.ts) can use it.

create table if not exists public.user_pins (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  pin_hash     text not null check (pin_hash like 'scrypt$%'),
  failed_count int  not null default 0 check (failed_count >= 0),
  locked       boolean not null default false,
  updated_at   timestamptz not null default now()
);

alter table public.user_pins enable row level security;
revoke all on public.user_pins from anon, authenticated;

comment on table public.user_pins is 'TPIN hashes for quick unlock. Service role only. Admin reset: delete the user''s row; they set a new PIN after their next email sign-in.';
