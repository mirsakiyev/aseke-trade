import {
  getActivePaymentMethod,
  getAuthenticatedUser,
  getServiceClient,
  handleError,
  handleOptions,
  jsonResponse,
  normalizeDepositAmount,
  normalizeAssetNetwork,
  reserveUniqueExpectedAmount,
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
    const paymentType = body.payment_type === "deposit" ? "deposit" : "purchase";
    const item =
      paymentType === "deposit"
        ? {
            courseId: null,
            guideId: null,
            productType: "deposit" as const,
            productLabel: "Account balance deposit",
            planId: null,
            planDurationMonths: null,
            title: "Account balance deposit",
            ...normalizeDepositAmount(body.amount)
          }
        : await resolveCheckoutItem(supabase, body);
    const reservedAmount = await reserveUniqueExpectedAmount(supabase, method.row, method.config, item.expectedAmount);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("crypto_payments")
      .insert({
        user_id: user.id,
        course_id: item.courseId,
        guide_id: item.guideId,
        payment_type: paymentType,
        product_type: item.productType,
        product_label: item.productLabel,
        plan_id: item.planId,
        plan_duration_months: item.planDurationMonths,
        fiat_amount_cents: item.amountCents,
        fiat_currency: "USD",
        payment_method_id: method.row.id,
        expected_amount: reservedAmount.expectedAmount,
        amount_nonce_units: reservedAmount.amountNonceUnits,
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
        amount_cents: item.amountCents,
        product_type: item.productType,
        product_label: item.productLabel,
        plan_id: item.planId,
        plan_duration_months: item.planDurationMonths
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
