import type { User } from "@supabase/supabase-js";

export const NEW_PASSWORD_POLICY_MESSAGE =
  "New password must be at least 8 characters and include uppercase, lowercase, and a number.";
export const PASSWORD_UPDATED_MESSAGE = "Password updated successfully.";
export const PASSWORD_UPDATE_GENERIC_ERROR =
  "Password could not be updated. Please check your current password and try again.";
export const LOGIN_AGAIN_MESSAGE = "Please log in again to update your password.";
export const SOCIAL_PASSWORD_MESSAGE =
  "This account uses a social login provider. Manage your password through that provider.";

interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

type PasswordIdentityUser = Pick<User, "email" | "app_metadata" | "identities">;

export function validateNewPassword(password: string): string | null {
  if (!password) return "New password is required.";
  if (
    password.length < 8 ||
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    return NEW_PASSWORD_POLICY_MESSAGE;
  }
  return null;
}

export function validatePasswordChangeInput(input: PasswordChangeInput): string | null {
  if (!input.currentPassword) return "Current password is required.";
  if (!input.newPassword) return "New password is required.";
  if (!input.confirmPassword) return "Confirm new password is required.";

  if (
    hasOuterWhitespace(input.currentPassword) ||
    hasOuterWhitespace(input.newPassword) ||
    hasOuterWhitespace(input.confirmPassword)
  ) {
    return "Remove spaces at the beginning or end of password fields.";
  }

  if (input.newPassword !== input.confirmPassword) {
    return "New password and confirmation do not match.";
  }

  if (input.newPassword === input.currentPassword) {
    return "New password must be different from current password.";
  }

  return validateNewPassword(input.newPassword);
}

export function hasPasswordIdentity(user: PasswordIdentityUser | null): boolean {
  if (!user?.email) return false;

  const identityProviders = (user.identities ?? [])
    .map((identity) => identity.provider)
    .filter((provider): provider is string => Boolean(provider));

  if (identityProviders.length > 0) {
    return identityProviders.includes("email");
  }

  const metadataProviders = metadataProviderList(user.app_metadata);
  if (metadataProviders.length > 0) {
    return metadataProviders.includes("email");
  }

  return user.app_metadata.provider ? user.app_metadata.provider === "email" : true;
}

function hasOuterWhitespace(value: string): boolean {
  return value.trim() !== value;
}

function metadataProviderList(metadata: User["app_metadata"]): string[] {
  const providers = metadata.providers;
  if (Array.isArray(providers)) {
    return providers.filter((provider): provider is string => typeof provider === "string");
  }
  return [];
}
