import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api/client";
import type { Course } from "../types";

export function useCourses() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listCourses();
      setCourses(data);
      setError(null);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load courses");
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // While any material is still being ingested, poll so status/progress
  // update live without the user having to reload.
  useEffect(() => {
    const hasProcessing = courses?.some((c) =>
      c.materials.some((m) => m.status === "processing"),
    );
    if (!hasProcessing) return;

    pollRef.current = setTimeout(refresh, 2500);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [courses, refresh]);

  return { courses, error, refresh };
}
