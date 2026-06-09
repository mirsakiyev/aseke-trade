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
    const productType = String(body.product_type ?? "").trim();
    const planId = String(body.plan_id ?? "").trim();

    if (productType === "premium" || itemType === "premium") {
      if (!planId) {
        throw new ApiError(400, "plan_id_required", "Choose a Premium plan.");
      }
    } else if ((itemType !== "course" && itemType !== "guide") || !itemId) {
      throw new ApiError(400, "invalid_balance_purchase_item", "Choose Premium, one course, or one guide.");
    }

    const { data, error } = await supabase.rpc("spend_account_balance_for_user", {
      target_user_id: user.id,
      target_course_id: itemType === "course" ? itemId : null,
      target_guide_id: itemType === "guide" ? itemId : null,
      target_plan_id: productType === "premium" || itemType === "premium" ? planId : null
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
