create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule(
 'paozinhos-planilha-sync',
 '* * * * *',
 $job$select net.http_get(
 url:='https://script.google.com/macros/s/AKfycby-E-1j5rfU1eAMWX-5APMTMCK7C_0muyeV4FdM8JlbHTxKL47lqimoVlyuHdV0vcU4/exec?syncAuto=1',
 timeout_milliseconds:=55000
 );$job$
);
