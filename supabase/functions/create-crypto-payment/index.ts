import {
  getActivePaymentMethod,
  getAuthenticatedUser,
  getServiceClient,
  handleError,
  handleOptions,
  jsonResponse,
  normalizeAssetNetwork,
  resolveCheckoutItem
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
    const { asset, network } = normalizeAssetNetwork(body.asset, body.network);
    const method = await getActivePaymentMethod(supabase, asset, network);
    const item = await resolveCheckoutItem(supabase, body);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("crypto_payments")
      .insert({
        user_id: user.id,
        course_id: item.courseId,
        guide_id: item.guideId,
        payment_method_id: method.row.id,
        expected_amount: item.expectedAmount,
        asset,
        network,
        receive_address: method.row.receive_address,
        status: "pending",
        expires_at: expiresAt
      })
      .select("*")
      .single();

    if (error || !data) {
      throw error ?? new Error("Payment intent was not created.");
    }

    return jsonResponse({
      payment: data,
      item: {
        title: item.title,
        amount_cents: item.amountCents
      },
      method: {
        asset,
        network,
        receive_address: method.row.receive_address,
        min_confirmations: method.row.min_confirmations
      }
    });
  } catch (error) {
    return handleError(error);
  }
});
