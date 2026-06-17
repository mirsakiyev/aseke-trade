import {
  ApiError,
  enforceCryptoClaimRateLimit,
  getAuthenticatedUser,
  getServiceClient,
  handleError,
  handleOptions,
  jsonResponse,
  logCryptoClaimAttempt,
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
    await enforceCryptoClaimRateLimit(supabase, user.id);

    const body = (await request.json()) as Record<string, unknown>;
    const paymentId = String(body.payment_id ?? "").trim();
    const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const userAgent = request.headers.get("user-agent");

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
    if (payment.status === "confirmed" || payment.status === "credited") {
      return jsonResponse({ payment });
    }

    if (new Date(payment.expires_at).getTime() < Date.now()) {
      const expiredPayment = await updateSubmittedPayment(supabase, payment.id, { status: "expired" });
      await logCryptoClaimAttempt(supabase, {
        attemptedUserId: user.id,
        payment,
        txHash: payment.tx_hash,
        status: "expired",
        reason: "Payment intent expired before claim.",
        ipAddress,
        userAgent
      });
      return jsonResponse({ payment: expiredPayment });
    }

    const txHash = normalizeTxHash(body.tx_hash ?? payment.tx_hash, payment.network);

    // The raw tx hash is public data. Do not decide ownership here and do not permanently block
    // another intent just because this row saw the hash first; the verifier must bind a matched
    // on-chain transfer event to the authenticated user's pre-created payment intent.
    await updateSubmittedPayment(supabase, payment.id, {
      tx_hash: txHash,
      status: "submitted",
      submitted_at: payment.submitted_at ?? new Date().toISOString()
    });

    await logCryptoClaimAttempt(supabase, {
      attemptedUserId: user.id,
      payment,
      txHash,
      status: "submitted",
      reason: "Authenticated user submitted transaction hash for an owned payment intent.",
      ipAddress,
      userAgent
    });

    const verifiedPayment = await verifyPaymentById(supabase, payment.id, user.id);
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
