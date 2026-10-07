const SUPABASE_URL = "https://axeqcbavupmpijhaaite.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_ktNCPoHwVtaMYfKTHTEODA_qEDo-8pp";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
