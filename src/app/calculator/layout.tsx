import { buildMetadata } from "@/lib/seo"

export const metadata = buildMetadata({
  title: "Grow Cost Calculator",
  description: "Estimate the electricity cost of running your grow setup — lights, fans, pumps, and more.",
  pathname: "/calculator",
})

export default function CalculatorLayout({ children }: { children: React.ReactNode }) {
  return children
}
