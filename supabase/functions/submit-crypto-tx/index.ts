import {
  ApiError,
  getAuthenticatedUser,
  getServiceClient,
  handleError,
  handleOptions,
  jsonResponse,
  normalizeTxHash,
  verifyPaymentById,
  type CryptoPaymentRow
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
    const paymentId = String(body.payment_id ?? "").trim();

    if (!paymentId) {
      throw new ApiError(400, "payment_id_required", "Payment ID is required.");
    }

    const { data, error } = await supabase
      .from("crypto_payments")
      .select("*")
      .eq("id", paymentId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(404, "payment_not_found", "This payment could not be found.");
    }

    const payment = data as CryptoPaymentRow;
    if (payment.status === "confirmed") {
      return jsonResponse({ payment });
    }

    if (new Date(payment.expires_at).getTime() < Date.now() && !payment.tx_hash) {
      const expiredPayment = await updateSubmittedPayment(supabase, payment.id, { status: "expired" });
      return jsonResponse({ payment: expiredPayment });
    }

    const txHash = normalizeTxHash(body.tx_hash ?? payment.tx_hash, payment.network);
    const { data: duplicateRows, error: duplicateError } = await supabase
      .from("crypto_payments")
      .select("id,status")
      .eq("tx_hash", txHash)
      .neq("id", payment.id)
      .limit(1);

    if (duplicateError) {
      throw new ApiError(500, "duplicate_check_failed", "Transaction reuse check failed.");
    }

    if (duplicateRows?.length) {
      const duplicatePayment = await updateSubmittedPayment(supabase, payment.id, { status: "duplicate" });
      return jsonResponse({ payment: duplicatePayment });
    }

    await updateSubmittedPayment(supabase, payment.id, {
      tx_hash: txHash,
      status: "verifying",
      submitted_at: payment.submitted_at ?? new Date().toISOString()
    });

    const verifiedPayment = await verifyPaymentById(supabase, payment.id);
    return jsonResponse({ payment: verifiedPayment });
  } catch (error) {
    return handleError(error);
  }
});

async function updateSubmittedPayment(
  supabase: ReturnType<typeof getServiceClient>,
  paymentId: string,
  payload: Record<string, unknown>
): Promise<CryptoPaymentRow> {
  const { data, error } = await supabase
    .from("crypto_payments")
    .update(payload)
    .eq("id", paymentId)
    .select("*")
    .single();

  if (error || !data) {
    throw new ApiError(500, "payment_update_failed", "Payment could not be updated.");
  }

  return data as CryptoPaymentRow;
}
