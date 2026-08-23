import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as api from "../api/client";

interface PointsContextValue {
  points: number | null;
  award: (amount: number) => Promise<void>;
  spend: (amount: number) => Promise<boolean>;
  refresh: () => Promise<void>;
}

const PointsContext = createContext<PointsContextValue | null>(null);

export function PointsProvider({ children }: { children: ReactNode }) {
  const [points, setPoints] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getPoints();
      setPoints(data.total);
    } catch {
      // header just keeps showing the last known balance
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const award = useCallback(async (amount: number) => {
    const data = await api.awardPoints(amount);
    setPoints(data.total);
  }, []);

  const spend = useCallback(async (amount: number) => {
    try {
      const data = await api.spendPoints(amount);
      setPoints(data.total);
      return true;
    } catch {
      return false;
    }
  }, []);

  return <PointsContext.Provider value={{ points, award, spend, refresh }}>{children}</PointsContext.Provider>;
}

export function usePoints() {
  const ctx = useContext(PointsContext);
  if (!ctx) throw new Error("usePoints must be used within a PointsProvider");
  return ctx;
}
