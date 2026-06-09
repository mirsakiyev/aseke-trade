import {
  ApiError,
  getServiceClient,
  handleError,
  handleOptions,
  jsonResponse,
  requireServiceRole,
  verifyPaymentById
} from "../_shared/crypto-payments.ts";

Deno.serve(async (request) => {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  try {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed.", code: "method_not_allowed" }, 405);
    }

    requireServiceRole(request);

    const body = (await request.json()) as Record<string, unknown>;
    const paymentId = String(body.payment_id ?? "").trim();
    if (!paymentId) {
      throw new ApiError(400, "payment_id_required", "Payment ID is required.");
    }

    const payment = await verifyPaymentById(getServiceClient(), paymentId);
    return jsonResponse({ payment });
  } catch (error) {
    return handleError(error);
  }
});
