import { useCallback, useEffect, useState } from "react";
import * as api from "../api/client";
import { useSessionId } from "../session/SessionContext";
import type { CourseSummary } from "../types";

export function useCourses() {
  const sessionId = useSessionId();
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listCourses(sessionId);
      setCourses(data.courses);
      setError(null);
      return data.courses;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load courses");
      return null;
    }
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { courses, error, refresh };
}
