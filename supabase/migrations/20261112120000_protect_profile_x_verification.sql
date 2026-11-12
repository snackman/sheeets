-- Verified-X columns on public.profiles are written only by the server
-- (POST /api/profile/x-verify, service role). Browser clients (PostgREST roles
-- `anon` / `authenticated`) may not set or change them.
--
-- Why a trigger rather than column-level REVOKE/GRANT: the existing profiles
-- RLS policies and table grants are managed outside this repo, and column
-- privileges only restrict anything if the table-level UPDATE grant is first
-- revoked and every other column re-granted (which would break any column or
-- flow added later). A BEFORE trigger is additive, needs no knowledge of the
-- current grants, and applies to INSERT as well as UPDATE.
--
-- Rows written by service_role, postgres or SECURITY DEFINER functions owned
-- by postgres are untouched (current_user is not anon/authenticated there).
-- Protected values are silently restored rather than raising, so existing
-- profile-save calls that echo the full row keep working.
--
--  * x_verified, x_oauth_id, x_avatar_url: never client-writable.
--  * x_handle: free text while unverified (the profile form still lets people
--    enter a handle), but locked to its stored value once x_verified is true.

create or replace function public.protect_profile_x_verification()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.x_verified := false;
      new.x_oauth_id := null;
      new.x_avatar_url := null;
    else
      new.x_verified := old.x_verified;
      new.x_oauth_id := old.x_oauth_id;
      new.x_avatar_url := old.x_avatar_url;
      if old.x_verified then
        new.x_handle := old.x_handle;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_x_verification on public.profiles;
create trigger trg_protect_profile_x_verification
  before insert or update on public.profiles
  for each row execute function public.protect_profile_x_verification();
