-- Reference currencies every order, invoice and payment refers to (currencies.code).
-- They were created only by the development seed, so a production database built
-- from migrations alone had none and every order insert failed its foreign key.
-- Idempotent: existing rows (development, tests) are left exactly as they are.
-- Exchange rates are business data and are entered in the application, not here.
INSERT INTO currencies (code, name, minor_units, is_active) VALUES
  ('ALL', 'Albanian lek', 2, true),
  ('EUR', 'Euro', 2, true),
  ('USD', 'US dollar', 2, true)
ON CONFLICT (code) DO NOTHING;
