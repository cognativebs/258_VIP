"use client";

import { useEffect, useState } from "react";

export function LocalTimestampNote() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setTime(new Date().toLocaleTimeString());
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  if (time === null) return null;

  return (
    <p
      data-testid="console-local-time"
      style={{ fontSize: "0.75rem", opacity: 0.7, margin: "4px 0 0" }}
    >
      Local time: {time}
    </p>
  );
}
