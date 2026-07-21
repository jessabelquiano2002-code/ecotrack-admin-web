"use client";

import { ReactNode } from "react";

type Props = {
  title: string;
  kicker?: string;
  children: ReactNode;
};

export function SectionCard({ title, kicker, children }: Props) {
  return (
    <div className="card">
      {kicker && <div className="kicker">{kicker}</div>}

      <div style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
      </div>

      <div>{children}</div>
    </div>
  );
}