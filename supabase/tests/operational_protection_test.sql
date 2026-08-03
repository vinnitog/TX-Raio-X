begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(7);

insert into auth.users (id) values ('50000000-0000-4000-8000-000000000001');

select extensions.ok(
  public.enforce_account_rate_limit(
    '50000000-0000-4000-8000-000000000001', 'checkout', 2, 600
  ),
  'first request is admitted'
);
select extensions.ok(
  public.enforce_account_rate_limit(
    '50000000-0000-4000-8000-000000000001', 'checkout', 2, 600
  ),
  'request at the limit is admitted'
);
select extensions.ok(
  not public.enforce_account_rate_limit(
    '50000000-0000-4000-8000-000000000001', 'checkout', 2, 600
  ),
  'request above the limit is rejected'
);
select extensions.ok(
  public.enforce_account_rate_limit(
    '50000000-0000-4000-8000-000000000001', 'consume_analysis', 1, 60
  ),
  'a different scope has an independent bucket'
);
select extensions.ok(
  not has_function_privilege(
    'anon', 'public.enforce_account_rate_limit(uuid,text,integer,integer)', 'EXECUTE'
  ),
  'anonymous clients cannot execute the limiter'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated', 'public.enforce_account_rate_limit(uuid,text,integer,integer)', 'EXECUTE'
  ),
  'authenticated clients cannot choose their own rate-limit parameters'
);
select extensions.ok(
  has_function_privilege(
    'service_role', 'public.enforce_account_rate_limit(uuid,text,integer,integer)', 'EXECUTE'
  ),
  'only the trusted backend can execute the limiter'
);

select * from extensions.finish();
rollback;
