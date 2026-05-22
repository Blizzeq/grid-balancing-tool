"use client";

import dynamic from "next/dynamic";

const GridBalancingApp = dynamic(
  () => import("@/components/grid-balancing-app").then((module) => module.GridBalancingApp),
  {
    ssr: false,
    loading: () => (
      <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-6">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Preparing trading desk</p>
        </div>
      </main>
    ),
  }
);

export function GridBalancingEntry() {
  return <GridBalancingApp />;
}
