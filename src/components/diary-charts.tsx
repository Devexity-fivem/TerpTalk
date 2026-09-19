"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"

// Code-splits recharts out of the diary page's first-load JS. The dynamic
// call must live in a Client Component — dynamic imports in Server
// Components do not code-split. SSR stays enabled; ResponsiveContainer
// renders empty server-side and measures on the client.

function EnvChartsPlaceholder() {
  return (
    <div className="mb-6">
      <section className="bg-card rounded-xl border border-border p-4">
        <Skeleton className="h-4 w-44 mb-3" />
        <Skeleton className="w-full h-[220px]" />
      </section>
      <section className="bg-card rounded-xl border border-border p-4 mt-4">
        <Skeleton className="h-4 w-48 mb-3" />
        <Skeleton className="w-full h-[200px]" />
      </section>
    </div>
  )
}

const EnvChartsLazy = dynamic(() => import("./env-chart"), {
  loading: () => <EnvChartsPlaceholder />,
})

const HeightChartLazy = dynamic(() => import("./height-chart"), {
  loading: () => <Skeleton className="w-full h-[200px] mb-6" />,
})

export { EnvChartsLazy, HeightChartLazy }
