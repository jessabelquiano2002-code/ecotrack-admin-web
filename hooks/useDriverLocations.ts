"use client";

import { useEffect, useState } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "../lib/firebase";

export function useDriverLocations() {
  const [drivers, setDrivers] = useState<any>({});

  useEffect(() => {
    const driversRef = ref(db, "driver_locations");

    const unsubscribe = onValue(driversRef, (snapshot) => {
      const data = snapshot.val() || {};
      setDrivers(data);
    });

    return () => unsubscribe();
  }, []);

  return drivers;
}