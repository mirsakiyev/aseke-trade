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
    const address = normalizeRequiredText(body.address, "Wallet address is required.");
    const network = normalizeRequiredText(body.network, "Network is required.");
    const notes = normalizeOptionalText(body.notes, 1000);
    const idempotencyKey = normalizeOptionalText(body.idempotency_key, 120);

    const { data, error } = await supabase.rpc("submit_trading_academy_aml_check", {
      target_user_id: user.id,
      wallet_address: address,
      target_network: network,
      user_notes: notes,
      request_key: idempotencyKey
    });

    if (error) {
      return jsonResponse(
        {
          error: "aml_check_failed",
          message: safeAmlDetail(error.message)
        },
        400
      );
    }

    const result = Array.isArray(data) ? data[0] : data;
    return jsonResponse({ result });
  } catch (error) {
    return handleError(error);
  }
});

function normalizeRequiredText(value: unknown, message: string): string {
  const normalized = normalizeOptionalText(value, 500);
  if (!normalized) {
    throw new ApiError(400, "invalid_aml_request", message);
  }

  return normalized;
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, maxLength);

  return normalized || null;
}

function safeAmlDetail(message: string): string {
  if (/insufficient account balance/i.test(message)) return "Insufficient account balance.";
  if (/trading academy access is required/i.test(message)) return "Trading Academy access is required.";
  if (/address|required|network/i.test(message)) return message;

  return "AML check could not be submitted.";
}
