import {
  ApiError,
  getAuthenticatedUser,
  getServiceClient,
  handleError,
  handleOptions,
  jsonResponse
} from "../_shared/crypto-payments.ts";

Deno.serve(async (request) => {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  try {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed.", code: "method_not_allowed" }, 405);
    }

    const supabase = getServiceClient();
    const user = await getAuthenticatedUser(request, supabase);
    const body = (await request.json()) as Record<string, unknown>;
    const itemType = String(body.item_type ?? "").trim();
    const itemId = String(body.item_id ?? "").trim();

    if ((itemType !== "course" && itemType !== "guide") || !itemId) {
      throw new ApiError(400, "invalid_balance_purchase_item", "Choose one course or guide.");
    }

    const { data, error } = await supabase.rpc("spend_account_balance_for_user", {
      target_user_id: user.id,
      target_course_id: itemType === "course" ? itemId : null,
      target_guide_id: itemType === "guide" ? itemId : null
    });

    if (error) {
      throw new ApiError(400, "balance_purchase_failed", error.message);
    }

    const result = Array.isArray(data) ? data[0] : data;
    return jsonResponse({ result });
  } catch (error) {
    return handleError(error);
  }
});
