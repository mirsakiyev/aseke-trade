import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  accountEmailLabel,
  accountPlanLabel,
  formatUsd,
  hasActivePremiumAccess,
  premiumExpiryLabel
} from "../lib/accountStatus";
import { fetchAccountBalance } from "../lib/cryptoPayments";
import type { AccountBalance } from "../types/content";

export function useAccountStatus() {
  const { user, profile, isAdmin, refreshProfile } = useAuth();
  const [balance, setBalance] = useState<AccountBalance | null>(null);
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);

  const refreshBalance = useCallback(async () => {
    if (!user) {
      setBalance(null);
      return null;
    }

    setIsBalanceLoading(true);
    try {
      const nextBalance = await fetchAccountBalance(user.id);
      setBalance(nextBalance);
      return nextBalance;
    } finally {
      setIsBalanceLoading(false);
    }
  }, [user]);

  useEffect(() => {
    let mounted = true;

    if (!user) {
      setBalance(null);
      setIsBalanceLoading(false);
      return () => {
        mounted = false;
      };
    }

    setIsBalanceLoading(true);
    fetchAccountBalance(user.id)
      .then((nextBalance) => {
        if (mounted) setBalance(nextBalance);
      })
      .finally(() => {
        if (mounted) setIsBalanceLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [user]);

  const balanceCents = balance?.balance_cents ?? 0;
  const isPremiumActive = hasActivePremiumAccess(profile);

  return useMemo(
    () => ({
      user,
      profile,
      email: accountEmailLabel(user?.email),
      balance,
      balanceCents,
      balanceLabel: formatUsd(balanceCents),
      planLabel: accountPlanLabel(profile),
      isPremiumActive,
      isAdmin,
      premiumUntil: profile?.premium_until ?? null,
      premiumUntilLabel: premiumExpiryLabel(profile),
      isBalanceLoading,
      refreshBalance,
      refreshProfile
    }),
    [
      balance,
      balanceCents,
      isAdmin,
      isBalanceLoading,
      isPremiumActive,
      profile,
      refreshBalance,
      refreshProfile,
      user
    ]
  );
}
