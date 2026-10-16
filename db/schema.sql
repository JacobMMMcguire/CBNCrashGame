-- Ascent persistent storage (Supabase / PostgreSQL).
-- The server runs this on every start; every statement is idempotent.
-- Money is integer hundredths of a play credit; multipliers are integer hundredths.

create table if not exists accounts (
    account_id  text primary key,
    balance     bigint not null check (balance >= 0),
    language    text not null,
    name        text,
    created_at  timestamptz not null default now()
);

-- Round and bet numbers come from sequences so ids stay unique across restarts.
create sequence if not exists round_no_seq;

create table if not exists rounds (
    round_no     bigint primary key,
    round_id     text not null unique,
    crash        integer not null,
    server_seed  text not null,
    commitment   text not null,
    closes_at    bigint,
    launched_at  bigint,
    crash_at     bigint,
    settled_at   timestamptz not null default now()
);

create table if not exists bets (
    bet_no         bigserial primary key,
    account_id     text not null references accounts (account_id),
    round_id       text not null,
    wager          bigint not null check (wager > 0),
    auto_cash_out  integer,
    status         text not null default 'active' check (status in ('active', 'cashed-out', 'lost')),
    multiplier     integer,
    payout         bigint,
    auto           boolean not null default false,
    placed_at      timestamptz not null default now(),
    cashed_out_at  timestamptz,
    unique (account_id, round_id)
);
create index if not exists bets_round_id_idx on bets (round_id);

create table if not exists idempotency_keys (
    account_id   text not null,
    key          text not null,
    fingerprint  text not null,
    status       integer not null,
    body         jsonb not null,
    created_at   timestamptz not null default now(),
    primary key (account_id, key)
);

-- Supabase exposes tables in "public" through its REST API with the anon key.
-- Row-level security with no policies blocks that path; only the server's own
-- database role (which bypasses RLS as the table owner) can read or write.
alter table accounts enable row level security;
alter table rounds enable row level security;
alter table bets enable row level security;
alter table idempotency_keys enable row level security;
