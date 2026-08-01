drop table if exists order_shipping_labels;

alter table app_settings
  drop column if exists shipping_origin_name,
  drop column if exists shipping_origin_company,
  drop column if exists shipping_origin_address1,
  drop column if exists shipping_origin_address2,
  drop column if exists shipping_origin_city,
  drop column if exists shipping_origin_state,
  drop column if exists shipping_origin_zip,
  drop column if exists shipping_origin_country,
  drop column if exists shipping_origin_phone,
  drop column if exists shipping_origin_email;
