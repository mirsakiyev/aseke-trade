import { TradeRouteOptimizer } from "../components/TradeRouteOptimizer";
import { useAuth } from "../contexts/AuthContext";

export function PuzzleOfTheDay() {
  const { user } = useAuth();

  return (
    <main className="page page-stack">
      <TradeRouteOptimizer userId={user?.id ?? null} />
    </main>
  );
}
