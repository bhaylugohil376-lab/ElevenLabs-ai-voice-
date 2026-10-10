
import { supabaseAdmin } from "./_lib/supabase.js";
import { requireUser } from "./_lib/auth.js";
import {
  requireMethod,
  parseJsonBody,
  sendError,
  sendSuccess
} from "./_lib/response.js";

const AGENT_TYPES = ["voice", "assistant", "customer_support"];

export default async function handler(req, res) {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    if (!requireMethod(req, res, ["GET", "POST", "PATCH", "DELETE"])) {
      return;
    }

    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("agents")
        .select("id, name, description, type, config, status, created_at, updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(100);

      if (error) {
        console.error("Agent list error:", error.message);
        return sendError(res, 500, "Could not load agents.");
      }

      return sendSuccess(res, {
        agents: data || [],
        count: data?.length || 0
      });
    }

    const body = parseJsonBody(req);

    if (!body || typeof body !== "object") {
      return sendError(res, 400, "Valid JSON body is required.");
    }

    if (req.method === "POST") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const description =
        typeof body.description === "string" ? body.description.trim() : "";
      const type = body.type || "assistant";
      const config = body.config ?? {};
      const status = "draft";

      if (name.length < 2 || name.length > 100) {
        return sendError(res, 400, "Agent name must be 2–100 characters.");
      }

      if (description.length > 1000) {
        return sendError(res, 400, "Description is too long.");
      }

      if (!AGENT_TYPES.includes(type)) {
        return sendError(res, 400, "Invalid agent type.");
      }

      if (
        !config ||
        typeof config !== "object" ||
        Array.isArray(config) ||
        JSON.stringify(config).length > 20000
      ) {
        return sendError(res, 400, "Invalid agent configuration.");
      }

      const { data, error } = await supabaseAdmin
        .from("agents")
        .insert({
          user_id: user.id,
          name,
          description,
          type,
          config,
          status
        })
        .select("id, name, description, type, config, status, created_at, updated_at")
        .single();

      if (error) {
        console.error("Agent create error:", error.message);
        return sendError(res, 500, "Could not create agent.");
      }

      return sendSuccess(res, {
        message: "Agent draft created.",
        agent: data
      });
    }

    if (
      typeof body.id !== "string" ||
      body.id.length < 1 ||
      body.id.length > 100
    ) {
      return sendError(res, 400, "A valid agent id is required.");
    }

    if (req.method === "PATCH") {
      const updates = { updated_at: new Date().toISOString() };

      if (Object.hasOwn(body, "name")) {
        if (
          typeof body.name !== "string" ||
          body.name.trim().length < 2 ||
          body.name.trim().length > 100
        ) {
          return sendError(res, 400, "Invalid agent name.");
        }
        updates.name = body.name.trim();
      }

      if (Object.hasOwn(body, "description")) {
        if (
          typeof body.description !== "string" ||
          body.description.trim().length > 1000
        ) {
          return sendError(res, 400, "Invalid description.");
        }
        updates.description = body.description.trim();
      }

      if (Object.hasOwn(body, "type")) {
        if (!AGENT_TYPES.includes(body.type)) {
          return sendError(res, 400, "Invalid agent type.");
        }
        updates.type = body.type;
      }

      if (Object.hasOwn(body, "config")) {
        if (
          !body.config ||
          typeof body.config !== "object" ||
          Array.isArray(body.config) ||
          JSON.stringify(body.config).length > 20000
        ) {
          return sendError(res, 400, "Invalid agent configuration.");
        }
        updates.config = body.config;
      }

      const editableFields = ["name", "description", "type", "config"];
      if (!editableFields.some((key) => Object.hasOwn(body, key))) {
        return sendError(res, 400, "No editable fields provided.");
      }

      const { data, error } = await supabaseAdmin
        .from("agents")
        .update(updates)
        .eq("id", body.id)
        .eq("user_id", user.id)
        .select("id, name, description, type, config, status, created_at, updated_at")
        .maybeSingle();

      if (error) {
        console.error("Agent update error:", error.message);
        return sendError(res, 500, "Could not update agent.");
      }

      if (!data) {
        return sendError(res, 404, "Agent not found.");
      }

      return sendSuccess(res, {
        message: "Agent updated.",
        agent: data
      });
    }

    const { data, error } = await supabaseAdmin
      .from("agents")
      .delete()
      .eq("id", body.id)
      .eq("user_id", user.id)
      .select("id");

    if (error) {
      console.error("Agent delete error:", error.message);
      return sendError(res, 500, "Could not delete agent.");
    }

    if (!data?.length) {
      return sendError(res, 404, "Agent not found.");
    }

    return sendSuccess(res, {
      message: "Agent deleted.",
      id: data[0].id
    });
  } catch (error) {
    console.error("Agents API error:", error);
    return sendError(res, 500, "Unexpected server error.");
  }
}
