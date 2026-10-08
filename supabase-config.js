(function () {
  "use strict";

  const SUPABASE_URL =
    "https://axeqcbavupmpijhaaite.supabase.co";

  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_ktNCPoHwVtaMYfKTHTEODA_qEDo-8pp";

  // Check Supabase SDK
  if (!window.supabase) {
    console.error(
      "Supabase SDK not loaded. Load @supabase/supabase-js before supabase-config.js"
    );
    return;
  }

  // Create Supabase client
  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage
      }
    }
  );

  console.log("Supabase connected successfully.");
})();
