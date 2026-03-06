-- Update sponsors to use beforeText/linkText/afterText fields
update public.admin_config
set value = '[{"beforeText": "Supported by ", "linkText": "Stand With Crypto", "afterText": ". Join the Fight for Sensible Crypto Policy!", "url": "https://www.standwithcrypto.org/"}]',
    updated_at = now()
where key = 'sponsors';
