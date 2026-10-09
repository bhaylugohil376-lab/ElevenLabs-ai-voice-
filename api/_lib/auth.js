
import { supabaseAdmin } from "./supabase.js";

export async function requireUser(req, res) {
  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    res.status(401).json({
      error: "Authentication required. Please log in."
    });
    return null;
  }

  const accessToken = match[1].trim();

  if (!accessToken) {
    res.status(401).json({
      error: "Invalid access token."
    });
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !data?.user) {
    res.status(401).json({
      error: "Your session is invalid or expired. Please log in again."
    });
    return null;
  }

  return data.user;
}
