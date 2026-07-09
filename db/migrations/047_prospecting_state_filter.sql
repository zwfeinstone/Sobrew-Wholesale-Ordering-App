alter table prospecting_leads
  add column if not exists state_key text;

with normalized as (
  select
    id,
    nullif(upper(regexp_replace(coalesce(state, ''), '[^A-Za-z]', '', 'g')), '') as compact,
    lower(trim(regexp_replace(coalesce(state, ''), '[^A-Za-z0-9]+', ' ', 'g'))) as name_key
  from prospecting_leads
)
update prospecting_leads
set state_key = case
  when normalized.compact in ('AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC') then normalized.compact
  when normalized.name_key = 'alabama' then 'AL'
  when normalized.name_key = 'alaska' then 'AK'
  when normalized.name_key = 'arizona' then 'AZ'
  when normalized.name_key = 'arkansas' then 'AR'
  when normalized.name_key = 'california' then 'CA'
  when normalized.name_key = 'colorado' then 'CO'
  when normalized.name_key = 'connecticut' then 'CT'
  when normalized.name_key = 'delaware' then 'DE'
  when normalized.name_key = 'florida' then 'FL'
  when normalized.name_key = 'georgia' then 'GA'
  when normalized.name_key = 'hawaii' then 'HI'
  when normalized.name_key = 'idaho' then 'ID'
  when normalized.name_key = 'illinois' then 'IL'
  when normalized.name_key = 'indiana' then 'IN'
  when normalized.name_key = 'iowa' then 'IA'
  when normalized.name_key = 'kansas' then 'KS'
  when normalized.name_key = 'kentucky' then 'KY'
  when normalized.name_key = 'louisiana' then 'LA'
  when normalized.name_key = 'maine' then 'ME'
  when normalized.name_key = 'maryland' then 'MD'
  when normalized.name_key = 'massachusetts' then 'MA'
  when normalized.name_key = 'michigan' then 'MI'
  when normalized.name_key = 'minnesota' then 'MN'
  when normalized.name_key = 'mississippi' then 'MS'
  when normalized.name_key = 'missouri' then 'MO'
  when normalized.name_key = 'montana' then 'MT'
  when normalized.name_key = 'nebraska' then 'NE'
  when normalized.name_key = 'nevada' then 'NV'
  when normalized.name_key = 'new hampshire' then 'NH'
  when normalized.name_key = 'new jersey' then 'NJ'
  when normalized.name_key = 'new mexico' then 'NM'
  when normalized.name_key = 'new york' then 'NY'
  when normalized.name_key = 'north carolina' then 'NC'
  when normalized.name_key = 'north dakota' then 'ND'
  when normalized.name_key = 'ohio' then 'OH'
  when normalized.name_key = 'oklahoma' then 'OK'
  when normalized.name_key = 'oregon' then 'OR'
  when normalized.name_key = 'pennsylvania' then 'PA'
  when normalized.name_key = 'rhode island' then 'RI'
  when normalized.name_key = 'south carolina' then 'SC'
  when normalized.name_key = 'south dakota' then 'SD'
  when normalized.name_key = 'tennessee' then 'TN'
  when normalized.name_key = 'texas' then 'TX'
  when normalized.name_key = 'utah' then 'UT'
  when normalized.name_key = 'vermont' then 'VT'
  when normalized.name_key = 'virginia' then 'VA'
  when normalized.name_key = 'washington' then 'WA'
  when normalized.name_key = 'west virginia' then 'WV'
  when normalized.name_key = 'wisconsin' then 'WI'
  when normalized.name_key = 'wyoming' then 'WY'
  when normalized.name_key in ('district of columbia','washington dc','dc') then 'DC'
  else null
end
from normalized
where prospecting_leads.id = normalized.id;

alter table prospecting_leads
  drop constraint if exists prospecting_leads_state_key_check;

alter table prospecting_leads
  add constraint prospecting_leads_state_key_check
  check (
    state_key is null
    or state_key in ('AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC')
  );

create index if not exists prospecting_leads_state_key_idx
  on prospecting_leads(state_key)
  where archived_at is null;

create index if not exists prospecting_leads_assigned_state_stage_idx
  on prospecting_leads(assigned_profile_id, state_key, stage)
  where archived_at is null;
